import { describe, expect, it, vi } from 'vitest';
import {
  RoomImageClientError,
  createRoomImageClient,
  type MainCandidatesJobRequest,
  type RoomImageCapability,
  type RoomImageCapabilityDetails,
  type RoomImageFetch,
  type RoomImageJob,
} from './room-image-client.ts';

const JOB_ID = 'J'.repeat(43);
const UPLOAD_ID = 'U'.repeat(43);
const CANDIDATE_ID = 'C'.repeat(43);
const ATTEMPT_ID = 'A'.repeat(43);
const LINEAGE_ID = 'L'.repeat(43);
const ASSET_ID = 'asset_01';
const UUID = '123e4567-e89b-42d3-a456-426614174000';

function json(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

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
    phase: 'generating_composition',
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:01.000Z',
    expiresAt: '2026-08-10T10:00:00.000Z',
    cancellable: true,
    retryable: false,
    discardable: false,
    retry: null,
    supersededByJobId: null,
    providerCalls: {
      attempt: counters(3),
      lineage: counters(),
      wizard: counters(),
    },
    candidates: [],
    asset: null,
    error: null,
    ...overrides,
  };
}

function candidate(candidateId: string) {
  return {
    candidateId,
    previewUrl: `/api/room-image-jobs/${JOB_ID}/previews/${candidateId}`,
    suggestedRoomId: null,
  };
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

function mainRequest(extra: Record<string, unknown> = {}): MainCandidatesJobRequest {
  return {
    kind: 'main_candidates',
    clientRequestId: UUID,
    uploadId: UPLOAD_ID,
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    canonicalCropPixels: { x: 106, y: 75, width: 1696, height: 1200 },
    focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
    stylePreset: 'hauser-room-v1',
    adjustments: {
      declutter: 'light',
      tone: 'neutral',
      preserveFeatures: ['windows', 'doors'],
    },
    candidateCount: 2,
    noticeVersion: 'room-image-v1',
    costConfirmed: true,
    confirmedProviderCalls: 3,
    ...extra,
  } as MainCandidatesJobRequest;
}

function bodyOf(init?: RequestInit): unknown {
  return init?.body === undefined || init.body === null ? undefined : JSON.parse(String(init.body));
}

describe('room image same-origin client', () => {
  it('loads and strictly validates the public and private capability without identity headers', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl: RoomImageFetch = vi.fn(async (input, init) => {
      calls.push([String(input), init]);
      if (String(input).endsWith('/details')) return json({
        enabled: false,
        provider: 'openai',
        credentialConfigured: true,
        credentialSource: 'environment',
        credentialMode: 'api_key',
        imageCapability: 'unverified',
        reasonCode: null,
        model: 'gpt-image-2-2026-04-21',
        probe: { modelVisible: true, checkedAt: '2026-08-09T10:00:00.000Z' },
        limits: {
          maxUploadBytes: 12582912,
          maxDecodedPixels: 24000000,
          maxMainCandidates: 2,
          maxConcurrentProviderCalls: 1,
          maxQueuedJobs: 3,
        },
      });
      return json({ enabled: false, imageCapability: 'disabled', reasonCode: 'FEATURE_DISABLED' });
    });
    const client = createRoomImageClient({ fetchImpl });

    await expect(client.getCapability()).resolves.toEqual({
      enabled: false, imageCapability: 'disabled', reasonCode: 'FEATURE_DISABLED',
    });
    await expect(client.getCapabilityDetails()).resolves.toMatchObject({
      provider: 'openai', imageCapability: 'unverified', reasonCode: null,
    });
    expect(calls.map(([url]) => url)).toEqual([
      '/api/room-images/capability', '/api/room-images/capability/details',
    ]);
    for (const [, init] of calls) {
      expect(init?.credentials).toBe('same-origin');
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization|identity|forwarded|credential/i);
    }
  });

  it.each([
    [{ enabled: false, imageCapability: 'disabled', reasonCode: 'FEATURE_DISABLED', provider: 'openai' }, 'extra capability key'],
    [{ enabled: true, imageCapability: 'ready', reasonCode: 'UNVERIFIED' }, 'incoherent ready capability'],
    [{ enabled: false, imageCapability: 'hostile', reasonCode: 'FEATURE_DISABLED' }, 'unknown capability enum'],
  ])('rejects hostile capability responses: %s', async (payload, _label) => {
    const client = createRoomImageClient({ fetchImpl: async () => json(payload) });
    await expect(client.getCapability()).rejects.toMatchObject({ kind: 'invalid_response', code: 'INVALID_RESPONSE' });
  });

  it.each([
    ['FEATURE_DISABLED', { enabled: false, imageCapability: 'disabled', reasonCode: 'FEATURE_DISABLED' }],
    ['AUTH_BOUNDARY_MISSING', { enabled: false, imageCapability: 'disabled', reasonCode: 'AUTH_BOUNDARY_MISSING' }],
    ['CREDENTIAL_MISSING', { enabled: false, imageCapability: 'disabled', reasonCode: 'CREDENTIAL_MISSING' }],
    ['UNVERIFIED', { enabled: true, imageCapability: 'unverified', reasonCode: 'UNVERIFIED' }],
    ['ready', { enabled: true, imageCapability: 'ready', reasonCode: null }],
  ] satisfies Array<[string, RoomImageCapability]>)('parses public capability state %s through getCapability()', async (_label, payload) => {
    const client = createRoomImageClient({ fetchImpl: async () => json(payload) });
    await expect(client.getCapability()).resolves.toEqual(payload);
  });

  it.each([
    'disabled', 'credential_missing', 'credential_invalid', 'forbidden',
    'unreachable', 'unverified', 'ready',
  ] satisfies RoomImageCapabilityDetails['imageCapability'][])(
    'parses private capability state %s through getCapabilityDetails()',
    async (imageCapability) => {
      const payload = capabilityDetails(imageCapability);
      const client = createRoomImageClient({ fetchImpl: async () => json(payload) });
      await expect(client.getCapabilityDetails()).resolves.toEqual(payload);
    },
  );

  it('uses the real probeCapability() wire path with a closed empty JSON body', async () => {
    const payload = capabilityDetails('unverified');
    const fetchImpl: RoomImageFetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe('/api/room-images/probe');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(bodyOf(init)).toEqual({});
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization|identity|forwarded|credential/i);
      return json(payload);
    });
    const client = createRoomImageClient({ fetchImpl });

    await expect(client.probeCapability()).resolves.toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uploads raw bytes with an exact image MIME and never multipart, filename, URL or JSON', async () => {
    const fetchImpl: RoomImageFetch = vi.fn(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.headers).toEqual({ 'Content-Type': 'image/png' });
      expect(init?.body).toBeInstanceOf(Blob);
      return json({
        uploadId: UPLOAD_ID,
        width: 2048,
        height: 1449,
        mimeType: 'image/png',
        expiresAt: '2026-08-09T10:30:00.000Z',
      }, 201);
    });
    const client = createRoomImageClient({ fetchImpl });
    const bytes = new Blob([Uint8Array.of(137, 80, 78, 71)], { type: 'image/png' });

    await expect(client.upload(bytes, 'image/png')).resolves.toMatchObject({ uploadId: UPLOAD_ID, width: 2048 });
    expect(fetchImpl).toHaveBeenCalledWith('/api/room-image-uploads', expect.any(Object));
    await expect(client.upload(bytes, 'image/gif' as 'image/png')).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reconstructs closed main/final/retry/publish bodies and safely interpolates IDs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: RoomImageFetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/publish')) return json({
        assetId: ASSET_ID,
        variants: {
          light: `/assets/room-images/${ASSET_ID}/light.avif`,
          dark: `/assets/room-images/${ASSET_ID}/dark.avif`,
          darkOff: `/assets/room-images/${ASSET_ID}/dark-off.avif`,
        },
        focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
      });
      if (url.endsWith('/discard') || url.includes('/room-image-uploads/')) return new Response(null, { status: 204 });
      return json(job());
    });
    const client = createRoomImageClient({ fetchImpl });

    await client.createJob(mainRequest({ prompt: 'must-not-pass', provider: 'openai' }));
    await client.createJob({
      kind: 'variant_set', clientRequestId: UUID, parentJobId: JOB_ID, candidateId: CANDIDATE_ID,
      focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    });
    await client.retryJob(JOB_ID, {
      clientRequestId: UUID, noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    });
    await client.cancelJob(JOB_ID);
    await client.discardJob(JOB_ID);
    await client.publishJob(JOB_ID, true);
    await client.deleteUpload(UPLOAD_ID);

    expect(bodyOf(calls[0].init)).toEqual(mainRequest());
    expect(bodyOf(calls[1].init)).toEqual({
      kind: 'variant_set', clientRequestId: UUID, parentJobId: JOB_ID, candidateId: CANDIDATE_ID,
      focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
      noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    });
    expect(bodyOf(calls[2].init)).toEqual({
      clientRequestId: UUID, noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
    });
    expect(calls[3].init?.body).toBeUndefined();
    expect(bodyOf(calls[4].init)).toEqual({});
    expect(bodyOf(calls[5].init)).toEqual({ confirmed: true });
    expect(calls[6].url).toBe(`/api/room-image-uploads/${UPLOAD_ID}`);
    for (const call of calls) {
      expect(call.url.startsWith('/')).toBe(true);
      expect(JSON.stringify(call.init?.headers ?? {})).not.toMatch(/authorization|identity|forwarded/i);
    }
  });

  it.each([
    [mainRequest({ confirmedProviderCalls: 2 }), 'confirmed count mismatch'],
    [mainRequest({ crop: { x: 0.9, y: 0, width: 0.2, height: 1 } }), 'crop out of bounds'],
    [mainRequest({ canonicalCropPixels: { x: 0, y: 0, width: 0, height: 1200 } }), 'empty canonical crop'],
    [mainRequest({ adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows', 'windows'] } }), 'duplicate preservation'],
    [mainRequest({ adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows', 'free_text'] } }), 'open preservation'],
  ])('rejects invalid closed main requests before fetch: %s', async (request) => {
    const fetchImpl = vi.fn<RoomImageFetch>();
    const client = createRoomImageClient({ fetchImpl });
    await expect(client.createJob(request)).rejects.toMatchObject({ kind: 'invalid_request', code: 'INVALID_REQUEST' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('strictly validates job IDs, counters, error fields and canonical preview URLs', async () => {
    const valid = job({
      status: 'succeeded',
      phase: 'complete',
      cancellable: true,
      candidates: [{
        candidateId: CANDIDATE_ID,
        previewUrl: `/api/room-image-jobs/${JOB_ID}/previews/${CANDIDATE_ID}`,
        suggestedRoomId: null,
      }],
    });
    const client = createRoomImageClient({ fetchImpl: async () => json(valid) });
    await expect(client.getJob(JOB_ID)).resolves.toEqual(valid);

    const hostile: unknown[] = [
      { ...valid, compositionHandle: 'secret' },
      { ...valid, candidates: [{ ...valid.candidates[0], previewUrl: 'https://evil.invalid/private' }] },
      { ...valid, candidates: [{ ...valid.candidates[0], previewUrl: `data:image/png;base64,secret` }] },
      { ...valid, providerCalls: { ...valid.providerCalls, attempt: { ...valid.providerCalls.attempt, rawCost: 1 } } },
      { ...valid, error: { code: 'FAILED', message: 'safe', providerPayload: 'secret' } },
      { ...valid, status: 'failed', error: null },
    ];
    for (const payload of hostile) {
      const invalid = createRoomImageClient({ fetchImpl: async () => json(payload) });
      await expect(invalid.getJob(JOB_ID)).rejects.toMatchObject({ kind: 'invalid_response' });
    }
  });

  it('accepts only the three current-job final previews and canonical published asset paths', async () => {
    const awaiting = job({
      kind: 'variant_set', status: 'awaiting_confirmation', phase: 'awaiting_confirmation', cancellable: true,
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
        assetId: ASSET_ID,
        variants: {
          light: `/assets/room-images/${ASSET_ID}/light.avif`,
          dark: `/assets/room-images/${ASSET_ID}/dark.avif`,
          darkOff: `/assets/room-images/${ASSET_ID}/dark-off.avif`,
        },
        focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
      },
    });
    const fetchImpl = vi.fn<RoomImageFetch>()
      .mockResolvedValueOnce(json(awaiting))
      .mockResolvedValueOnce(json(published));
    const client = createRoomImageClient({ fetchImpl });
    await expect(client.getJob(JOB_ID)).resolves.toMatchObject({ temporaryVariants: awaiting.temporaryVariants });
    await expect(client.getJob(JOB_ID)).resolves.toMatchObject({ asset: published.asset });

    const wrongJob = { ...awaiting, temporaryVariants: { ...awaiting.temporaryVariants, dark: `/api/room-image-jobs/${'X'.repeat(43)}/final-previews/dark` } };
    await expect(createRoomImageClient({ fetchImpl: async () => json(wrongJob) }).getJob(JOB_ID))
      .rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it.each([0, 1, 2])(
    'accepts a succeeded main job with %i candidates, including atomic transfer ownership',
    async (candidateCount) => {
      const candidates = Array.from(
        { length: candidateCount },
        (_, index) => candidate(String.fromCharCode(67 + index).repeat(43)),
      );
      const payload = job({ status: 'succeeded', phase: 'complete', candidates });
      const client = createRoomImageClient({ fetchImpl: async () => json(payload) });
      await expect(client.getJob(JOB_ID)).resolves.toEqual(payload);
    },
  );

  it('accepts awaiting_confirmation during publishing_set without final preview fields', async () => {
    const payload = job({
      kind: 'variant_set', status: 'awaiting_confirmation', phase: 'publishing_set', cancellable: false,
    });
    const client = createRoomImageClient({ fetchImpl: async () => json(payload) });
    await expect(client.getJob(JOB_ID)).resolves.toEqual(payload);
  });

  it.each([
    ['awaiting final job without temporary variants and focus', job({
      kind: 'variant_set', status: 'awaiting_confirmation', phase: 'awaiting_confirmation',
    })],
    ['awaiting final job without focus', job({
      kind: 'variant_set', status: 'awaiting_confirmation', phase: 'awaiting_confirmation',
      temporaryVariants: {
        light: `/api/room-image-jobs/${JOB_ID}/final-previews/light`,
        dark: `/api/room-image-jobs/${JOB_ID}/final-previews/dark`,
        darkOff: `/api/room-image-jobs/${JOB_ID}/final-previews/dark-off`,
      },
    })],
    ['awaiting final job without temporary variants', job({
      kind: 'variant_set', status: 'awaiting_confirmation', phase: 'awaiting_confirmation',
      focus: { panel: { x: 0.5, y: 0.4 }, phone: { x: 0.6, y: 0.3 } },
    })],
    ['published final job without asset', job({
      kind: 'variant_set', status: 'succeeded', phase: 'complete', cancellable: false,
    })],
    ['succeeded main job with more than two candidates', job({
      status: 'succeeded', phase: 'complete',
      candidates: [candidate('C'.repeat(43)), candidate('D'.repeat(43)), candidate('E'.repeat(43))],
    })],
    ['succeeded main job with duplicate candidate IDs', job({
      status: 'succeeded', phase: 'complete',
      candidates: [candidate(CANDIDATE_ID), candidate(CANDIDATE_ID)],
    })],
  ])('rejects the contradictory wire state %s', async (_label, payload) => {
    const client = createRoomImageClient({ fetchImpl: async () => json(payload) });
    await expect(client.getJob(JOB_ID)).rejects.toMatchObject({
      kind: 'invalid_response', code: 'INVALID_RESPONSE',
    });
  });

  it.each([
    [401, 'ROOM_IMAGE_AUTH_REQUIRED'],
    [403, 'ROOM_IMAGE_AUTH_FORBIDDEN'],
    [403, 'ORIGIN_FORBIDDEN'],
    [503, 'AUTH_BOUNDARY_MISSING'],
    [404, 'ROOM_IMAGE_JOB_NOT_FOUND'],
    [410, 'ROOM_IMAGE_TEMP_EXPIRED'],
  ])('normalizes HTTP %i %s from the allowlisted error schema', async (status, code) => {
    const client = createRoomImageClient({ fetchImpl: async () => json({
      ok: false, code, message: 'Sanitisierte Servermeldung', retryable: false,
    }, status) });
    await expect(client.getJob(JOB_ID)).rejects.toEqual(expect.objectContaining({
      kind: 'http', status, code, message: 'Sanitisierte Servermeldung', retryable: false,
    }));
  });

  it('classifies invalid JSON/content-type, network and abort without leaking raw data', async () => {
    const cases: Array<[RoomImageFetch, string]> = [
      [async () => new Response('<secret>', { status: 200, headers: { 'content-type': 'text/html' } }), 'invalid_response'],
      [async () => new Response('{secret', { status: 200, headers: { 'content-type': 'application/json' } }), 'invalid_response'],
      [async () => { throw new Error('token=raw-secret'); }, 'network'],
      [async () => { throw new DOMException('raw abort reason', 'AbortError'); }, 'abort'],
    ];
    for (const [fetchImpl, kind] of cases) {
      const client = createRoomImageClient({ fetchImpl });
      try {
        await client.getJob(JOB_ID);
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(RoomImageClientError);
        expect(error).toMatchObject({ kind });
        expect(JSON.stringify(error)).not.toContain('raw-secret');
        expect(JSON.stringify(error)).not.toContain('raw abort');
      }
    }
  });

  it('rejects malformed IDs before URL interpolation', async () => {
    const fetchImpl = vi.fn<RoomImageFetch>();
    const client = createRoomImageClient({ fetchImpl });
    for (const id of ['../secret', 'short', `${JOB_ID}/other`, encodeURIComponent('../secret')]) {
      await expect(client.getJob(id)).rejects.toMatchObject({ kind: 'invalid_request' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
