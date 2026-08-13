import { describe, expect, it, vi } from 'vitest';
import {
  RoomImageClientError,
  type MainCandidatesJobRequest,
  type RoomImageApi,
  type RoomImageCapability,
  type RoomImageCapabilityDetails,
  type RoomImageJob,
} from './room-image-client.ts';
import {
  ROOM_IMAGE_RESUME_KEY,
  createRoomImageWizardController,
  type PollScheduler,
  type ResumeStorage,
} from './room-image-wizard-state.ts';

const JOB_ID = 'J'.repeat(43);
const NEW_JOB_ID = 'N'.repeat(43);
const CANDIDATE_ID = 'C'.repeat(43);
const ATTEMPT_ID = 'A'.repeat(43);
const LINEAGE_ID = 'L'.repeat(43);
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const NEW_UUID = '223e4567-e89b-42d3-a456-426614174000';

function counters(): { plannedCount: number; startedCount: number; completedCount: number; outcomeUnknownCount: number };
function counters(confirmedCount: number): { confirmedCount: number; plannedCount: number; startedCount: number; completedCount: number; outcomeUnknownCount: number };
function counters(confirmedCount?: number) {
  const values = { plannedCount: confirmedCount ?? 3, startedCount: 1, completedCount: 1, outcomeUnknownCount: 0 };
  return confirmedCount === undefined ? values : { confirmedCount, ...values };
}

function job(overrides: Partial<RoomImageJob> = {}): RoomImageJob {
  return {
    jobId: JOB_ID,
    kind: 'main_candidates',
    clientRequestId: UUID,
    attemptId: ATTEMPT_ID,
    parentAttemptId: null,
    lineageId: LINEAGE_ID,
    status: 'running',
    phase: 'generating_style_1',
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:01.000Z',
    expiresAt: '2026-08-10T10:00:00.000Z',
    cancellable: true,
    retryable: false,
    discardable: false,
    retry: null,
    supersededByJobId: null,
    providerCalls: { attempt: counters(3), lineage: counters(), wizard: counters() },
    candidates: [],
    asset: null,
    error: null,
    ...overrides,
  };
}

class MemoryStorage implements ResumeStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class FakeScheduler implements PollScheduler {
  readonly pending = new Map<number, () => void>();
  #next = 1;
  setTimeout(callback: () => void, _delayMs: number): number {
    const id = this.#next++;
    this.pending.set(id, callback);
    return id;
  }
  clearTimeout(handle: unknown): void { this.pending.delete(handle as number); }
  async runNext(): Promise<void> {
    const entry = this.pending.entries().next().value as [number, () => void] | undefined;
    if (!entry) throw new Error('no pending timer');
    this.pending.delete(entry[0]);
    entry[1]();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function api(overrides: Partial<RoomImageApi> = {}): RoomImageApi {
  return {
    getCapability: vi.fn(),
    getCapabilityDetails: vi.fn(),
    probeCapability: vi.fn(),
    upload: vi.fn(),
    deleteUpload: vi.fn(),
    createJob: vi.fn(),
    getJob: vi.fn(),
    retryJob: vi.fn(),
    cancelJob: vi.fn(),
    discardJob: vi.fn(),
    publishJob: vi.fn(),
    ...overrides,
  };
}

function mainDraft(): Omit<MainCandidatesJobRequest, 'clientRequestId'> {
  return {
    kind: 'main_candidates', uploadId: 'U'.repeat(43),
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    canonicalCropPixels: { x: 106, y: 75, width: 1696, height: 1200 },
    focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
    stylePreset: 'hauser-room-v1',
    adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows'] },
    candidateCount: 2, noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 3,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function capabilityDetails(
  imageCapability: RoomImageCapabilityDetails['imageCapability'],
): RoomImageCapabilityDetails {
  return {
    enabled: false,
    provider: 'openai',
    credentialConfigured: imageCapability !== 'credential_missing',
    credentialSource: 'environment',
    credentialMode: 'api_key',
    imageCapability,
    reasonCode: imageCapability === 'credential_missing' ? 'CREDENTIAL_MISSING' : null,
    model: 'gpt-image-2-2026-04-21',
    probe: { modelVisible: imageCapability === 'unverified' || imageCapability === 'ready', checkedAt: null },
    limits: {
      maxUploadBytes: 12582912,
      maxDecodedPixels: 24000000,
      maxMainCandidates: 2,
      maxConcurrentProviderCalls: 1,
      maxQueuedJobs: 3,
    },
  };
}

describe('room image wizard resumable state', () => {
  it('persists byte-exactly only the confirmed jobId and clientRequestId after job creation', async () => {
    const storage = new MemoryStorage();
    const created = job({ status: 'queued', phase: 'queued' });
    const roomApi = api({ createJob: vi.fn().mockResolvedValue(created) });
    const controller = createRoomImageWizardController({
      api: roomApi, storage, uuid: () => UUID, scheduler: new FakeScheduler(),
    });

    await controller.createMainJob({ ...mainDraft(), prompt: 'must-not-pass' } as Omit<MainCandidatesJobRequest, 'clientRequestId'>);

    expect(roomApi.createJob).toHaveBeenCalledWith({ ...mainDraft(), clientRequestId: UUID });
    expect(storage.values.size).toBe(1);
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBe(JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).not.toMatch(/upload|candidate|asset|counter|prompt|credential|image|url/i);
    expect(controller.state()).toMatchObject({ lifecycle: 'resumable', job: { jobId: JOB_ID }, polling: true });
  });

  it('joins overlapping main/final creates behind one shared request and UUID', async () => {
    const pending = deferred<RoomImageJob>();
    const createJob = vi.fn().mockReturnValue(pending.promise);
    const uuid = vi.fn().mockReturnValueOnce(UUID).mockReturnValueOnce(NEW_UUID);
    const controller = createRoomImageWizardController({
      api: api({ createJob }), storage: new MemoryStorage(), uuid, scheduler: new FakeScheduler(),
    });

    const main = controller.createMainJob(mainDraft());
    const final = controller.createFinalJob({
      kind: 'variant_set', parentJobId: JOB_ID, candidateId: CANDIDATE_ID,
      focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    });
    await Promise.resolve();

    expect(final).toBe(main);
    expect(uuid).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledTimes(1);

    pending.resolve(job({ status: 'queued', phase: 'queued' }));
    await Promise.all([main, final]);
  });

  it.each(['success', 'error'] as const)(
    'releases single-flight after %s so a later explicit create sends exactly once',
    async (firstOutcome) => {
      const storage = new MemoryStorage();
      const uuid = vi.fn().mockReturnValueOnce(UUID).mockReturnValueOnce(NEW_UUID);
      const createJob = vi.fn();
      if (firstOutcome === 'success') {
        createJob.mockResolvedValueOnce(job({ status: 'succeeded', phase: 'complete' }));
      } else {
        createJob.mockRejectedValueOnce(new Error('controlled failure'));
      }
      createJob.mockResolvedValueOnce(job({
        jobId: NEW_JOB_ID, clientRequestId: NEW_UUID, status: 'queued', phase: 'queued',
      }));
      const controller = createRoomImageWizardController({
        api: api({ createJob }), storage, uuid, scheduler: new FakeScheduler(),
      });

      await controller.createMainJob(mainDraft());
      await controller.createMainJob(mainDraft());

      expect(uuid).toHaveBeenCalledTimes(2);
      expect(createJob).toHaveBeenCalledTimes(2);
      expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBe(JSON.stringify({
        jobId: NEW_JOB_ID, clientRequestId: NEW_UUID,
      }));
    },
  );

  it('commits a matching create accepted after close without reopening state or polling', async () => {
    const pending = deferred<RoomImageJob>();
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    const roomApi = api({ createJob: vi.fn().mockReturnValue(pending.promise) });
    const controller = createRoomImageWizardController({
      api: roomApi, storage, uuid: () => UUID, scheduler,
    });

    const creation = controller.createMainJob(mainDraft());
    await Promise.resolve();
    expect(roomApi.createJob).toHaveBeenCalledTimes(1);
    controller.close();
    pending.resolve(job({ status: 'queued', phase: 'queued' }));
    await creation;

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBe(JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    expect(controller.state()).toMatchObject({ lifecycle: 'closed', job: null, polling: false, error: null });
    expect(scheduler.pending.size).toBe(0);
    expect(roomApi.retryJob).not.toHaveBeenCalled();
    expect(roomApi.cancelJob).not.toHaveBeenCalled();
    expect(roomApi.discardJob).not.toHaveBeenCalled();
    expect(roomApi.publishJob).not.toHaveBeenCalled();
  });

  it('does not persist a foreign clientRequestId from a create acceptance', async () => {
    const storage = new MemoryStorage();
    const controller = createRoomImageWizardController({
      api: api({ createJob: vi.fn().mockResolvedValue(job({ clientRequestId: NEW_UUID })) }),
      storage,
      uuid: () => UUID,
    });

    await controller.createMainJob(mainDraft());

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();
    expect(controller.state()).toMatchObject({
      lifecycle: 'error', polling: false, error: { kind: 'invalid_response', code: 'INVALID_RESPONSE' },
    });
  });

  it('lets explicit forget suppress a late matching create acceptance', async () => {
    const pending = deferred<RoomImageJob>();
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    const controller = createRoomImageWizardController({
      api: api({ createJob: vi.fn().mockReturnValue(pending.promise) }),
      storage,
      uuid: () => UUID,
      scheduler,
    });

    const creation = controller.createMainJob(mainDraft());
    await Promise.resolve();
    controller.forget();
    pending.resolve(job({ status: 'queued', phase: 'queued' }));
    await creation;

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();
    expect(controller.state()).toMatchObject({ lifecycle: 'idle', job: null, polling: false, error: null });
    expect(scheduler.pending.size).toBe(0);
  });

  it('keeps a newer accepted marker when an older create acceptance settles late', async () => {
    const pending = deferred<RoomImageJob>();
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    const fresh = job({
      jobId: NEW_JOB_ID, clientRequestId: NEW_UUID, status: 'succeeded', phase: 'complete',
    });
    const controller = createRoomImageWizardController({
      api: api({
        createJob: vi.fn().mockReturnValue(pending.promise),
        getJob: vi.fn().mockResolvedValue(fresh),
      }),
      storage,
      uuid: () => UUID,
      scheduler,
    });

    const oldCreation = controller.createMainJob(mainDraft());
    await Promise.resolve();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID }));
    await controller.resume();
    pending.resolve(job({ status: 'queued', phase: 'queued' }));
    await oldCreation;

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBe(JSON.stringify({
      jobId: NEW_JOB_ID, clientRequestId: NEW_UUID,
    }));
    expect(controller.state()).toMatchObject({
      lifecycle: 'resumable', job: { jobId: NEW_JOB_ID, clientRequestId: NEW_UUID }, polling: false,
    });
    expect(scheduler.pending.size).toBe(0);
  });

  it.each([
    ['not-json'],
    [JSON.stringify({ jobId: JOB_ID })],
    [JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID, uploadId: 'U'.repeat(43) })],
    [JSON.stringify({ jobId: '../secret', clientRequestId: UUID })],
    [JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID.toUpperCase() })],
  ])('removes invalid resume markers with missing, extra or malformed fields', async (stored) => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, stored);
    const roomApi = api();
    const controller = createRoomImageWizardController({ api: roomApi, storage, uuid: () => UUID });

    await controller.resume();

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();
    expect(roomApi.getJob).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({ lifecycle: 'not_resumable', job: null, error: null });
  });

  it('resumes a successful main job from two IDs and reconstructs only source and canonical candidate previews', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const succeeded = job({
      status: 'succeeded', phase: 'complete',
      candidates: [{
        candidateId: CANDIDATE_ID,
        previewUrl: `/api/room-image-jobs/${JOB_ID}/previews/${CANDIDATE_ID}`,
        suggestedRoomId: null,
      }],
    });
    const roomApi = api({ getJob: vi.fn().mockResolvedValue(succeeded) });
    const controller = createRoomImageWizardController({ api: roomApi, storage, uuid: () => UUID });

    await controller.resume();

    expect(roomApi.getJob).toHaveBeenCalledWith(JOB_ID, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(controller.state()).toMatchObject({
      lifecycle: 'resumable', polling: false, job: { status: 'succeeded', phase: 'complete' },
      sourcePreviewUrl: `/api/room-image-jobs/${JOB_ID}/source-preview`,
    });
    expect(controller.state().job?.candidates).toEqual(succeeded.candidates);
    expect(JSON.stringify(storage.values)).not.toContain('source-preview');
  });

  it('reconstructs awaiting-confirmation final previews and a published final asset after reload', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const awaiting = job({
      kind: 'variant_set', status: 'awaiting_confirmation', phase: 'awaiting_confirmation',
      temporaryVariants: {
        light: `/api/room-image-jobs/${JOB_ID}/final-previews/light`,
        dark: `/api/room-image-jobs/${JOB_ID}/final-previews/dark`,
        darkOff: `/api/room-image-jobs/${JOB_ID}/final-previews/dark-off`,
      },
      focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
    });
    const published = job({
      kind: 'variant_set', status: 'succeeded', phase: 'complete', cancellable: false,
      asset: {
        assetId: 'asset_01',
        variants: {
          light: '/assets/room-images/asset_01/light.avif',
          dark: '/assets/room-images/asset_01/dark.avif',
          darkOff: '/assets/room-images/asset_01/dark-off.avif',
        },
        focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
      },
    });
    const roomApi = api({ getJob: vi.fn().mockResolvedValueOnce(awaiting).mockResolvedValueOnce(published) });
    const controller = createRoomImageWizardController({ api: roomApi, storage, uuid: () => UUID });

    await controller.resume();
    expect(controller.state()).toMatchObject({
      job: { status: 'awaiting_confirmation', temporaryVariants: awaiting.temporaryVariants },
      sourcePreviewUrl: `/api/room-image-jobs/${JOB_ID}/source-preview`,
    });
    await controller.resume();
    expect(controller.state()).toMatchObject({
      job: { status: 'succeeded', asset: published.asset }, sourcePreviewUrl: null,
    });
  });

  it.each(['failed', 'cancelled', 'expired', 'superseded'] as const)(
    'keeps the sanitized terminal %s status and only server-delivered actions', async (status) => {
      const storage = new MemoryStorage();
      storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
      const terminal = job({
        status, phase: 'complete', cancellable: false,
        retryable: status === 'failed', discardable: true,
        retry: status === 'failed'
          ? { kind: 'main_candidates', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' }
          : null,
        supersededByJobId: status === 'superseded' ? NEW_JOB_ID : null,
        error: { code: 'SAFE_TERMINAL', message: 'Sanitisierter Zustand' },
      });
      const controller = createRoomImageWizardController({
        api: api({ getJob: vi.fn().mockResolvedValue(terminal) }), storage, uuid: () => UUID,
      });
      await controller.resume();
      expect(controller.state().job).toEqual(terminal);
      expect(controller.state().polling).toBe(false);
    },
  );

  it('keeps cancelling status polling active without exposing an expired source preview', async () => {
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const controller = createRoomImageWizardController({
      api: api({ getJob: vi.fn().mockResolvedValue(job({ status: 'cancelling' })) }),
      storage,
      uuid: () => UUID,
      scheduler,
    });

    await controller.resume();

    expect(controller.state()).toMatchObject({
      job: { status: 'cancelling' }, sourcePreviewUrl: null, polling: true,
    });
    expect(scheduler.pending.size).toBe(1);
  });

  it('polls serially with one timer and no overlapping status request while preserving server counters and phases', async () => {
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    let resolvePoll!: (value: RoomImageJob) => void;
    const pendingPoll = new Promise<RoomImageJob>((resolve) => { resolvePoll = resolve; });
    const statuses = [
      job({ status: 'running', phase: 'generating_composition' }),
      pendingPoll,
    ];
    const getJob = vi.fn().mockImplementation(() => statuses.shift());
    const controller = createRoomImageWizardController({
      api: api({ getJob }), storage, uuid: () => UUID, scheduler, pollDelayMs: 25,
    });

    await controller.resume();
    expect(scheduler.pending.size).toBe(1);
    await scheduler.runNext();
    expect(getJob).toHaveBeenCalledTimes(2);
    expect(scheduler.pending.size).toBe(0);
    void controller.refreshStatus();
    expect(getJob).toHaveBeenCalledTimes(2);

    const next = job({
      phase: 'generating_style_2',
      providerCalls: {
        attempt: { confirmedCount: 3, plannedCount: 3, startedCount: 2, completedCount: 1, outcomeUnknownCount: 0 },
        lineage: { plannedCount: 7, startedCount: 5, completedCount: 4, outcomeUnknownCount: 1 },
        wizard: { plannedCount: 9, startedCount: 6, completedCount: 5, outcomeUnknownCount: 1 },
      },
    });
    resolvePoll(next);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.state().job?.phase).toBe('generating_style_2');
    expect(controller.state().job?.providerCalls).toEqual(next.providerCalls);
    expect(scheduler.pending.size).toBe(1);
  });

  it('close aborts and clears local polling but keeps the marker, sends no mutation and shows no abort error', async () => {
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    let signal: AbortSignal | undefined;
    const getJob = vi.fn((_id: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return new Promise<RoomImageJob>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new RoomImageClientError('abort', null, 'ABORTED', 'Anfrage abgebrochen.', false)));
      });
    });
    const roomApi = api({ getJob });
    const controller = createRoomImageWizardController({ api: roomApi, storage, uuid: () => UUID, scheduler });

    const resume = controller.resume();
    controller.close();
    await resume;

    expect(signal?.aborted).toBe(true);
    expect(scheduler.pending.size).toBe(0);
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).not.toBeNull();
    expect(roomApi.cancelJob).not.toHaveBeenCalled();
    expect(roomApi.discardJob).not.toHaveBeenCalled();
    expect(roomApi.publishJob).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({ lifecycle: 'closed', polling: false, error: null });
  });

  it('close clears a poll timer created by a successful active resume and keeps the marker', async () => {
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const roomApi = api({ getJob: vi.fn().mockResolvedValue(job()) });
    const controller = createRoomImageWizardController({
      api: roomApi, storage, uuid: () => UUID, scheduler,
    });

    await controller.resume();
    expect(scheduler.pending.size).toBe(1);

    controller.close();

    expect(scheduler.pending.size).toBe(0);
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).not.toBeNull();
    expect(roomApi.cancelJob).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({ lifecycle: 'closed', polling: false, error: null });
  });

  it('ignores a late old response after a new resume and cannot overwrite current state or storage', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    let resolveOld!: (value: RoomImageJob) => void;
    const oldPending = new Promise<RoomImageJob>((resolve) => { resolveOld = resolve; });
    const fresh = job({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID, phase: 'generating_dark' });
    const getJob = vi.fn().mockReturnValueOnce(oldPending).mockResolvedValueOnce(fresh);
    const controller = createRoomImageWizardController({ api: api({ getJob }), storage, uuid: () => UUID });

    const oldResume = controller.resume();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID }));
    await controller.resume();
    resolveOld(job({ status: 'failed', phase: 'complete', error: { code: 'OLD', message: 'old' } }));
    await oldResume;

    expect(controller.state().job).toEqual(fresh);
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBe(JSON.stringify({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID }));
  });

  it.each([404, 410])('removes the marker on HTTP %i during resume/poll and becomes controlled non-resumable', async (status) => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const controller = createRoomImageWizardController({
      api: api({ getJob: vi.fn().mockRejectedValue(new RoomImageClientError(
        'http', status, status === 404 ? 'ROOM_IMAGE_JOB_NOT_FOUND' : 'ROOM_IMAGE_TEMP_EXPIRED', 'Sanitisiert', false,
      )) }),
      storage,
      uuid: () => UUID,
    });

    await controller.resume();

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();
    expect(controller.state()).toMatchObject({ lifecycle: 'not_resumable', job: null, polling: false });
    expect(controller.state().error).toMatchObject({ kind: 'http', status });
  });

  it.each([404, 410])('removes the marker on HTTP %i from an actual follow-up poll', async (status) => {
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const getJob = vi.fn()
      .mockResolvedValueOnce(job())
      .mockRejectedValueOnce(new RoomImageClientError(
        'http', status, status === 404 ? 'ROOM_IMAGE_JOB_NOT_FOUND' : 'ROOM_IMAGE_TEMP_EXPIRED', 'Sanitisiert', false,
      ));
    const controller = createRoomImageWizardController({
      api: api({ getJob }), storage, uuid: () => UUID, scheduler,
    });

    await controller.resume();
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).not.toBeNull();
    expect(scheduler.pending.size).toBe(1);

    await scheduler.runNext();

    expect(getJob).toHaveBeenCalledTimes(2);
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();
    expect(scheduler.pending.size).toBe(0);
    expect(controller.state()).toMatchObject({ lifecycle: 'not_resumable', job: null, polling: false });
    expect(controller.state().error).toMatchObject({ kind: 'http', status });
  });

  it('retries only from the current server descriptor with a fresh UUID and replaces the marker after confirmation', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const failed = job({
      status: 'failed', phase: 'complete', cancellable: false, retryable: true, discardable: true,
      retry: { kind: 'main_candidates', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' },
      error: { code: 'PROVIDER_HTTP_ERROR', message: 'Sanitisiert' },
    });
    const retried = job({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID, status: 'queued', phase: 'queued' });
    const retryJob = vi.fn().mockResolvedValue(retried);
    const controller = createRoomImageWizardController({
      api: api({ getJob: vi.fn().mockResolvedValue(failed), retryJob }), storage,
      uuid: () => NEW_UUID, scheduler: new FakeScheduler(),
    });
    await controller.resume();

    await controller.retry();

    expect(retryJob).toHaveBeenCalledWith(JOB_ID, {
      clientRequestId: NEW_UUID,
      noticeVersion: 'room-image-v1',
      costConfirmed: true,
      confirmedProviderCalls: 2,
    });
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBe(JSON.stringify({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID }));
    expect(JSON.stringify(retryJob.mock.calls[0][1])).not.toMatch(/upload|candidate|source|prompt/i);
  });

  it('commits a matching retry accepted after close without reopening state or polling', async () => {
    const pending = deferred<RoomImageJob>();
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const failed = job({
      status: 'failed', phase: 'complete', cancellable: false, retryable: true, discardable: true,
      retry: { kind: 'main_candidates', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' },
      error: { code: 'PROVIDER_HTTP_ERROR', message: 'Sanitisiert' },
    });
    const roomApi = api({
      getJob: vi.fn().mockResolvedValue(failed),
      retryJob: vi.fn().mockReturnValue(pending.promise),
    });
    const controller = createRoomImageWizardController({
      api: roomApi, storage, uuid: () => NEW_UUID, scheduler,
    });
    await controller.resume();

    const retry = controller.retry();
    await Promise.resolve();
    expect(roomApi.retryJob).toHaveBeenCalledTimes(1);
    controller.close();
    pending.resolve(job({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID, status: 'queued', phase: 'queued' }));
    await retry;

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBe(JSON.stringify({
      jobId: NEW_JOB_ID, clientRequestId: NEW_UUID,
    }));
    expect(controller.state()).toMatchObject({ lifecycle: 'closed', polling: false, error: null });
    expect(scheduler.pending.size).toBe(0);
    expect(roomApi.createJob).not.toHaveBeenCalled();
    expect(roomApi.cancelJob).not.toHaveBeenCalled();
    expect(roomApi.discardJob).not.toHaveBeenCalled();
    expect(roomApi.publishJob).not.toHaveBeenCalled();
  });

  it('lets explicit forget suppress a late matching retry acceptance', async () => {
    const pending = deferred<RoomImageJob>();
    const scheduler = new FakeScheduler();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const failed = job({
      status: 'failed', phase: 'complete', cancellable: false, retryable: true, discardable: true,
      retry: { kind: 'main_candidates', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' },
      error: { code: 'PROVIDER_HTTP_ERROR', message: 'Sanitisiert' },
    });
    const controller = createRoomImageWizardController({
      api: api({
        getJob: vi.fn().mockResolvedValue(failed),
        retryJob: vi.fn().mockReturnValue(pending.promise),
      }),
      storage,
      uuid: () => NEW_UUID,
      scheduler,
    });
    await controller.resume();

    const retry = controller.retry();
    await Promise.resolve();
    controller.forget();
    pending.resolve(job({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID, status: 'queued', phase: 'queued' }));
    await retry;

    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();
    expect(controller.state()).toMatchObject({ lifecycle: 'idle', job: null, polling: false, error: null });
    expect(scheduler.pending.size).toBe(0);
  });

  it('shares single-flight between retry and create without a second request or UUID', async () => {
    const pending = deferred<RoomImageJob>();
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const failed = job({
      status: 'failed', phase: 'complete', cancellable: false, retryable: true, discardable: true,
      retry: { kind: 'main_candidates', requiredProviderCalls: 2, noticeVersion: 'room-image-v1' },
      error: { code: 'PROVIDER_HTTP_ERROR', message: 'Sanitisiert' },
    });
    const retryJob = vi.fn().mockReturnValue(pending.promise);
    const createJob = vi.fn();
    const uuid = vi.fn().mockReturnValueOnce(NEW_UUID).mockReturnValueOnce(UUID);
    const controller = createRoomImageWizardController({
      api: api({ getJob: vi.fn().mockResolvedValue(failed), retryJob, createJob }),
      storage,
      uuid,
      scheduler: new FakeScheduler(),
    });
    await controller.resume();

    const retry = controller.retry();
    const create = controller.createMainJob(mainDraft());
    await Promise.resolve();

    expect(create).toBe(retry);
    expect(uuid).toHaveBeenCalledTimes(1);
    expect(retryJob).toHaveBeenCalledTimes(1);
    expect(createJob).not.toHaveBeenCalled();

    pending.resolve(job({ jobId: NEW_JOB_ID, clientRequestId: NEW_UUID, status: 'queued', phase: 'queued' }));
    await Promise.all([retry, create]);
  });

  it.each([
    ['FEATURE_DISABLED', { enabled: false, imageCapability: 'disabled', reasonCode: 'FEATURE_DISABLED' }],
    ['AUTH_BOUNDARY_MISSING', { enabled: false, imageCapability: 'disabled', reasonCode: 'AUTH_BOUNDARY_MISSING' }],
    ['CREDENTIAL_MISSING', { enabled: false, imageCapability: 'disabled', reasonCode: 'CREDENTIAL_MISSING' }],
    ['UNVERIFIED', { enabled: true, imageCapability: 'unverified', reasonCode: 'UNVERIFIED' }],
    ['ready', { enabled: true, imageCapability: 'ready', reasonCode: null }],
  ] satisfies Array<[string, RoomImageCapability]>)(
    'projects public capability state %s through loadCapability()',
    async (_label, capability) => {
      const controller = createRoomImageWizardController({
        api: api({ getCapability: vi.fn().mockResolvedValue(capability) }),
        storage: new MemoryStorage(),
        uuid: () => UUID,
      });
      await controller.loadCapability();
      expect(controller.state().capability).toEqual({ public: capability, details: null, error: null });
    },
  );

  it.each([
    'disabled', 'credential_missing', 'credential_invalid', 'forbidden',
    'unreachable', 'unverified', 'ready',
  ] satisfies RoomImageCapabilityDetails['imageCapability'][])(
    'projects private capability state %s through loadCapabilityDetails()',
    async (imageCapability) => {
      const details = capabilityDetails(imageCapability);
      const controller = createRoomImageWizardController({
        api: api({ getCapabilityDetails: vi.fn().mockResolvedValue(details) }),
        storage: new MemoryStorage(),
        uuid: () => UUID,
      });
      await controller.loadCapabilityDetails();
      expect(controller.state().capability).toEqual({ public: null, details, error: null });
    },
  );

  it.each([
    [401, 'ROOM_IMAGE_AUTH_REQUIRED'],
    [403, 'ROOM_IMAGE_AUTH_FORBIDDEN'],
    [403, 'ORIGIN_FORBIDDEN'],
    [503, 'AUTH_BOUNDARY_MISSING'],
  ])('keeps controller capability HTTP %i %s closed', async (status, code) => {
    const controller = createRoomImageWizardController({
      api: api({ getCapabilityDetails: vi.fn().mockRejectedValue(new RoomImageClientError(
        'http', status, code, 'Sanitisierter Capabilityfehler', false,
      )) }),
      storage: new MemoryStorage(),
      uuid: () => UUID,
    });

    await controller.loadCapabilityDetails();

    expect(controller.state().capability).toMatchObject({
      public: null,
      details: null,
      error: { kind: 'http', status, code, message: 'Sanitisierter Capabilityfehler' },
    });
  });

  it('models capability/auth degradation without probing automatically or degrading an auth error to ready', async () => {
    const roomApi = api({
      getCapability: vi.fn().mockResolvedValue({ enabled: true, imageCapability: 'unverified', reasonCode: 'UNVERIFIED' }),
      getCapabilityDetails: vi.fn().mockRejectedValue(new RoomImageClientError(
        'http', 401, 'ROOM_IMAGE_AUTH_REQUIRED', 'Authentifizierung erforderlich.', false,
      )),
      probeCapability: vi.fn().mockResolvedValue({
        enabled: false, provider: 'openai', credentialConfigured: true, credentialSource: 'environment',
        credentialMode: 'api_key', imageCapability: 'credential_invalid', reasonCode: null,
        model: 'gpt-image-2-2026-04-21', probe: { modelVisible: false, checkedAt: '2026-08-09T10:00:00.000Z' },
        limits: { maxUploadBytes: 12582912, maxDecodedPixels: 24000000, maxMainCandidates: 2, maxConcurrentProviderCalls: 1, maxQueuedJobs: 3 },
      }),
    });
    const controller = createRoomImageWizardController({ api: roomApi, storage: new MemoryStorage(), uuid: () => UUID });

    await controller.loadCapability();
    await controller.loadCapabilityDetails();
    expect(roomApi.probeCapability).not.toHaveBeenCalled();
    expect(controller.state().capability).toMatchObject({
      public: { imageCapability: 'unverified' }, details: null,
      error: { kind: 'http', status: 401, code: 'ROOM_IMAGE_AUTH_REQUIRED' },
    });
    await controller.probeCapability();
    expect(controller.state().capability).toMatchObject({
      public: { imageCapability: 'unverified' }, details: { imageCapability: 'credential_invalid' }, error: null,
    });
  });

  it('uses explicit cancel/discard/publish actions and only successful cleanup removes the marker', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    const cancelled = job({ status: 'cancelled', phase: 'complete', cancellable: false, discardable: true, error: { code: 'JOB_CANCELLED', message: 'Abgebrochen' } });
    const published = job({ kind: 'variant_set', status: 'succeeded', phase: 'complete', cancellable: false, asset: {
      assetId: 'asset_01',
      variants: { light: '/assets/room-images/asset_01/light.avif', dark: '/assets/room-images/asset_01/dark.avif', darkOff: '/assets/room-images/asset_01/dark-off.avif' },
      focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
    } });
    const roomApi = api({
      getJob: vi.fn().mockResolvedValue(published),
      cancelJob: vi.fn().mockResolvedValue(cancelled),
      discardJob: vi.fn().mockResolvedValue(undefined),
      publishJob: vi.fn().mockResolvedValue(published.asset),
    });
    const controller = createRoomImageWizardController({ api: roomApi, storage, uuid: () => UUID });
    await controller.resume();

    await controller.cancel();
    expect(roomApi.cancelJob).toHaveBeenCalledWith(JOB_ID);
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).not.toBeNull();

    await controller.publish(true);
    expect(roomApi.publishJob).toHaveBeenCalledWith(JOB_ID, true);
    expect(roomApi.getJob).toHaveBeenCalledTimes(2);

    await controller.discard();
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();

    storage.setItem(ROOM_IMAGE_RESUME_KEY, JSON.stringify({ jobId: JOB_ID, clientRequestId: UUID }));
    await controller.resume();
    roomApi.discardJob = vi.fn().mockRejectedValue(new RoomImageClientError(
      'http', 404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Nicht gefunden.', false,
    ));
    await controller.discard();
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).not.toBeNull();

    controller.forget();
    expect(storage.getItem(ROOM_IMAGE_RESUME_KEY)).toBeNull();
  });
});
