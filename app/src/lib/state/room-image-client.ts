export type RoomImageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RoomImageId = string;
export type ClientRequestId = string;
export type RoomImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';
export type RoomImageJobKind = 'main_candidates' | 'variant_set';
export type RoomImageJobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'superseded'
  | 'awaiting_confirmation';
export type RoomImageJobPhase =
  | 'queued'
  | 'generating_composition'
  | 'generating_style_1'
  | 'generating_style_2'
  | 'generating_dark'
  | 'generating_dark_off'
  | 'validating_set'
  | 'awaiting_confirmation'
  | 'publishing_set'
  | 'complete';

export interface RoomImagePoint { x: number; y: number }
export interface RoomImageFocus { panel: RoomImagePoint; phone: RoomImagePoint }
export interface RoomImageCrop { x: number; y: number; width: number; height: number }
export interface RoomImageCanonicalCropPixels { x: number; y: number; width: number; height: number }

export type RoomImagePreserveFeature =
  | 'windows'
  | 'doors'
  | 'built_ins'
  | 'signature_furniture'
  | 'wall_art';

export interface MainCandidatesJobRequest {
  kind: 'main_candidates';
  clientRequestId: string;
  uploadId: string;
  crop: RoomImageCrop;
  canonicalCropPixels: RoomImageCanonicalCropPixels;
  focus: RoomImageFocus;
  stylePreset: 'hauser-room-v1';
  adjustments: {
    declutter: 'none' | 'light' | 'strong';
    tone: 'neutral' | 'warm' | 'cool';
    preserveFeatures: RoomImagePreserveFeature[];
  };
  candidateCount: 1 | 2;
  noticeVersion: 'room-image-v1';
  costConfirmed: true;
  confirmedProviderCalls: 2 | 3;
}

export interface VariantSetJobRequest {
  kind: 'variant_set';
  clientRequestId: string;
  parentJobId: string;
  candidateId: string;
  focus: RoomImageFocus;
  noticeVersion: 'room-image-v1';
  costConfirmed: true;
  confirmedProviderCalls: 2;
}

export type RoomImageJobRequest = MainCandidatesJobRequest | VariantSetJobRequest;

export interface RoomImageRetryRequest {
  clientRequestId: string;
  noticeVersion: 'room-image-v1';
  costConfirmed: true;
  confirmedProviderCalls: 1 | 2 | 3;
}

export type RoomImageCapabilityReason =
  | 'FEATURE_DISABLED'
  | 'AUTH_BOUNDARY_MISSING'
  | 'CREDENTIAL_MISSING'
  | 'UNVERIFIED';

export interface RoomImageCapability {
  enabled: boolean;
  imageCapability: 'disabled' | 'unverified' | 'ready';
  reasonCode: RoomImageCapabilityReason | null;
}

export interface RoomImageCapabilityDetails {
  enabled: boolean;
  provider: 'openai';
  credentialConfigured: boolean;
  credentialSource: 'environment' | 'stored' | null;
  credentialMode: 'api_key' | 'chatgpt' | null;
  imageCapability:
    | 'disabled'
    | 'credential_missing'
    | 'credential_invalid'
    | 'forbidden'
    | 'unreachable'
    | 'unverified'
    | 'ready';
  reasonCode: 'CREDENTIAL_MISSING' | null;
  model: 'gpt-image-2-2026-04-21' | 'gpt-image-2';
  probe: { modelVisible: boolean; checkedAt: string | null };
  limits: {
    maxUploadBytes: number;
    maxDecodedPixels: number;
    maxMainCandidates: 2;
    maxConcurrentProviderCalls: 1;
    maxQueuedJobs: 3;
  };
}

export interface RoomImageUpload {
  uploadId: string;
  width: number;
  height: number;
  mimeType: RoomImageMimeType;
  expiresAt: string;
}

export interface RoomImageAttemptCounters {
  confirmedCount: number;
  plannedCount: number;
  startedCount: number;
  completedCount: number;
  outcomeUnknownCount: number;
}

export interface RoomImageAggregateCounters {
  plannedCount: number;
  startedCount: number;
  completedCount: number;
  outcomeUnknownCount: number;
}

export interface RoomImageProviderCalls {
  attempt: RoomImageAttemptCounters;
  lineage: RoomImageAggregateCounters;
  wizard: RoomImageAggregateCounters;
}

export interface RoomImageCandidate {
  candidateId: string;
  previewUrl: string;
  suggestedRoomId: null;
}

export interface RoomImageTemporaryVariants {
  light: string;
  dark: string;
  darkOff: string;
}

export interface RoomImageAsset {
  assetId: string;
  variants: {
    light: string;
    dark: string;
    darkOff: string;
  };
  focus: RoomImageFocus;
}

export interface RoomImageRetryDescriptor {
  kind: RoomImageJobKind;
  requiredProviderCalls: 1 | 2 | 3;
  noticeVersion: 'room-image-v1';
}

export interface RoomImageJobError {
  code: string;
  message: string;
}

export interface RoomImageJob {
  jobId: string;
  kind: RoomImageJobKind;
  clientRequestId: string;
  attemptId: string;
  parentAttemptId: string | null;
  lineageId: string;
  status: RoomImageJobStatus;
  phase: RoomImageJobPhase;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  cancellable: boolean;
  retryable: boolean;
  discardable: boolean;
  retry: RoomImageRetryDescriptor | null;
  supersededByJobId: string | null;
  providerCalls: RoomImageProviderCalls;
  candidates: RoomImageCandidate[];
  temporaryVariants?: RoomImageTemporaryVariants;
  focus?: RoomImageFocus;
  asset: RoomImageAsset | null;
  error: RoomImageJobError | null;
}

export type RoomImageClientErrorKind =
  | 'invalid_request'
  | 'http'
  | 'invalid_response'
  | 'network'
  | 'abort';

export class RoomImageClientError extends Error {
  constructor(
    readonly kind: RoomImageClientErrorKind,
    readonly status: number | null,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'RoomImageClientError';
  }

  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      status: this.status,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export interface RoomImageApi {
  getCapability(): Promise<RoomImageCapability>;
  getCapabilityDetails(): Promise<RoomImageCapabilityDetails>;
  probeCapability(): Promise<RoomImageCapabilityDetails>;
  upload(data: Blob | ArrayBuffer, mimeType: RoomImageMimeType): Promise<RoomImageUpload>;
  deleteUpload(uploadId: string): Promise<void>;
  createJob(request: RoomImageJobRequest): Promise<RoomImageJob>;
  getJob(jobId: string, options?: { signal?: AbortSignal }): Promise<RoomImageJob>;
  retryJob(jobId: string, request: RoomImageRetryRequest): Promise<RoomImageJob>;
  cancelJob(jobId: string): Promise<RoomImageJob>;
  discardJob(jobId: string): Promise<void>;
  publishJob(jobId: string, confirmed: true): Promise<RoomImageAsset>;
}

interface RoomImageClientOptions {
  fetchImpl?: RoomImageFetch;
}

type JsonObject = Record<string, unknown>;
type Parser<T> = (value: unknown) => T | null;

const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ASSET_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MIME_TYPES: readonly RoomImageMimeType[] = ['image/jpeg', 'image/png', 'image/webp'];
const JOB_KINDS: readonly RoomImageJobKind[] = ['main_candidates', 'variant_set'];
const JOB_STATUSES: readonly RoomImageJobStatus[] = [
  'queued', 'running', 'cancelling', 'cancelled', 'succeeded', 'failed', 'expired',
  'superseded', 'awaiting_confirmation',
];
const JOB_PHASES: readonly RoomImageJobPhase[] = [
  'queued', 'generating_composition', 'generating_style_1', 'generating_style_2',
  'generating_dark', 'generating_dark_off', 'validating_set', 'awaiting_confirmation',
  'publishing_set', 'complete',
];
const PRESERVE_FEATURES: readonly RoomImagePreserveFeature[] = [
  'windows', 'doors', 'built_ins', 'signature_furniture', 'wall_art',
];
const PRIVATE_CAPABILITIES = [
  'disabled', 'credential_missing', 'credential_invalid', 'forbidden', 'unreachable',
  'unverified', 'ready',
] as const;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function exact(value: unknown, keys: readonly string[]): value is JsonObject {
  const candidate = object(value);
  if (!candidate) return false;
  const actual = Object.keys(candidate).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function oneOf<T extends string | number | null>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function opaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID.test(value);
}

export function isRoomImageClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function isRoomImageOpaqueId(value: unknown): value is string {
  return opaqueId(value);
}

function invalidRequest(): RoomImageClientError {
  return new RoomImageClientError(
    'invalid_request', null, 'INVALID_REQUEST', 'Die Room-Image-Anfrage ist ungültig.', false,
  );
}

function invalidResponse(): RoomImageClientError {
  return new RoomImageClientError(
    'invalid_response', null, 'INVALID_RESPONSE', 'Die Room-Image-Antwort ist ungültig.', false,
  );
}

function point(value: unknown): RoomImagePoint | null {
  if (!exact(value, ['x', 'y']) || !finite(value.x) || !finite(value.y)
      || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) return null;
  return { x: value.x, y: value.y };
}

function focus(value: unknown): RoomImageFocus | null {
  if (!exact(value, ['panel', 'phone'])) return null;
  const panel = point(value.panel);
  const phone = point(value.phone);
  return panel && phone ? { panel, phone } : null;
}

function crop(value: unknown): RoomImageCrop | null {
  if (!exact(value, ['x', 'y', 'width', 'height'])
      || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)
      || value.x < 0 || value.y < 0 || value.width < 0.2 || value.height < 0.2
      || value.x + value.width > 1 || value.y + value.height > 1) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function canonicalCrop(value: unknown): RoomImageCanonicalCropPixels | null {
  if (!exact(value, ['x', 'y', 'width', 'height'])
      || !nonNegativeInteger(value.x) || !nonNegativeInteger(value.y)
      || !nonNegativeInteger(value.width) || !nonNegativeInteger(value.height)
      || value.width < 1 || value.height < 1) return null;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function parseCapability(value: unknown): RoomImageCapability | null {
  if (!exact(value, ['enabled', 'imageCapability', 'reasonCode'])
      || typeof value.enabled !== 'boolean'
      || !oneOf(value.imageCapability, ['disabled', 'unverified', 'ready'] as const)) return null;
  const reason = value.reasonCode;
  const validReason = reason === null || oneOf(reason, [
    'FEATURE_DISABLED', 'AUTH_BOUNDARY_MISSING', 'CREDENTIAL_MISSING', 'UNVERIFIED',
  ] as const);
  if (!validReason) return null;
  if (value.imageCapability === 'ready') {
    if (!value.enabled || reason !== null) return null;
  } else if (value.imageCapability === 'unverified') {
    if (!value.enabled || reason !== 'UNVERIFIED') return null;
  } else if (value.enabled || !['FEATURE_DISABLED', 'AUTH_BOUNDARY_MISSING', 'CREDENTIAL_MISSING'].includes(String(reason))) {
    return null;
  }
  return { enabled: value.enabled, imageCapability: value.imageCapability, reasonCode: reason };
}

function parseDetails(value: unknown): RoomImageCapabilityDetails | null {
  if (!exact(value, [
    'enabled', 'provider', 'credentialConfigured', 'credentialSource', 'imageCapability',
    'credentialMode', 'reasonCode', 'model', 'probe', 'limits',
  ])
      || typeof value.enabled !== 'boolean' || value.provider !== 'openai'
      || typeof value.credentialConfigured !== 'boolean'
      || !oneOf(value.credentialSource, ['environment', 'stored', null] as const)
      || !oneOf(value.credentialMode, ['api_key', 'chatgpt', null] as const)
      || !oneOf(value.imageCapability, PRIVATE_CAPABILITIES)
      || !oneOf(value.reasonCode, ['CREDENTIAL_MISSING', null] as const)
      || !oneOf(value.model, ['gpt-image-2-2026-04-21', 'gpt-image-2'] as const)
      || !exact(value.probe, ['modelVisible', 'checkedAt'])
      || typeof value.probe.modelVisible !== 'boolean'
      || !(value.probe.checkedAt === null || timestamp(value.probe.checkedAt))
      || !exact(value.limits, [
        'maxUploadBytes', 'maxDecodedPixels', 'maxMainCandidates',
        'maxConcurrentProviderCalls', 'maxQueuedJobs',
      ])
      || !nonNegativeInteger(value.limits.maxUploadBytes) || value.limits.maxUploadBytes < 1
      || !nonNegativeInteger(value.limits.maxDecodedPixels) || value.limits.maxDecodedPixels < 1
      || value.limits.maxMainCandidates !== 2
      || value.limits.maxConcurrentProviderCalls !== 1
      || value.limits.maxQueuedJobs !== 3) return null;
  return {
    enabled: value.enabled,
    provider: 'openai',
    credentialConfigured: value.credentialConfigured,
    credentialSource: value.credentialSource,
    credentialMode: value.credentialMode,
    imageCapability: value.imageCapability,
    reasonCode: value.reasonCode,
    model: value.model,
    probe: { modelVisible: value.probe.modelVisible, checkedAt: value.probe.checkedAt },
    limits: {
      maxUploadBytes: value.limits.maxUploadBytes,
      maxDecodedPixels: value.limits.maxDecodedPixels,
      maxMainCandidates: 2,
      maxConcurrentProviderCalls: 1,
      maxQueuedJobs: 3,
    },
  };
}

function parseUpload(value: unknown): RoomImageUpload | null {
  if (!exact(value, ['uploadId', 'width', 'height', 'mimeType', 'expiresAt'])
      || !opaqueId(value.uploadId) || !nonNegativeInteger(value.width) || value.width < 1
      || !nonNegativeInteger(value.height) || value.height < 1
      || !oneOf(value.mimeType, MIME_TYPES) || !timestamp(value.expiresAt)) return null;
  return {
    uploadId: value.uploadId,
    width: value.width,
    height: value.height,
    mimeType: value.mimeType,
    expiresAt: value.expiresAt,
  };
}

function parseAggregateCounters(value: unknown): RoomImageAggregateCounters | null {
  if (!exact(value, ['plannedCount', 'startedCount', 'completedCount', 'outcomeUnknownCount'])
      || !nonNegativeInteger(value.plannedCount) || !nonNegativeInteger(value.startedCount)
      || !nonNegativeInteger(value.completedCount) || !nonNegativeInteger(value.outcomeUnknownCount)
      || value.startedCount > value.plannedCount
      || value.completedCount + value.outcomeUnknownCount > value.startedCount) return null;
  return {
    plannedCount: value.plannedCount,
    startedCount: value.startedCount,
    completedCount: value.completedCount,
    outcomeUnknownCount: value.outcomeUnknownCount,
  };
}

function parseAttemptCounters(value: unknown): RoomImageAttemptCounters | null {
  if (!exact(value, [
    'confirmedCount', 'plannedCount', 'startedCount', 'completedCount', 'outcomeUnknownCount',
  ]) || !nonNegativeInteger(value.confirmedCount)) return null;
  const aggregate = parseAggregateCounters({
    plannedCount: value.plannedCount,
    startedCount: value.startedCount,
    completedCount: value.completedCount,
    outcomeUnknownCount: value.outcomeUnknownCount,
  });
  if (!aggregate || aggregate.plannedCount > value.confirmedCount) return null;
  return { confirmedCount: value.confirmedCount, ...aggregate };
}

function parseProviderCalls(value: unknown): RoomImageProviderCalls | null {
  if (!exact(value, ['attempt', 'lineage', 'wizard'])) return null;
  const attempt = parseAttemptCounters(value.attempt);
  const lineage = parseAggregateCounters(value.lineage);
  const wizard = parseAggregateCounters(value.wizard);
  return attempt && lineage && wizard ? { attempt, lineage, wizard } : null;
}

function parseRetry(value: unknown): RoomImageRetryDescriptor | null {
  if (!exact(value, ['kind', 'requiredProviderCalls', 'noticeVersion'])
      || !oneOf(value.kind, JOB_KINDS)
      || !oneOf(value.requiredProviderCalls, [1, 2, 3] as const)
      || value.noticeVersion !== 'room-image-v1') return null;
  return {
    kind: value.kind,
    requiredProviderCalls: value.requiredProviderCalls,
    noticeVersion: 'room-image-v1',
  };
}

function parseJobError(value: unknown): RoomImageJobError | null {
  if (!exact(value, ['code', 'message']) || typeof value.code !== 'string'
      || !SAFE_CODE.test(value.code) || typeof value.message !== 'string'
      || value.message.length < 1 || value.message.length > 1_000) return null;
  return { code: value.code, message: value.message };
}

function parseCandidate(value: unknown, jobId: string): RoomImageCandidate | null {
  if (!exact(value, ['candidateId', 'previewUrl', 'suggestedRoomId'])
      || !opaqueId(value.candidateId) || typeof value.previewUrl !== 'string'
      || value.previewUrl !== `/api/room-image-jobs/${jobId}/previews/${value.candidateId}`
      || value.suggestedRoomId !== null) return null;
  return { candidateId: value.candidateId, previewUrl: value.previewUrl, suggestedRoomId: null };
}

function parseTemporaryVariants(value: unknown, jobId: string): RoomImageTemporaryVariants | null {
  if (!exact(value, ['light', 'dark', 'darkOff'])
      || value.light !== `/api/room-image-jobs/${jobId}/final-previews/light`
      || value.dark !== `/api/room-image-jobs/${jobId}/final-previews/dark`
      || value.darkOff !== `/api/room-image-jobs/${jobId}/final-previews/dark-off`) return null;
  return { light: value.light, dark: value.dark, darkOff: value.darkOff };
}

function parseAsset(value: unknown): RoomImageAsset | null {
  if (!exact(value, ['assetId', 'variants', 'focus'])
      || typeof value.assetId !== 'string' || !ASSET_ID.test(value.assetId)
      || !exact(value.variants, ['light', 'dark', 'darkOff'])) return null;
  const expected = `/assets/room-images/${value.assetId}`;
  if (value.variants.light !== `${expected}/light.avif`
      || value.variants.dark !== `${expected}/dark.avif`
      || value.variants.darkOff !== `${expected}/dark-off.avif`) return null;
  const parsedFocus = focus(value.focus);
  return parsedFocus ? {
    assetId: value.assetId,
    variants: {
      light: value.variants.light,
      dark: value.variants.dark,
      darkOff: value.variants.darkOff,
    },
    focus: parsedFocus,
  } : null;
}

function parseJob(value: unknown): RoomImageJob | null {
  const candidate = object(value);
  if (!candidate) return null;
  const hasTemporary = Object.hasOwn(candidate, 'temporaryVariants') || Object.hasOwn(candidate, 'focus');
  const keys = [
    'jobId', 'kind', 'clientRequestId', 'attemptId', 'parentAttemptId', 'lineageId',
    'status', 'phase', 'createdAt', 'updatedAt', 'expiresAt', 'cancellable', 'retryable',
    'discardable', 'retry', 'supersededByJobId', 'providerCalls', 'candidates', 'asset', 'error',
    ...(hasTemporary ? ['temporaryVariants', 'focus'] : []),
  ];
  if (!exact(candidate, keys)
      || !opaqueId(candidate.jobId) || !oneOf(candidate.kind, JOB_KINDS)
      || !isRoomImageClientRequestId(candidate.clientRequestId)
      || !opaqueId(candidate.attemptId)
      || !(candidate.parentAttemptId === null || opaqueId(candidate.parentAttemptId))
      || !opaqueId(candidate.lineageId)
      || !oneOf(candidate.status, JOB_STATUSES) || !oneOf(candidate.phase, JOB_PHASES)
      || !timestamp(candidate.createdAt) || !timestamp(candidate.updatedAt) || !timestamp(candidate.expiresAt)
      || typeof candidate.cancellable !== 'boolean' || typeof candidate.retryable !== 'boolean'
      || typeof candidate.discardable !== 'boolean'
      || !(candidate.supersededByJobId === null || opaqueId(candidate.supersededByJobId))
      || !Array.isArray(candidate.candidates)) return null;

  const jobId = candidate.jobId as string;
  const providerCalls = parseProviderCalls(candidate.providerCalls);
  const candidates = candidate.candidates.map((entry) => parseCandidate(entry, jobId));
  if (!providerCalls || candidates.some((entry) => entry === null)
      || (candidate.kind !== 'main_candidates' && candidates.length !== 0)
      || (candidate.status !== 'succeeded' && candidates.length !== 0)
      || (candidate.kind === 'main_candidates' && candidate.status === 'succeeded' && candidates.length > 2)
      || new Set(candidates.map((entry) => entry?.candidateId)).size !== candidates.length) return null;

  const retry = candidate.retry === null ? null : parseRetry(candidate.retry);
  if ((candidate.retry !== null && !retry) || candidate.retryable !== (retry !== null)) return null;
  if (retry && retry.kind !== candidate.kind) return null;
  if (candidate.status === 'superseded') {
    if (candidate.supersededByJobId === null) return null;
  } else if (candidate.supersededByJobId !== null) return null;

  const error = candidate.error === null ? null : parseJobError(candidate.error);
  if (candidate.error !== null && !error) return null;
  const activeState = ['queued', 'running', 'cancelling', 'succeeded', 'awaiting_confirmation'].includes(candidate.status);
  if ((activeState && error !== null) || (!activeState && error === null)) return null;

  const temporaryVariants = hasTemporary
    ? parseTemporaryVariants(candidate.temporaryVariants, candidate.jobId)
    : null;
  const parsedFocus = hasTemporary ? focus(candidate.focus) : null;
  const requiresTemporaryVariants = candidate.kind === 'variant_set'
    && candidate.status === 'awaiting_confirmation'
    && candidate.phase === 'awaiting_confirmation';
  if (requiresTemporaryVariants && !hasTemporary) return null;
  if (hasTemporary && (!temporaryVariants || !parsedFocus
      || candidate.kind !== 'variant_set'
      || candidate.status !== 'awaiting_confirmation'
      || candidate.phase !== 'awaiting_confirmation')) return null;

  const asset = candidate.asset === null ? null : parseAsset(candidate.asset);
  if (candidate.asset !== null && !asset) return null;
  if (candidate.kind === 'variant_set' && candidate.status === 'succeeded'
      && candidate.phase === 'complete' && !asset) return null;
  if (asset && (candidate.kind !== 'variant_set' || candidate.status !== 'succeeded' || candidate.phase !== 'complete')) return null;

  return {
    jobId: candidate.jobId,
    kind: candidate.kind,
    clientRequestId: candidate.clientRequestId,
    attemptId: candidate.attemptId,
    parentAttemptId: candidate.parentAttemptId,
    lineageId: candidate.lineageId,
    status: candidate.status,
    phase: candidate.phase,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    expiresAt: candidate.expiresAt,
    cancellable: candidate.cancellable,
    retryable: candidate.retryable,
    discardable: candidate.discardable,
    retry,
    supersededByJobId: candidate.supersededByJobId,
    providerCalls,
    candidates: candidates as RoomImageCandidate[],
    ...(temporaryVariants && parsedFocus ? { temporaryVariants, focus: parsedFocus } : {}),
    asset,
    error,
  };
}

function rebuildMain(request: MainCandidatesJobRequest): MainCandidatesJobRequest {
  if (request.kind !== 'main_candidates' || !isRoomImageClientRequestId(request.clientRequestId)
      || !opaqueId(request.uploadId) || request.stylePreset !== 'hauser-room-v1'
      || request.noticeVersion !== 'room-image-v1' || request.costConfirmed !== true
      || !oneOf(request.candidateCount, [1, 2] as const)
      || request.confirmedProviderCalls !== request.candidateCount + 1) throw invalidRequest();
  const parsedCrop = crop(request.crop);
  const pixels = canonicalCrop(request.canonicalCropPixels);
  const parsedFocus = focus(request.focus);
  const adjustments = object(request.adjustments);
  if (!parsedCrop || !pixels || !parsedFocus || !adjustments
      || !oneOf(adjustments.declutter, ['none', 'light', 'strong'] as const)
      || !oneOf(adjustments.tone, ['neutral', 'warm', 'cool'] as const)
      || !Array.isArray(adjustments.preserveFeatures)
      || !adjustments.preserveFeatures.every((entry): entry is RoomImagePreserveFeature => oneOf(entry, PRESERVE_FEATURES))
      || new Set(adjustments.preserveFeatures).size !== adjustments.preserveFeatures.length) throw invalidRequest();
  return {
    kind: 'main_candidates',
    clientRequestId: request.clientRequestId,
    uploadId: request.uploadId,
    crop: parsedCrop,
    canonicalCropPixels: pixels,
    focus: parsedFocus,
    stylePreset: 'hauser-room-v1',
    adjustments: {
      declutter: adjustments.declutter,
      tone: adjustments.tone,
      preserveFeatures: [...adjustments.preserveFeatures],
    },
    candidateCount: request.candidateCount,
    noticeVersion: 'room-image-v1',
    costConfirmed: true,
    confirmedProviderCalls: request.confirmedProviderCalls,
  };
}

function rebuildFinal(request: VariantSetJobRequest): VariantSetJobRequest {
  const parsedFocus = focus(request.focus);
  if (request.kind !== 'variant_set' || !isRoomImageClientRequestId(request.clientRequestId)
      || !opaqueId(request.parentJobId) || !opaqueId(request.candidateId) || !parsedFocus
      || request.noticeVersion !== 'room-image-v1' || request.costConfirmed !== true
      || request.confirmedProviderCalls !== 2) throw invalidRequest();
  return {
    kind: 'variant_set',
    clientRequestId: request.clientRequestId,
    parentJobId: request.parentJobId,
    candidateId: request.candidateId,
    focus: parsedFocus,
    noticeVersion: 'room-image-v1',
    costConfirmed: true,
    confirmedProviderCalls: 2,
  };
}

function rebuildRetry(request: RoomImageRetryRequest): RoomImageRetryRequest {
  if (!isRoomImageClientRequestId(request.clientRequestId)
      || request.noticeVersion !== 'room-image-v1' || request.costConfirmed !== true
      || !oneOf(request.confirmedProviderCalls, [1, 2, 3] as const)) throw invalidRequest();
  return {
    clientRequestId: request.clientRequestId,
    noticeVersion: 'room-image-v1',
    costConfirmed: true,
    confirmedProviderCalls: request.confirmedProviderCalls,
  };
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

function isJsonResponse(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return /^application\/json(?:\s*;|$)/i.test(type);
}

async function unknownJson(response: Response): Promise<unknown | null> {
  if (!isJsonResponse(response)) return null;
  try { return await response.json() as unknown; } catch { return null; }
}

function parseHttpError(value: unknown, status: number): RoomImageClientError {
  if (exact(value, ['ok', 'code', 'message', 'retryable']) && value.ok === false
      && typeof value.code === 'string' && SAFE_CODE.test(value.code)
      && typeof value.message === 'string' && value.message.length > 0 && value.message.length <= 1_000
      && typeof value.retryable === 'boolean') {
    return new RoomImageClientError('http', status, value.code, value.message, value.retryable);
  }
  return new RoomImageClientError(
    'http', status, 'HTTP_ERROR', 'Die Room-Image-Anfrage ist fehlgeschlagen.', false,
  );
}

async function fetchResponse(fetchImpl: RoomImageFetch, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(path, { ...init, credentials: 'same-origin' });
  } catch (error) {
    if (error instanceof RoomImageClientError) throw error;
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new RoomImageClientError('abort', null, 'ABORTED', 'Die Room-Image-Anfrage wurde abgebrochen.', false);
    }
    throw new RoomImageClientError('network', null, 'NETWORK_ERROR', 'Die Room-Image-Route ist nicht erreichbar.', false);
  }
}

async function requestJson<T>(
  fetchImpl: RoomImageFetch,
  path: string,
  init: RequestInit,
  parser: Parser<T>,
): Promise<T> {
  const response = await fetchResponse(fetchImpl, path, init);
  const payload = await unknownJson(response);
  if (!response.ok) throw parseHttpError(payload, response.status);
  if (payload === null) throw invalidResponse();
  const parsed = parser(payload);
  if (!parsed) throw invalidResponse();
  return parsed;
}

async function requestEmpty(fetchImpl: RoomImageFetch, path: string, init: RequestInit): Promise<void> {
  const response = await fetchResponse(fetchImpl, path, init);
  if (response.ok && response.status === 204) return;
  const payload = await unknownJson(response);
  if (!response.ok) throw parseHttpError(payload, response.status);
  throw invalidResponse();
}

function jobPath(jobId: string): string {
  if (!opaqueId(jobId)) throw invalidRequest();
  return `/api/room-image-jobs/${encodeURIComponent(jobId)}`;
}

function uploadPath(uploadId: string): string {
  if (!opaqueId(uploadId)) throw invalidRequest();
  return `/api/room-image-uploads/${encodeURIComponent(uploadId)}`;
}

/* Die öffentliche Demo hat keinen Companion-Server. Sie beantwortet dieselbe
   API aus vorbereiteten Assets — der dynamische Import hält den Demo-Code aus
   dem Produktionsbundle heraus. */
function demoClient(): RoomImageApi {
  const loading = import('../demo/demo-room-images.ts').then((demo) => demo.createDemoRoomImageApi());
  return {
    getCapability: async () => (await loading).getCapability(),
    getCapabilityDetails: async () => (await loading).getCapabilityDetails(),
    probeCapability: async () => (await loading).probeCapability(),
    upload: async (data, mimeType) => (await loading).upload(data, mimeType),
    deleteUpload: async (uploadId) => (await loading).deleteUpload(uploadId),
    createJob: async (request) => (await loading).createJob(request),
    getJob: async (jobId, requestOptions) => (await loading).getJob(jobId, requestOptions),
    retryJob: async (jobId, request) => (await loading).retryJob(jobId, request),
    cancelJob: async (jobId) => (await loading).cancelJob(jobId),
    discardJob: async (jobId) => (await loading).discardJob(jobId),
    publishJob: async (jobId, confirmed) => (await loading).publishJob(jobId, confirmed),
  };
}

export function createRoomImageClient(options: RoomImageClientOptions = {}): RoomImageApi {
  if (!options.fetchImpl && import.meta.env?.VITE_DEMO === '1') return demoClient();
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    getCapability: () => requestJson(
      fetchImpl, '/api/room-images/capability', { method: 'GET' }, parseCapability,
    ),
    getCapabilityDetails: () => requestJson(
      fetchImpl, '/api/room-images/capability/details', { method: 'GET' }, parseDetails,
    ),
    probeCapability: () => requestJson(
      fetchImpl,
      '/api/room-images/probe',
      { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({}) },
      parseDetails,
    ),
    upload: async (data, mimeType) => {
      if (!oneOf(mimeType, MIME_TYPES)
          || (!(data instanceof Blob) && !(data instanceof ArrayBuffer))) throw invalidRequest();
      return requestJson(
        fetchImpl,
        '/api/room-image-uploads',
        { method: 'POST', headers: { 'Content-Type': mimeType }, body: data },
        parseUpload,
      );
    },
    deleteUpload: async (uploadId) => requestEmpty(fetchImpl, uploadPath(uploadId), { method: 'DELETE' }),
    createJob: async (request) => {
      const body = request.kind === 'main_candidates' ? rebuildMain(request) : rebuildFinal(request);
      return requestJson(
        fetchImpl,
        '/api/room-image-jobs',
        { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) },
        parseJob,
      );
    },
    getJob: async (jobId, requestOptions = {}) => requestJson(
      fetchImpl,
      jobPath(jobId),
      { method: 'GET', ...(requestOptions.signal ? { signal: requestOptions.signal } : {}) },
      parseJob,
    ),
    retryJob: async (jobId, request) => requestJson(
      fetchImpl,
      `${jobPath(jobId)}/retry`,
      { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(rebuildRetry(request)) },
      parseJob,
    ),
    cancelJob: async (jobId) => requestJson(
      fetchImpl,
      `${jobPath(jobId)}/cancel`,
      { method: 'POST' },
      parseJob,
    ),
    discardJob: async (jobId) => requestEmpty(
      fetchImpl,
      `${jobPath(jobId)}/discard`,
      { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({}) },
    ),
    publishJob: async (jobId, confirmed) => {
      if (confirmed !== true) return Promise.reject(invalidRequest());
      return requestJson(
        fetchImpl,
        `${jobPath(jobId)}/publish`,
        { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ confirmed: true }) },
        parseAsset,
      );
    },
  };
}
