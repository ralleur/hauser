import {
  RoomImageClientError,
  isRoomImageClientRequestId,
  isRoomImageOpaqueId,
  type MainCandidatesJobRequest,
  type RoomImageApi,
  type RoomImageAsset,
  type RoomImageCapability,
  type RoomImageCapabilityDetails,
  type RoomImageClientErrorKind,
  type RoomImageJob,
  type RoomImageMimeType,
  type RoomImageUpload,
  type VariantSetJobRequest,
} from './room-image-client.ts';

export const ROOM_IMAGE_RESUME_KEY = 'hmi:room-image-wizard-resume:v1';

export interface ResumeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PollScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RoomImageSafeError {
  kind: RoomImageClientErrorKind;
  status: number | null;
  code: string;
  message: string;
  retryable: boolean;
}

export interface RoomImageWizardCapabilityState {
  public: RoomImageCapability | null;
  details: RoomImageCapabilityDetails | null;
  error: RoomImageSafeError | null;
}

export type RoomImageWizardLifecycle =
  | 'idle'
  | 'loading'
  | 'resumable'
  | 'not_resumable'
  | 'closed'
  | 'error';

export interface RoomImageWizardState {
  lifecycle: RoomImageWizardLifecycle;
  capability: RoomImageWizardCapabilityState;
  job: RoomImageJob | null;
  sourcePreviewUrl: string | null;
  polling: boolean;
  error: RoomImageSafeError | null;
}

export interface RoomImageWizardControllerOptions {
  api: RoomImageApi;
  storage?: ResumeStorage | null;
  uuid?: () => string;
  scheduler?: PollScheduler;
  pollDelayMs?: number;
}

export interface RoomImageWizardController {
  state(): RoomImageWizardState;
  subscribe(listener: (state: RoomImageWizardState) => void): () => void;
  loadCapability(): Promise<void>;
  loadCapabilityDetails(): Promise<void>;
  probeCapability(): Promise<void>;
  upload(data: Blob | ArrayBuffer, mimeType: RoomImageMimeType): Promise<RoomImageUpload>;
  deleteUpload(uploadId: string): Promise<void>;
  createMainJob(request: Omit<MainCandidatesJobRequest, 'clientRequestId'>): Promise<void>;
  createFinalJob(request: Omit<VariantSetJobRequest, 'clientRequestId'>): Promise<void>;
  resume(): Promise<void>;
  refreshStatus(): Promise<void>;
  retry(): Promise<void>;
  cancel(): Promise<void>;
  discard(): Promise<void>;
  publish(confirmed: true): Promise<RoomImageAsset | null>;
  close(): void;
  forget(): void;
}

interface ResumeMarker {
  jobId: string;
  clientRequestId: string;
}

const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancelling']);
const SOURCE_PREVIEW_STATUSES = new Set(['queued', 'running', 'succeeded', 'awaiting_confirmation']);

const defaultScheduler: PollScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultStorage(): ResumeStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/** Das Panel wird auch über http:// im LAN ausgeliefert. Dort fehlt
    crypto.randomUUID (nur Secure Context), deshalb der Fallback über
    getRandomValues — analog zu randomUuid() im Jellyfin-Adapter. */
function defaultUuid(): string {
  const source = globalThis.crypto;
  if (source?.randomUUID) return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function initialState(): RoomImageWizardState {
  return {
    lifecycle: 'idle',
    capability: { public: null, details: null, error: null },
    job: null,
    sourcePreviewUrl: null,
    polling: false,
    error: null,
  };
}

function safeError(error: unknown): RoomImageSafeError {
  if (error instanceof RoomImageClientError) {
    return {
      kind: error.kind,
      status: error.status,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    kind: 'network',
    status: null,
    code: 'NETWORK_ERROR',
    message: 'Die Room-Image-Route ist nicht erreichbar.',
    retryable: false,
  };
}

function invalidResponseError(): RoomImageClientError {
  return new RoomImageClientError(
    'invalid_response', null, 'INVALID_RESPONSE', 'Die Room-Image-Antwort ist ungültig.', false,
  );
}

function sourcePreview(job: RoomImageJob): string | null {
  if (SOURCE_PREVIEW_STATUSES.has(job.status)
      && !(job.kind === 'variant_set' && job.status === 'succeeded')) {
    return `/api/room-image-jobs/${job.jobId}/source-preview`;
  }
  if (job.status === 'failed' && job.retryable) {
    return `/api/room-image-jobs/${job.jobId}/source-preview`;
  }
  return null;
}

function exactMarker(value: unknown): value is ResumeMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  return keys.length === 2 && keys[0] === 'clientRequestId' && keys[1] === 'jobId'
    && isRoomImageOpaqueId(candidate.jobId)
    && isRoomImageClientRequestId(candidate.clientRequestId);
}

export function createRoomImageWizardController(
  options: RoomImageWizardControllerOptions,
): RoomImageWizardController {
  const api = options.api;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const uuid = options.uuid ?? defaultUuid;
  const scheduler = options.scheduler ?? defaultScheduler;
  const pollDelayMs = options.pollDelayMs ?? 1_000;
  const listeners = new Set<(state: RoomImageWizardState) => void>();

  let current = initialState();
  let uiEpoch = 0;
  let markerClaim = 0;
  let pollTimer: unknown = null;
  let statusAbort: AbortController | null = null;
  let statusInFlight: Promise<void> | null = null;
  let costMutationInFlight: Promise<void> | null = null;
  let activeMarker: ResumeMarker | null = null;

  function set(next: RoomImageWizardState): void {
    current = next;
    for (const listener of listeners) listener(current);
  }

  function patchState(patch: Partial<RoomImageWizardState>): void {
    set({ ...current, ...patch });
  }

  function clearTimer(): void {
    if (pollTimer !== null) scheduler.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function beginUiSession(): number {
    uiEpoch += 1;
    clearTimer();
    statusAbort?.abort();
    statusAbort = null;
    statusInFlight = null;
    return uiEpoch;
  }

  function nextMarkerClaim(): number {
    markerClaim += 1;
    return markerClaim;
  }

  function runCostMutation(operation: () => Promise<void>): Promise<void> {
    if (costMutationInFlight) return costMutationInFlight;
    let inFlight!: Promise<void>;
    inFlight = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (costMutationInFlight === inFlight) costMutationInFlight = null;
      });
    costMutationInFlight = inFlight;
    return inFlight;
  }

  function readMarker(): ResumeMarker | null {
    if (!storage) return null;
    let raw: string | null;
    try { raw = storage.getItem(ROOM_IMAGE_RESUME_KEY); } catch { return null; }
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (exactMarker(parsed)) return { jobId: parsed.jobId, clientRequestId: parsed.clientRequestId };
    } catch { /* Invalid markers are removed below. */ }
    try { storage.removeItem(ROOM_IMAGE_RESUME_KEY); } catch { /* Storage is best-effort. */ }
    return null;
  }

  function writeMarker(marker: ResumeMarker): void {
    if (!storage) return;
    try {
      storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({
        jobId: marker.jobId,
        clientRequestId: marker.clientRequestId,
      }));
    } catch { /* Storage is best-effort. */ }
  }

  function writeMarkerForClaim(marker: ResumeMarker, claim: number): boolean {
    if (claim !== markerClaim) return false;
    writeMarker(marker);
    return true;
  }

  function removeMarker(): void {
    if (!storage) return;
    try { storage.removeItem(ROOM_IMAGE_RESUME_KEY); } catch { /* Storage is best-effort. */ }
  }

  function schedulePoll(sessionEpoch: number): void {
    clearTimer();
    if (sessionEpoch !== uiEpoch || !activeMarker || !current.job
        || !ACTIVE_STATUSES.has(current.job.status) || current.lifecycle === 'closed') return;
    const marker = activeMarker;
    pollTimer = scheduler.setTimeout(() => {
      pollTimer = null;
      if (sessionEpoch !== uiEpoch) return;
      void refreshFor(sessionEpoch, marker);
    }, pollDelayMs);
  }

  function applyJob(job: RoomImageJob, marker: ResumeMarker, sessionEpoch: number): void {
    if (sessionEpoch !== uiEpoch) return;
    if (job.jobId !== marker.jobId || job.clientRequestId !== marker.clientRequestId) {
      throw invalidResponseError();
    }
    activeMarker = marker;
    const polling = ACTIVE_STATUSES.has(job.status);
    set({
      ...current,
      lifecycle: 'resumable',
      job,
      sourcePreviewUrl: sourcePreview(job),
      polling,
      error: null,
    });
    if (polling) schedulePoll(sessionEpoch);
    else clearTimer();
  }

  function handleSessionError(error: unknown, sessionEpoch: number, clearMissingMarker = false): void {
    if (sessionEpoch !== uiEpoch) return;
    const normalized = safeError(error);
    if (normalized.kind === 'abort' && current.lifecycle === 'closed') return;
    if (clearMissingMarker && normalized.kind === 'http'
        && (normalized.status === 404 || normalized.status === 410)) {
      nextMarkerClaim();
      removeMarker();
      activeMarker = null;
      set({
        ...current,
        lifecycle: 'not_resumable',
        job: null,
        sourcePreviewUrl: null,
        polling: false,
        error: normalized,
      });
      return;
    }
    patchState({ lifecycle: 'error', polling: false, error: normalized });
  }

  function refreshFor(sessionEpoch: number, marker: ResumeMarker): Promise<void> {
    if (sessionEpoch !== uiEpoch) return Promise.resolve();
    if (statusInFlight) return statusInFlight;
    clearTimer();
    const abort = new AbortController();
    statusAbort = abort;
    patchState({ polling: true });
    let operation!: Promise<void>;
    operation = (async () => {
      try {
        const job = await api.getJob(marker.jobId, { signal: abort.signal });
        applyJob(job, marker, sessionEpoch);
      } catch (error) {
        handleSessionError(error, sessionEpoch, true);
      } finally {
        if (statusAbort === abort) statusAbort = null;
        if (statusInFlight === operation) statusInFlight = null;
      }
    })();
    statusInFlight = operation;
    return operation;
  }

  async function createWithRequest(
    request: MainCandidatesJobRequest | VariantSetJobRequest,
    claim: number,
  ): Promise<void> {
    const sessionEpoch = beginUiSession();
    activeMarker = null;
    patchState({ lifecycle: 'loading', polling: false, error: null });
    try {
      const job = await api.createJob(request);
      const marker = { jobId: job.jobId, clientRequestId: request.clientRequestId };
      if (job.clientRequestId !== request.clientRequestId) throw invalidResponseError();
      if (!writeMarkerForClaim(marker, claim)) return;
      if (sessionEpoch !== uiEpoch) return;
      applyJob(job, marker, sessionEpoch);
    } catch (error) {
      handleSessionError(error, sessionEpoch);
    }
  }

  async function loadCapability(): Promise<void> {
    try {
      const capability = await api.getCapability();
      set({
        ...current,
        capability: { ...current.capability, public: capability, error: null },
      });
    } catch (error) {
      set({
        ...current,
        capability: { ...current.capability, error: safeError(error) },
      });
    }
  }

  async function loadCapabilityDetails(): Promise<void> {
    try {
      const details = await api.getCapabilityDetails();
      set({
        ...current,
        capability: { ...current.capability, details, error: null },
      });
    } catch (error) {
      set({
        ...current,
        capability: { ...current.capability, details: null, error: safeError(error) },
      });
    }
  }

  async function probeCapability(): Promise<void> {
    try {
      const details = await api.probeCapability();
      set({
        ...current,
        capability: { ...current.capability, details, error: null },
      });
    } catch (error) {
      set({
        ...current,
        capability: { ...current.capability, details: null, error: safeError(error) },
      });
    }
  }

  async function resume(): Promise<void> {
    const sessionEpoch = beginUiSession();
    activeMarker = null;
    const marker = readMarker();
    if (!marker) {
      set({
        ...current,
        lifecycle: 'not_resumable',
        job: null,
        sourcePreviewUrl: null,
        polling: false,
        error: null,
      });
      return;
    }
    nextMarkerClaim();
    activeMarker = marker;
    patchState({ lifecycle: 'loading', job: null, sourcePreviewUrl: null, polling: true, error: null });
    await refreshFor(sessionEpoch, marker);
  }

  async function refreshStatus(): Promise<void> {
    if (!activeMarker || current.lifecycle === 'closed') return;
    await refreshFor(uiEpoch, activeMarker);
  }

  async function retryOperation(): Promise<void> {
    const oldJob = current.job;
    const descriptor = oldJob?.retry;
    if (!oldJob || oldJob.status !== 'failed' || !oldJob.retryable || !descriptor) return;
    const claim = nextMarkerClaim();
    const clientRequestId = uuid();
    const sessionEpoch = beginUiSession();
    patchState({ lifecycle: 'loading', polling: false, error: null });
    try {
      const retried = await api.retryJob(oldJob.jobId, {
        clientRequestId,
        noticeVersion: descriptor.noticeVersion,
        costConfirmed: true,
        confirmedProviderCalls: descriptor.requiredProviderCalls,
      });
      const marker = { jobId: retried.jobId, clientRequestId };
      if (retried.clientRequestId !== clientRequestId) throw invalidResponseError();
      if (!writeMarkerForClaim(marker, claim)) return;
      if (sessionEpoch !== uiEpoch) return;
      applyJob(retried, marker, sessionEpoch);
    } catch (error) {
      handleSessionError(error, sessionEpoch);
    }
  }

  async function cancel(): Promise<void> {
    const marker = activeMarker;
    if (!marker) return;
    const sessionEpoch = beginUiSession();
    patchState({ lifecycle: 'loading', polling: false, error: null });
    try {
      const cancelled = await api.cancelJob(marker.jobId);
      applyJob(cancelled, marker, sessionEpoch);
    } catch (error) {
      handleSessionError(error, sessionEpoch);
    }
  }

  async function discard(): Promise<void> {
    const marker = activeMarker;
    if (!marker) return;
    const sessionEpoch = beginUiSession();
    patchState({ lifecycle: 'loading', polling: false, error: null });
    try {
      await api.discardJob(marker.jobId);
      if (sessionEpoch !== uiEpoch) return;
      nextMarkerClaim();
      removeMarker();
      activeMarker = null;
      set({
        ...current,
        lifecycle: 'idle',
        job: null,
        sourcePreviewUrl: null,
        polling: false,
        error: null,
      });
    } catch (error) {
      handleSessionError(error, sessionEpoch);
    }
  }

  async function publish(confirmed: true): Promise<RoomImageAsset | null> {
    const marker = activeMarker;
    if (!marker || confirmed !== true) return null;
    const sessionEpoch = beginUiSession();
    patchState({ lifecycle: 'loading', polling: false, error: null });
    try {
      const asset = await api.publishJob(marker.jobId, true);
      if (sessionEpoch !== uiEpoch) return null;
      await refreshFor(sessionEpoch, marker);
      return asset;
    } catch (error) {
      handleSessionError(error, sessionEpoch);
      return null;
    }
  }

  function close(): void {
    beginUiSession();
    set({ ...current, lifecycle: 'closed', polling: false, error: null });
  }

  function forget(): void {
    beginUiSession();
    nextMarkerClaim();
    removeMarker();
    activeMarker = null;
    set({
      ...current,
      lifecycle: 'idle',
      job: null,
      sourcePreviewUrl: null,
      polling: false,
      error: null,
    });
  }

  return {
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    loadCapability,
    loadCapabilityDetails,
    probeCapability,
    upload: (data, mimeType) => api.upload(data, mimeType),
    deleteUpload: (uploadId) => api.deleteUpload(uploadId),
    createMainJob: (request) => runCostMutation(() => {
      const claim = nextMarkerClaim();
      return createWithRequest({
        kind: 'main_candidates',
        clientRequestId: uuid(),
        uploadId: request.uploadId,
        crop: request.crop,
        canonicalCropPixels: request.canonicalCropPixels,
        focus: request.focus,
        stylePreset: request.stylePreset,
        adjustments: request.adjustments,
        candidateCount: request.candidateCount,
        noticeVersion: request.noticeVersion,
        costConfirmed: request.costConfirmed,
        confirmedProviderCalls: request.confirmedProviderCalls,
      }, claim);
    }),
    createFinalJob: (request) => runCostMutation(() => {
      const claim = nextMarkerClaim();
      return createWithRequest({
        kind: 'variant_set',
        clientRequestId: uuid(),
        parentJobId: request.parentJobId,
        candidateId: request.candidateId,
        focus: request.focus,
        noticeVersion: request.noticeVersion,
        costConfirmed: request.costConfirmed,
        confirmedProviderCalls: request.confirmedProviderCalls,
      }, claim);
    }),
    resume,
    refreshStatus,
    retry: () => runCostMutation(retryOperation),
    cancel,
    discard,
    publish,
    close,
    forget,
  };
}
