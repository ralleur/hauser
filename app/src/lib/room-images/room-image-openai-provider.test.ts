import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Buffer } from 'node:buffer';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import http from 'node:http';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
import {
  createHmiServer,
  createChatGptRoomImageProvider,
  createOpenAiRoomImageProvider,
  createRoomImageCredentialStore,
  createRoomImageAuthConfig,
  createRoomImageJobRunner,
  createRoomImageJobStore,
// @ts-expect-error The production server intentionally remains native Node ESM without declarations.
} from '../../../server.mjs';

const MODEL = 'gpt-image-2-2026-04-21';
const MODELS_URL = `https://api.openai.com/v1/models/${MODEL}`;
const EDITS_URL = 'https://api.openai.com/v1/images/edits';
const CREDENTIAL = 'lane-c-test-credential';
const PROMPT = 'Versionierter serverseitiger Room-Image-Prompt';
const ORIGIN = 'http://room-image-openai.fixture';
const IDENTITY_HEADER = 'x-room-user';
const roots: string[] = [];
const servers: http.Server[] = [];
const runners: any[] = [];
let validPng: Uint8Array;

beforeAll(async () => {
  validPng = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 82, g: 104, b: 126 } },
  }).png({ compressionLevel: 9, progressive: false, palette: false }).toBuffer();
});

afterEach(async () => {
  for (const runner of runners.splice(0)) {
    for (const jobId of [runner.activeJobId, ...runner.queuedJobIds].filter(Boolean)) runner.cancel(jobId);
    await runner.waitForIdle();
  }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function sandbox(prefix = 'hauser-room-image-openai-') {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function instrumentedProviderResponse({
  status = 200,
  headers = {},
  chunks = [],
  pendingRead = false,
  cancelRejects = false,
}: {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Uint8Array[];
  pendingRead?: boolean;
  cancelRejects?: boolean;
} = {}) {
  let chunkIndex = 0;
  let cancelCount = 0;
  let settlePendingRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | null = null;
  let signalReadStarted: (() => void) | null = null;
  const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve; });
  const cancel = async () => {
    cancelCount += 1;
    settlePendingRead?.({ done: true, value: undefined });
    settlePendingRead = null;
    if (cancelRejects) throw new Error(`cancel leaked ${CREDENTIAL} raw-provider-body`);
  };
  const reader = {
    read: vi.fn(async () => {
      signalReadStarted?.();
      signalReadStarted = null;
      if (pendingRead) {
        return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => { settlePendingRead = resolve; });
      }
      if (chunkIndex < chunks.length) return { done: false as const, value: chunks[chunkIndex++] };
      return { done: true as const, value: undefined };
    }),
    cancel: vi.fn(cancel),
    releaseLock: vi.fn(),
  };
  const body = {
    cancel: vi.fn(cancel),
    getReader: vi.fn(() => reader),
  };
  return {
    response: { status, headers: new Headers(headers), body } as unknown as Response,
    body,
    reader,
    readStarted,
    get cancelCount() { return cancelCount; },
  };
}

function openAiProvider(fetchImpl: typeof fetch) {
  return createOpenAiRoomImageProvider({ credential: CREDENTIAL, fetchImpl });
}

function auth() {
  return createRoomImageAuthConfig({
    mode: 'trusted_proxy',
    trustedProxyCidrs: '127.0.0.1/32',
    identityHeader: IDENTITY_HEADER,
  });
}

function trustedHeaders(extra: Record<string, string> = {}) {
  return { [IDENTITY_HEADER]: 'fixture-user', origin: ORIGIN, ...extra };
}

async function startServer(options: Record<string, unknown>) {
  const root = sandbox('hauser-room-image-openai-server-');
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
  const server = createHmiServer('', {
    staticRoot,
    configPath: join(root, 'shared.json'),
    paperlessPin: '',
    paperlessToken: '',
    allowedOrigins: new Set([ORIGIN]),
    roomImageAuthConfig: auth(),
    roomImageUploadStore: { cleanup() {} },
    roomImageJobStore: { get() { return null; } },
    roomImageCredentialPath: join(root, 'room-image-auth.json'),
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

function directMainRequest(clientRequestId: string) {
  return {
    kind: 'main_candidates',
    clientRequestId,
    uploadId: 'u'.repeat(43),
    crop: { x: 0.1, y: 0.1, width: 0.795, height: 0.75 },
    canonicalCropPixels: { x: 64, y: 48, width: 530, height: 375 },
    focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
    stylePreset: 'hauser-room-v1',
    adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows'] },
    candidateCount: 1,
    noticeVersion: 'room-image-v1',
    costConfirmed: true,
    confirmedProviderCalls: 2,
  };
}

function runnerFixture(fetchImpl: typeof fetch, options: Record<string, unknown> = {}) {
  const root = sandbox('hauser-room-image-openai-runner-');
  const store = createRoomImageJobStore({
    metadataRoot: join(root, 'jobs'),
    tempRoot: join(root, 'private'),
  });
  const record = store.createMain(
    'fixture-user',
    directMainRequest(`18181818-1818-4818-8818-${String(roots.length).padStart(12, '0')}`),
    readFileSync(new URL('./fixtures/orientation-1.jpg', import.meta.url)),
    'f'.repeat(64),
  ).record;
  const runner = createRoomImageJobRunner({
    store,
    provider: openAiProvider(fetchImpl),
    ...options,
  });
  runners.push(runner);
  expect(runner.enqueue(record.jobId)).toBe(true);
  return { record, runner, store };
}

async function waitUntil(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function manualTimers(clock = { value: 1_000 }) {
  const entries: Array<{ callback: () => void; active: boolean; delay: number }> = [];
  return {
    entries,
    setTimer(callback: () => void, delay: number) {
      const entry = { callback, active: true, delay };
      entries.push(entry);
      return entry;
    },
    clearTimer(entry: { active: boolean } | undefined) {
      if (entry) entry.active = false;
    },
    monotonicNow() { return clock.value; },
    fire(index = 0) {
      const entry = entries[index];
      if (!entry?.active) throw new Error(`timer ${index} is not active`);
      clock.value += entry.delay;
      entry.active = false;
      entry.callback();
    },
  };
}

describe('B-08E10 Lane C OpenAI models probe', () => {
  it('sends the pinned GET exactly once with the unchanged signal and never reports ready', async () => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn(async () => jsonResponse({ id: MODEL }, 200));
    const result = await openAiProvider(fetchImpl as typeof fetch).probe({ signal });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(MODELS_URL);
    expect(init).toMatchObject({ method: 'GET', signal });
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(new Headers(init.headers).has('content-type')).toBe(false);
    expect(result).toEqual({
      definitiveResponse: true,
      status: 200,
      imageCapability: 'unverified',
      modelVisible: true,
    });
    expect(JSON.stringify(result)).not.toContain('ready');
  });

  it.each([
    [401, 'credential_invalid', 'PROVIDER_CREDENTIAL_INVALID'],
    [403, 'forbidden', 'PROVIDER_FORBIDDEN'],
  ])('normalizes probe HTTP %i without raw response details', async (status, imageCapability, errorCode) => {
    const fetchImpl = vi.fn(async () => new Response(`raw-${CREDENTIAL}`, { status }));
    const result = await openAiProvider(fetchImpl as typeof fetch).probe({ signal: new AbortController().signal });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status, imageCapability, modelVisible: false, errorCode });
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain('raw-');
  });

  it.each([200, 401, 403])('cancels an ignored probe HTTP %i body exactly once', async (status) => {
    const fixture = instrumentedProviderResponse({ status });
    const fetchImpl = vi.fn(async () => fixture.response);
    await openAiProvider(fetchImpl as typeof fetch).probe({ signal: new AbortController().signal });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fixture.cancelCount).toBe(1);
    expect(fixture.body.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.body.getReader).not.toHaveBeenCalled();
  });

  it('normalizes a transport failure to unreachable without leaking its exception', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`dns failed ${CREDENTIAL} ${MODELS_URL}`); });
    const result = await openAiProvider(fetchImpl as typeof fetch).probe({ signal: new AbortController().signal });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: false, imageCapability: 'unreachable', modelVisible: false });
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain(MODELS_URL);
  });

  it('selects the fail-closed boundary for a missing or trim-empty credential with zero fetches', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: MODEL }));
    for (const credential of ['', '   ', undefined]) {
      const provider = createOpenAiRoomImageProvider({ credential, fetchImpl: fetchImpl as typeof fetch });
      expect(provider.available).toBe(false);
      await expect(provider.probe({ signal: new AbortController().signal })).rejects.toMatchObject({
        code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT',
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('wires the productive adapter into the authenticated route and keeps probe state transient and unverified', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: MODEL }, 200));
    const base = await startServer({
      roomImageProviderCredential: CREDENTIAL,
      roomImageFetchImpl: fetchImpl,
      roomImageNow: () => Date.parse('2026-08-09T12:34:56.000Z'),
    });

    const forbidden = await fetch(`${base}/api/room-images/probe`, {
      method: 'POST', headers: { [IDENTITY_HEADER]: 'fixture-user' },
    });
    expect(forbidden.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();

    const response = await fetch(`${base}/api/room-images/probe`, { method: 'POST', headers: trustedHeaders() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: true,
      provider: 'openai',
      credentialConfigured: true,
      credentialSource: 'environment',
      credentialMode: 'api_key',
      imageCapability: 'unverified',
      reasonCode: null,
      model: MODEL,
      probe: { modelVisible: true, checkedAt: '2026-08-09T12:34:56.000Z' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const details = await fetch(`${base}/api/room-images/capability/details`, { headers: trustedHeaders() });
    expect(await details.json()).toMatchObject({
      enabled: true,
      imageCapability: 'unverified',
      probe: { modelVisible: true, checkedAt: '2026-08-09T12:34:56.000Z' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps productive server wiring fail-closed without a credential and never reaches injected fetch', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('must stay unreachable'); });
    const base = await startServer({ roomImageProviderCredential: '  ', roomImageFetchImpl: fetchImpl });
    const response = await fetch(`${base}/api/room-images/probe`, { method: 'POST', headers: trustedHeaders() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      enabled: false,
      credentialConfigured: false,
      imageCapability: 'credential_missing',
      probe: { modelVisible: false },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('B-08E10 Lane C OpenAI images edit wire contract', () => {
  it('sends exactly the allowlisted multipart fields and accepts one canonical decoded PNG', async () => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn(async () => jsonResponse(
      { data: [{ b64_json: Buffer.from(validPng).toString('base64') }], usage: { ignored: true } },
      200,
      { 'x-request-id': 'req_lane-c.42:ok', 'x-secret-provider-header': CREDENTIAL },
    ));
    const input = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input, signal,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(EDITS_URL);
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${CREDENTIAL}`);
    expect(headers.has('content-type')).toBe(false);
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()]).toEqual(['model', 'image[]', 'prompt', 'n', 'quality', 'size', 'output_format']);
    expect(body.getAll('image[]')).toHaveLength(1);
    expect(body.get('model')).toBe(MODEL);
    expect(body.get('prompt')).toBe(PROMPT);
    expect(body.get('n')).toBe('1');
    expect(body.get('quality')).toBe('auto');
    expect(body.get('size')).toBe('auto');
    expect(body.get('output_format')).toBe('png');
    expect(body.has('input_fidelity')).toBe(false);
    expect(body.has('mask')).toBe(false);
    expect(body.has('image')).toBe(false);
    const image = body.get('image[]') as File;
    expect(image.type).toBe('image/jpeg');
    expect(image.name).toBe('room-image-input.jpg');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(input);
    expect(result).toMatchObject({
      definitiveResponse: true,
      status: 200,
      requestId: 'req_lane-c.42:ok',
    });
    expect(result.image).toEqual(new Uint8Array(validPng));
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain(PROMPT);
    expect(JSON.stringify(result)).not.toContain('x-secret-provider-header');
  });

  it('drops a non-allowlisted request ID and all other response headers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { data: [{ b64_json: Buffer.from(validPng).toString('base64') }] },
      200,
      { 'x-request-id': `bad value ${CREDENTIAL}-${'x'.repeat(200)}`, 'x-other': 'raw-provider-value' },
    ));
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ definitiveResponse: true, status: 200 });
    expect(result.image).toEqual(new Uint8Array(validPng));
    expect(result).not.toHaveProperty('requestId');
  });

  it.each([
    ['missing data', {}],
    ['empty data', { data: [] }],
    ['missing b64_json', { data: [{}] }],
    ['empty b64_json', { data: [{ b64_json: '' }] }],
    ['multiple data', { data: [{ b64_json: 'AA==' }, { b64_json: 'AA==' }] }],
    ['url only', { data: [{ url: 'https://provider.invalid/image.png' }] }],
    ['url plus b64_json', { data: [{ url: 'https://provider.invalid/image.png', b64_json: 'AA==' }] }],
    ['invalid base64', { data: [{ b64_json: '%%%=' }] }],
    ['noncanonical base64', { data: [{ b64_json: 'YQ' }] }],
    ['non-PNG bytes', { data: [{ b64_json: Buffer.from('not a png').toString('base64') }] }],
    ['PNG signature with decode failure', { data: [{ b64_json: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString('base64') }] }],
  ])('classifies %s as a definitive invalid response with exactly one fetch', async (_label, payload) => {
    const fetchImpl = vi.fn(async () => jsonResponse(payload));
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status: 200, errorCode: 'PROVIDER_INVALID_RESPONSE' });
    expect(JSON.stringify(result)).not.toContain('provider.invalid');
  });

  it('rejects invalid JSON as a definitive invalid response without a retry', async () => {
    const fetchImpl = vi.fn(async () => new Response(`{"secret":"${CREDENTIAL}"`, {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status: 200, errorCode: 'PROVIDER_INVALID_RESPONSE' });
  });

  it('rejects non-UTF-8 response bytes with fatal decoding', async () => {
    const fetchImpl = vi.fn(async () => new Response(Uint8Array.of(0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status: 200, errorCode: 'PROVIDER_INVALID_RESPONSE' });
  });

  it('early-rejects an oversized Content-Length, cancels once and reads no chunks', async () => {
    const fixture = instrumentedProviderResponse({
      headers: { 'content-length': String(100 * 1024 * 1024 + 1) },
      chunks: [new TextEncoder().encode('{"data":[]}')],
    });
    const fetchImpl = vi.fn(async () => fixture.response);
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status: 200, errorCode: 'PROVIDER_INVALID_RESPONSE' });
    expect(fixture.cancelCount).toBe(1);
    expect(fixture.body.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.body.getReader).not.toHaveBeenCalled();
    expect(fixture.reader.read).not.toHaveBeenCalled();
  });

  it.each([
    ['without Content-Length', {}],
    ['with an underreported Content-Length', { 'content-length': '1' }],
  ])('bounds a chunked response %s while reading, cancels once and never retries', async (_label, headers) => {
    const repeatedChunk = new Uint8Array(1024 * 1024);
    const fixture = instrumentedProviderResponse({ headers, chunks: Array.from({ length: 101 }, () => repeatedChunk) });
    const fetchImpl = vi.fn(async () => fixture.response);
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status: 200, errorCode: 'PROVIDER_INVALID_RESPONSE' });
    expect(fixture.reader.read).toHaveBeenCalledTimes(101);
    expect(fixture.reader.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.cancelCount).toBe(1);
  });

  it('rejects oversized b64_json before regex validation or base64 decode', async () => {
    const oversized = 'A'.repeat(96 * 1024 * 1024 + 4);
    const originalRegExpTest = RegExp.prototype.test;
    const regexSpy = vi.spyOn(RegExp.prototype, 'test').mockImplementation(function (this: RegExp, value: string) {
      if (value === oversized) throw new Error(`regex reached oversized provider body ${CREDENTIAL}`);
      return originalRegExpTest.call(this, value);
    });
    const originalBufferFrom = Buffer.from;
    const bufferSpy = vi.spyOn(Buffer, 'from').mockImplementation(((value: unknown, ...args: unknown[]) => {
      if (value === oversized) throw new Error(`base64 decode reached oversized provider body ${CREDENTIAL}`);
      return Reflect.apply(originalBufferFrom, Buffer, [value, ...args]);
    }) as typeof Buffer.from);
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ b64_json: oversized }] }));
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status: 200, errorCode: 'PROVIDER_INVALID_RESPONSE' });
    expect(regexSpy.mock.calls.some(([value]) => value === oversized)).toBe(false);
    expect(bufferSpy.mock.calls.some((call: unknown[]) => call[0] === oversized)).toBe(false);
  });

  it.each([
    [401, 'PROVIDER_CREDENTIAL_INVALID'],
    [403, 'PROVIDER_FORBIDDEN'],
    [402, 'PROVIDER_QUOTA_OR_RATE_LIMIT'],
    [429, 'PROVIDER_QUOTA_OR_RATE_LIMIT'],
    [422, 'PROVIDER_IMAGE_REJECTED'],
    [503, 'PROVIDER_HTTP_ERROR'],
  ])('maps HTTP %i to %s with zero retries', async (status, errorCode) => {
    const fixture = instrumentedProviderResponse({ status, headers: { 'x-request-id': 'req_http-matrix' } });
    const fetchImpl = vi.fn(async () => fixture.response);
    const result = await openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ definitiveResponse: true, status, errorCode, requestId: 'req_http-matrix' });
    expect(fixture.cancelCount).toBe(1);
    expect(fixture.body.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.body.getReader).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
  });

  it('sanitizes cancel rejection without changing definitive probe or edit classification', async () => {
    const probeFixture = instrumentedProviderResponse({ status: 401, cancelRejects: true });
    const probeFetch = vi.fn(async () => probeFixture.response);
    const probe = await openAiProvider(probeFetch as typeof fetch).probe({ signal: new AbortController().signal });
    expect(probe).toEqual({
      definitiveResponse: true, status: 401, imageCapability: 'credential_invalid', modelVisible: false,
      errorCode: 'PROVIDER_CREDENTIAL_INVALID',
    });
    expect(probeFixture.cancelCount).toBe(1);

    const editFixture = instrumentedProviderResponse({ status: 429, cancelRejects: true });
    const editFetch = vi.fn(async () => editFixture.response);
    const edit = await openAiProvider(editFetch as typeof fetch).edit({
      phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
    });
    expect(edit).toEqual({ definitiveResponse: true, status: 429, errorCode: 'PROVIDER_QUOTA_OR_RATE_LIMIT' });
    expect(editFixture.cancelCount).toBe(1);
    expect(JSON.stringify({ probe, edit })).not.toContain('cancel leaked');
    expect(JSON.stringify({ probe, edit })).not.toContain(CREDENTIAL);
  });

  it('sanitizes transport and abort failures and never retries', async () => {
    for (const failure of [new Error(`disconnect ${CREDENTIAL}`), Object.assign(new Error('aborted raw'), { name: 'AbortError' })]) {
      const fetchImpl = vi.fn(async () => { throw failure; });
      await expect(openAiProvider(fetchImpl as typeof fetch).edit({
        phase: 'composition', prompt: PROMPT, input: new Uint8Array([1]), signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN', message: 'Room-image provider outcome is unknown' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['', new Uint8Array([1])],
    ['   ', new Uint8Array([1])],
    [PROMPT, new Uint8Array()],
    [PROMPT, 'not-bytes'],
  ])('rejects invalid local edit input before fetch', async (prompt, input) => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    await expect(openAiProvider(fetchImpl as typeof fetch).edit({
      phase: 'composition', prompt, input, signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Room-image ChatGPT and API-key access', () => {
  it('stores an API key in a private file without exposing it through status', () => {
    const root = sandbox('hauser-room-image-access-');
    const path = join(root, 'auth.json');
    const store = createRoomImageCredentialStore({ path, environmentApiKey: '' });

    expect(store.setApiKey('sk-test-012345678901234567890')).toEqual({
      configured: true, mode: 'api_key', source: 'stored',
    });
    expect(JSON.stringify(store.status())).not.toContain('sk-test');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ mode: 'api_key' });
  });

  it('runs the ChatGPT device-code exchange and persists only after confirmation', async () => {
    const root = sandbox('hauser-room-image-chatgpt-auth-');
    const path = join(root, 'auth.json');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user_code: 'ABCD-EFGH', device_auth_id: 'device-1', interval: 3 }))
      .mockResolvedValueOnce(jsonResponse({ authorization_code: 'authorization', code_verifier: 'verifier' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', refresh_token: 'refresh-token' }));
    const store = createRoomImageCredentialStore({ path, environmentApiKey: '', fetchImpl });

    const login = await store.beginChatGptLogin();
    expect(store.status().configured).toBe(false);
    expect(login).toMatchObject({ userCode: 'ABCD-EFGH', verificationUrl: 'https://auth.openai.com/codex/device' });
    await expect(store.pollChatGptLogin(login.loginId)).resolves.toEqual({ status: 'connected' });
    expect(store.status()).toEqual({ configured: true, mode: 'chatgpt', source: 'stored' });
    expect(JSON.stringify(store.status())).not.toContain('access-token');
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://auth.openai.com/api/accounts/deviceauth/usercode',
      'https://auth.openai.com/api/accounts/deviceauth/token',
      'https://auth.openai.com/oauth/token',
    ]);
  });

  it('edits through the Codex Responses image_generation stream', async () => {
    const payload = JSON.stringify({ type: 'response.output_item.done', item: {
      type: 'image_generation_call', result: Buffer.from(validPng).toString('base64'),
    } });
    const fetchImpl = vi.fn(async () => new Response(`event: response.output_item.done\ndata: ${payload}\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    }));
    const credentialStore = { chatGptAccessToken: vi.fn(async () => 'header.payload.signature') };
    const provider = createChatGptRoomImageProvider({ credentialStore, fetchImpl });

    const result = await provider.edit({ prompt: PROMPT, input: new Uint8Array([1, 2, 3]), signal: new AbortController().signal });
    expect(result).toMatchObject({ definitiveResponse: true, status: 200 });
    expect(Buffer.from(result.image)).toEqual(Buffer.from(validPng));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(init.headers).toMatchObject({ originator: 'codex_cli_rs', Authorization: 'Bearer header.payload.signature' });
    const request = JSON.parse(String(init.body));
    expect(request.tools).toEqual([expect.objectContaining({ type: 'image_generation', model: 'gpt-image-2' })]);
    expect(request.input[0].content[1]).toMatchObject({ type: 'input_image' });
  });
});

describe('B-08E10 Lane C runner classification and counters', () => {
  it.each([
    [401, 'PROVIDER_CREDENTIAL_INVALID'],
    [403, 'PROVIDER_FORBIDDEN'],
    [402, 'PROVIDER_QUOTA_OR_RATE_LIMIT'],
    [429, 'PROVIDER_QUOTA_OR_RATE_LIMIT'],
    [422, 'PROVIDER_IMAGE_REJECTED'],
    [503, 'PROVIDER_HTTP_ERROR'],
  ])('persists definitive HTTP %i as completed/http_error with %s exactly once', async (status, errorCode) => {
    const fetchImpl = vi.fn(async () => new Response('ignored raw body', { status }));
    const { record, runner, store } = runnerFixture(fetchImpl as typeof fetch);
    await runner.waitForIdle();
    const stored = store.get(record.jobId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored.attempts[0]).toMatchObject({ status: 'completed', outcome: 'http_error', errorCode });
    expect(stored.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 1, outcomeUnknownCount: 0 });
    expect(stored.providerCalls.lineage).toEqual(stored.providerCalls.wizard);
    expect(stored.providerCalls.wizard).toMatchObject({ startedCount: 1, completedCount: 1, outcomeUnknownCount: 0 });
  });

  it('persists invalid 2xx as completed/result_invalid with the adapter code and no raw payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ url: `https://provider.invalid/${CREDENTIAL}` }] }));
    const { record, runner, store } = runnerFixture(fetchImpl as typeof fetch);
    await runner.waitForIdle();
    const stored = store.get(record.jobId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored.attempts[0]).toMatchObject({
      status: 'completed', outcome: 'result_invalid', errorCode: 'PROVIDER_INVALID_RESPONSE',
    });
    expect(stored.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 1, outcomeUnknownCount: 0 });
    expect(JSON.stringify(stored)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(stored)).not.toContain('provider.invalid');
  });

  it('persists a transport failure as outcome_unknown exactly once and does not retry', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`disconnect ${CREDENTIAL}`); });
    const { record, runner, store } = runnerFixture(fetchImpl as typeof fetch);
    await runner.waitForIdle();
    const stored = store.get(record.jobId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored.attempts[0]).toMatchObject({
      status: 'outcome_unknown', outcome: null, errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
    });
    expect(stored.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
    expect(stored.providerCalls.lineage).toEqual(stored.providerCalls.wizard);
    expect(stored.providerCalls.wizard).toMatchObject({ startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
  });

  it('passes deadline abort through fetch, releases the slot and records one unknown call without retry', async () => {
    const timers = manualTimers();
    const observedSignals: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      observedSignals.push(signal);
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
    const { record, runner, store } = runnerFixture(fetchImpl as typeof fetch, {
      editDeadlineMs: 300_000,
      monotonicNow: timers.monotonicNow,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await waitUntil(() => fetchImpl.mock.calls.length === 1, 'deadline fetch');
    expect(timers.entries[0].delay).toBe(300_000);
    timers.fire(0);
    await runner.waitForIdle();
    const stored = store.get(record.jobId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(observedSignals).toHaveLength(1);
    expect(observedSignals[0].aborted).toBe(true);
    expect(stored.attempts[0]).toMatchObject({ status: 'outcome_unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' });
    expect(stored.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
    expect(runner.capacityUsed).toBe(0);
  });

  it('classifies deadline abort during bounded response reading as one unknown call without retry', async () => {
    const timers = manualTimers();
    const fixture = instrumentedProviderResponse({ pendingRead: true });
    const fetchImpl = vi.fn(async () => fixture.response);
    const { record, runner, store } = runnerFixture(fetchImpl as typeof fetch, {
      editDeadlineMs: 300_000,
      monotonicNow: timers.monotonicNow,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    const beganBoundedRead = await Promise.race([
      fixture.readStarted.then(() => true),
      runner.waitForIdle().then(() => false),
    ]);
    expect(beganBoundedRead).toBe(true);
    expect(timers.entries[0].delay).toBe(300_000);
    timers.fire(0);
    await runner.waitForIdle();
    const stored = store.get(record.jobId);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fixture.reader.cancel).toHaveBeenCalledTimes(1);
    expect(fixture.cancelCount).toBe(1);
    expect(stored.attempts[0]).toMatchObject({ status: 'outcome_unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' });
    expect(stored.providerCalls.attempt).toMatchObject({ startedCount: 1, completedCount: 0, outcomeUnknownCount: 1 });
    expect(stored.providerCalls.lineage).toEqual(stored.providerCalls.wizard);
    expect(runner.capacityUsed).toBe(0);
  });

  it('runs a valid provider PNG through the existing transform/preview pipeline with unchanged counters', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: [{ b64_json: Buffer.from(validPng).toString('base64') }],
    }));
    const { record, runner, store } = runnerFixture(fetchImpl as typeof fetch);
    await runner.waitForIdle();
    const stored = store.get(record.jobId);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(stored.status).toBe('succeeded');
    expect(stored.attempts.map((attempt: any) => ({ status: attempt.status, outcome: attempt.outcome }))).toEqual([
      { status: 'completed', outcome: 'result_valid' },
      { status: 'completed', outcome: 'result_valid' },
    ]);
    expect(stored.providerCalls.attempt).toMatchObject({ plannedCount: 2, startedCount: 2, completedCount: 2, outcomeUnknownCount: 0 });
    expect(stored.providerCalls.lineage).toEqual(stored.providerCalls.wizard);
    expect(stored.providerCalls.wizard).toMatchObject({ plannedCount: 2, startedCount: 2, completedCount: 2, outcomeUnknownCount: 0 });
    expect(stored.temp.candidates).toHaveLength(1);
  }, 30_000);
});
