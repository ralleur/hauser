import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import http from 'node:http';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import net from 'node:net';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Buffer } from 'node:buffer';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { execFileSync } from 'node:child_process';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { basename, join } from 'node:path';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import process from 'node:process';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Readable } from 'node:stream';
// @ts-expect-error The production server intentionally remains native Node ESM without declarations.
import { createHmiServer, createRoomImageAuthConfig, createRoomImageUploadStore, normalizeRoomImageIdentity, parseRoomImageCidr, parseRoomImageContentLength, readBoundedRoomImageBody, roomImagePeerAllowed } from '../../../server.mjs';

const servers: any[] = [];
const roots: string[] = [];
const ORIGIN = 'http://room-image-client.fixture';
const IDENTITY_HEADER = 'x-room-user';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function tempRoot(prefix = 'hauser-room-images-b2-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function completeAuth(cidrs = '127.0.0.1/32') {
  return createRoomImageAuthConfig({
    mode: 'trusted_proxy',
    trustedProxyCidrs: cidrs,
    identityHeader: IDENTITY_HEADER,
  });
}

async function start(options: Record<string, unknown> = {}) {
  const root = tempRoot();
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>fixture</title>');
  const uploadRoot = join(root, 'uploads');
  const roomImageUploadStore = createRoomImageUploadStore({ root: uploadRoot });
  const server = createHmiServer('', {
    staticRoot,
    paperlessPin: '',
    paperlessToken: '',
    allowedOrigins: new Set([ORIGIN]),
    roomImageAuthConfig: completeAuth(),
    roomImageUploadStore,
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    port: (server.address() as { port: number }).port,
    root,
    uploadRoot,
    store: roomImageUploadStore,
  };
}

function trustedHeaders(extra: Record<string, string> = {}) {
  return { [IDENTITY_HEADER]: '  fixture-user  ', origin: ORIGIN, ...extra };
}

function nodeRequest(
  port: number,
  path: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string | string[]>; body?: Uint8Array | string } = {},
) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method, headers }, (response: any) => {
      const chunks: Uint8Array[] = [];
      response.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function upload(base: string, bytes: Uint8Array, mimeType: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/room-image-uploads`, {
    method: 'POST',
    headers: {
      ...trustedHeaders(),
      'content-type': mimeType,
      'content-length': String(bytes.byteLength),
      ...headers,
    },
    body: bytes as BodyInit,
  });
}

describe('B-08E10 B2 trusted proxy boundary', () => {
  it('keeps the native Node server directly importable without a TypeScript loader', () => {
    const serverUrl = new URL('../../../server.mjs', import.meta.url).href;
    expect(execFileSync('node', ['-e', `import(${JSON.stringify(serverUrl)})`], { encoding: 'utf8' })).toBe('');
  });

  it('parses, masks and canonicalizes IPv4, IPv6 and mapped CIDRs', () => {
    expect(parseRoomImageCidr('198.51.100.25/24')).toMatchObject({ family: 4, prefix: 24, canonical: '198.51.100.0/24' });
    expect(parseRoomImageCidr('2001:db8:0:1::1234/64')).toMatchObject({ family: 6, prefix: 64, canonical: '2001:db8:0:1::/64' });
    expect(parseRoomImageCidr('::ffff:192.0.2.129/120')).toMatchObject({ family: 4, prefix: 24, canonical: '192.0.2.0/24' });
    expect(roomImagePeerAllowed('::ffff:192.0.2.42', [parseRoomImageCidr('192.0.2.129/24')])).toBe(true);
    expect(roomImagePeerAllowed('2001:db8:0:1::99', [parseRoomImageCidr('2001:db8:0:1::1/64')])).toBe(true);
    expect(roomImagePeerAllowed('2001:db8::1', [parseRoomImageCidr('192.0.2.0/24')])).toBe(false);
  });

  it.each([
    '0.0.0.1/0',
    '::1/0',
    '::ffff:0:0/96',
    '::ffff:192.0.2.1/95',
    '192.0.2.1/33',
    '2001:db8::1/129',
    '198.51.100.001/24',
    'not-an-address/24',
  ])('rejects invalid or semantic all-network CIDR %s', (cidr) => {
    expect(() => parseRoomImageCidr(cidr)).toThrow();
  });

  it('disables the complete static boundary if any required field or CIDR is invalid', () => {
    expect(createRoomImageAuthConfig({ mode: 'proxy', trustedProxyCidrs: '127.0.0.1/32', identityHeader: IDENTITY_HEADER }).configured).toBe(false);
    expect(createRoomImageAuthConfig({ mode: 'direct' })).toEqual({ configured: true, mode: 'direct', identityHeader: null, cidrs: [] });
    expect(createRoomImageAuthConfig({ mode: 'trusted_proxy', trustedProxyCidrs: '', identityHeader: IDENTITY_HEADER }).configured).toBe(false);
    expect(createRoomImageAuthConfig({ mode: 'trusted_proxy', trustedProxyCidrs: '127.0.0.1/32,bad/24', identityHeader: IDENTITY_HEADER }).configured).toBe(false);
    expect(createRoomImageAuthConfig({ mode: 'trusted_proxy', trustedProxyCidrs: '127.0.0.1/32', identityHeader: 'bad header' }).configured).toBe(false);
    expect(completeAuth()).toMatchObject({ configured: true, identityHeader: IDENTITY_HEADER });
  });

  it.each([
    ',127.0.0.1/32',
    '127.0.0.1/32,',
    '127.0.0.1/32,,192.0.2.1/32',
  ])('fails closed when the CIDR list contains an empty segment: %s', (trustedProxyCidrs) => {
    expect(createRoomImageAuthConfig({
      mode: 'trusted_proxy',
      trustedProxyCidrs,
      identityHeader: IDENTITY_HEADER,
    })).toEqual({ configured: false, mode: null, identityHeader: null, cidrs: [] });
  });

  it('prioritizes static config, socket peer and raw identity without requiring Origin for read-only details', async () => {
    const missing = await start({ roomImageAuthConfig: createRoomImageAuthConfig({ mode: '', trustedProxyCidrs: '', identityHeader: '' }) });
    const missingResponse = await fetch(`${missing.base}/api/room-images/capability/details`, {
      headers: trustedHeaders(),
    });
    expect(missingResponse.status).toBe(503);
    expect(await missingResponse.json()).toMatchObject({ ok: false, code: 'AUTH_BOUNDARY_MISSING', retryable: false });

    const untrusted = await start({ roomImageAuthConfig: completeAuth('192.0.2.0/24') });
    const forbidden = await fetch(`${untrusted.base}/api/room-images/capability/details`, {
      headers: { [IDENTITY_HEADER]: 'bad,spoof', origin: ORIGIN, forwarded: 'for=192.0.2.1', 'x-forwarded-for': '192.0.2.1' },
    });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe('ROOM_IMAGE_AUTH_FORBIDDEN');

    const trusted = await start();
    for (const value of [undefined, '', '   ', 'one,two']) {
      const headers: Record<string, string> = { origin: ORIGIN };
      if (value !== undefined) headers[IDENTITY_HEADER] = value;
      const response = await fetch(`${trusted.base}/api/room-images/capability/details`, { headers });
      expect(response.status, JSON.stringify(value)).toBe(401);
      expect((await response.json()).code).toBe('ROOM_IMAGE_AUTH_REQUIRED');
    }
    expect(normalizeRoomImageIdentity([IDENTITY_HEADER, 'bad\u0001value'], IDENTITY_HEADER)).toBeNull();
    expect(normalizeRoomImageIdentity([IDENTITY_HEADER, 'x'.repeat(257)], IDENTITY_HEADER)).toBeNull();
    const duplicate = await nodeRequest(trusted.port, '/api/room-images/capability/details', {
      headers: { [IDENTITY_HEADER]: ['first', 'second'], origin: ORIGIN },
    });
    expect(duplicate.status).toBe(401);
    expect(JSON.parse(duplicate.body).code).toBe('ROOM_IMAGE_AUTH_REQUIRED');

    const noOrigin = await fetch(`${trusted.base}/api/room-images/capability/details`, {
      headers: { [IDENTITY_HEADER]: 'fixture-user' },
    });
    expect(noOrigin.status).toBe(200);
    expect(await noOrigin.json()).toMatchObject({
      provider: 'openai',
      reasonCode: 'CREDENTIAL_MISSING',
    });
    const foreignOrigin = await fetch(`${trusted.base}/api/room-images/capability/details`, {
      headers: { [IDENTITY_HEADER]: 'fixture-user', origin: 'https://evil.invalid' },
    });
    expect(foreignOrigin.status).toBe(200);
    expect(await foreignOrigin.json()).toMatchObject({
      provider: 'openai',
      reasonCode: 'CREDENTIAL_MISSING',
    });
  });
});

describe('B-08E10 B2 capability routes', () => {
  it('keeps the public GET and HEAD closed and invariant across peer, identity, Origin and spoof headers', async () => {
    const app = await start({ roomImageAuthConfig: completeAuth('192.0.2.0/24') });
    const variants: Array<Record<string, string>> = [
      {},
      { [IDENTITY_HEADER]: '' },
      { [IDENTITY_HEADER]: 'spoofed', origin: 'https://evil.invalid', forwarded: 'for=192.0.2.1', 'x-forwarded-for': '192.0.2.1' },
    ];
    const payloads = [];
    for (const headers of variants) {
      const response = await fetch(`${app.base}/api/room-images/capability`, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      payloads.push(await response.json());
    }
    expect(payloads).toEqual(Array(variants.length).fill({
      enabled: false,
      imageCapability: 'disabled',
      reasonCode: 'CREDENTIAL_MISSING',
    }));

    const get = await fetch(`${app.base}/api/room-images/capability`);
    const head = await fetch(`${app.base}/api/room-images/capability`, { method: 'HEAD' });
    expect(head.status).toBe(get.status);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('cache-control')).toBe(get.headers.get('cache-control'));
    expect(await head.text()).toBe('');
  });

  it('uses an injected pure test capability only to expose downstream base states', async () => {
    const missing = await start({
      roomImageAuthConfig: createRoomImageAuthConfig({ mode: '', trustedProxyCidrs: '', identityHeader: '' }),
      roomImageTestCapability: { releaseEnabled: true, credentialConfigured: true, ready: true },
    });
    expect(await (await fetch(`${missing.base}/api/room-images/capability`)).json()).toEqual({
      enabled: false, imageCapability: 'disabled', reasonCode: 'AUTH_BOUNDARY_MISSING',
    });

    const noCredential = await start({
      roomImageTestCapability: { releaseEnabled: true, credentialConfigured: false, ready: false },
    });
    expect(await (await fetch(`${noCredential.base}/api/room-images/capability`)).json()).toEqual({
      enabled: false, imageCapability: 'disabled', reasonCode: 'CREDENTIAL_MISSING',
    });

    const unverified = await start({
      roomImageTestCapability: { releaseEnabled: true, credentialConfigured: true, ready: false },
    });
    expect(await (await fetch(`${unverified.base}/api/room-images/capability`)).json()).toEqual({
      enabled: true, imageCapability: 'unverified', reasonCode: 'UNVERIFIED',
    });
  });

  it('protects private details and probe, preserves HEAD semantics and performs no network fetch', async () => {
    const fetchSentinel = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Room-image routes must not fetch'));
    const deleteOwn = vi.fn();
    const providerProbe = vi.fn().mockResolvedValue({ definitiveResponse: true, status: 200, modelVisible: true });
    const app = await start({ roomImageUploadStore: { deleteOwn }, roomImageJobRunner: { probe: providerProbe } });
    const detailsHeaders = { [IDENTITY_HEADER]: 'fixture-user' };
    const details = await nodeRequest(app.port, '/api/room-images/capability/details', { headers: detailsHeaders });
    expect(details.status).toBe(200);
    expect(JSON.parse(details.body)).toMatchObject({
      enabled: false,
      provider: 'openai',
      imageCapability: 'credential_missing',
      reasonCode: 'CREDENTIAL_MISSING',
      model: 'gpt-image-2-2026-04-21',
      limits: { maxUploadBytes: 12_582_912, maxDecodedPixels: 24_000_000 },
    });
    const head = await nodeRequest(app.port, '/api/room-images/capability/details', { method: 'HEAD', headers: detailsHeaders });
    expect(head.status).toBe(details.status);
    expect(head.headers['content-type']).toBe(details.headers['content-type']);
    expect(head.headers['cache-control']).toBe(details.headers['cache-control']);
    expect(head.body).toBe('');

    const forbiddenProbe = await nodeRequest(app.port, '/api/room-images/probe', {
      method: 'POST', headers: { [IDENTITY_HEADER]: 'fixture-user' },
    });
    expect(forbiddenProbe.status).toBe(403);
    expect(JSON.parse(forbiddenProbe.body).code).toBe('ORIGIN_FORBIDDEN');
    expect(providerProbe).not.toHaveBeenCalled();
    const forbiddenDelete = await nodeRequest(app.port, `/api/room-image-uploads/${'a'.repeat(43)}`, {
      method: 'DELETE', headers: { [IDENTITY_HEADER]: 'fixture-user' },
    });
    expect(forbiddenDelete.status).toBe(403);
    expect(JSON.parse(forbiddenDelete.body).code).toBe('ORIGIN_FORBIDDEN');
    expect(deleteOwn).not.toHaveBeenCalled();

    const probe = await nodeRequest(app.port, '/api/room-images/probe', { method: 'POST', headers: trustedHeaders() });
    expect(probe.status).toBe(200);
    expect(JSON.parse(probe.body)).toMatchObject({ enabled: false, imageCapability: 'unverified', reasonCode: 'CREDENTIAL_MISSING' });
    expect(providerProbe).toHaveBeenCalledTimes(1);
    expect(fetchSentinel).not.toHaveBeenCalled();
  });
});

describe('B-08E10 B2 upload and temp lifecycle', () => {
  it('keeps productive server creation on the fixed non-persistent upload root despite a forbidden environment value', () => {
    const root = tempRoot('hauser-room-image-forbidden-root-');
    const forbiddenRoot = join(root, 'config', 'room-images', 'uploads');
    const serverUrl = new URL('../../../server.mjs', import.meta.url).href;
    const output = execFileSync('node', ['--input-type=module', '-e', `
      import { existsSync } from 'node:fs';
      const { createHmiServer } = await import(${JSON.stringify(serverUrl)});
      const observedRoots = [];
      createHmiServer('', {
        paperlessPin: '',
        paperlessToken: '',
        roomImageUploadStoreFactory(options) {
          observedRoots.push(options.root);
          return {};
        },
      });
      process.stdout.write(JSON.stringify({
        observedRoots,
        forbiddenRootExists: existsSync(process.env.HMI_ROOM_IMAGE_UPLOAD_ROOT),
      }));
    `], {
      encoding: 'utf8',
      env: { ...process.env, HMI_ROOM_IMAGE_UPLOAD_ROOT: forbiddenRoot },
    });
    expect(JSON.parse(output)).toEqual({
      observedRoots: ['/tmp/hauser-room-images/uploads'],
      forbiddenRootExists: false,
    });
  });

  it('rejects a pre-existing symlink upload root instead of following it', () => {
    const parent = tempRoot('hauser-room-image-symlink-parent-');
    const target = tempRoot('hauser-room-image-symlink-target-');
    const uploadRoot = join(parent, 'uploads');
    symlinkSync(target, uploadRoot, 'dir');

    expect(() => createRoomImageUploadStore({ root: uploadRoot })).toThrowError(expect.objectContaining({
      code: 'ROOM_IMAGE_UPLOAD_ROOT_UNSAFE',
    }));
    expect(lstatSync(uploadRoot).isSymbolicLink()).toBe(true);
  });

  it('allows an upload root directly beneath the lexical OS temp root', () => {
    const uploadRoot = tempRoot('hauser-room-image-direct-temp-root-');

    const store = createRoomImageUploadStore({ root: uploadRoot });

    expect(store.root).toBe(uploadRoot);
    expect(lstatSync(uploadRoot).isDirectory()).toBe(true);
    expect(lstatSync(uploadRoot).isSymbolicLink()).toBe(false);
  });

  it('rejects a controlled parent symlink aliasing the OS temp root', () => {
    const sandbox = tempRoot('hauser-room-image-temp-alias-sandbox-');
    const target = tempRoot('hauser-room-image-temp-alias-target-');
    const tempAlias = join(sandbox, 'tmp-alias');
    symlinkSync(tmpdir(), tempAlias, 'dir');

    expect(() => createRoomImageUploadStore({
      root: join(tempAlias, basename(target)),
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_UPLOAD_ROOT_UNSAFE' }));
    expect(lstatSync(tempAlias).isSymbolicLink()).toBe(true);
  });

  it('rejects group/world-writable or foreign-owned controlled parent/root directories', () => {
    const unsafeParent = tempRoot('hauser-room-image-unsafe-parent-');
    chmodSync(unsafeParent, 0o770);
    expect(() => createRoomImageUploadStore({ root: join(unsafeParent, 'uploads') })).toThrowError(expect.objectContaining({
      code: 'ROOM_IMAGE_UPLOAD_ROOT_UNSAFE',
    }));

    const unsafeRoot = tempRoot('hauser-room-image-unsafe-root-');
    chmodSync(unsafeRoot, 0o707);
    expect(() => createRoomImageUploadStore({ root: unsafeRoot })).toThrowError(expect.objectContaining({
      code: 'ROOM_IMAGE_UPLOAD_ROOT_UNSAFE',
    }));

    if (typeof process.getuid === 'function') {
      const foreignRoot = tempRoot('hauser-room-image-foreign-root-');
      const actualUid = process.getuid();
      const uid = vi.spyOn(process, 'getuid').mockReturnValue(actualUid + 1);
      expect(() => createRoomImageUploadStore({ root: foreignRoot })).toThrowError(expect.objectContaining({
        code: 'ROOM_IMAGE_UPLOAD_ROOT_UNSAFE',
      }));
      uid.mockRestore();
    }
  });

  it.each([
    ['orientation-6.jpg', 'image/jpeg', 80, 120],
    ['neutral-alpha.png', 'image/png', 640, 480],
    ['neutral-oriented.webp', 'image/webp', 80, 120],
  ])('accepts and normalizes %s without persisting original bytes or metadata', async (name, mimeType, width, height) => {
    const app = await start();
    const bytes = fixture(name);
    const response = await upload(app.base, bytes, mimeType);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = await response.json();
    expect(payload).toMatchObject({ width, height, mimeType });
    expect(payload.uploadId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.now());

    const names = readdirSync(app.uploadRoot).sort();
    expect(names).toEqual([`${payload.uploadId}.json`, `${payload.uploadId}.png`]);
    const normalized = readFileSync(join(app.uploadRoot, `${payload.uploadId}.png`));
    expect(normalized.equals(bytes)).toBe(false);
    const metadata = await sharp(normalized).metadata();
    expect(metadata).toMatchObject({ format: 'png', width, height, space: 'srgb', hasAlpha: false });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it.each([
    ['image/jpeg', 'neutral-alpha.png'],
    ['image/png', 'orientation-1.jpg'],
    ['image/webp', 'animated-two-frame.webp'],
  ])('rejects mismatch or animation for %s / %s without partials', async (mimeType, name) => {
    const app = await start();
    const response = await upload(app.base, fixture(name), mimeType);
    expect([400, 415, 422]).toContain(response.status);
    expect(await response.json()).toMatchObject({ ok: false, retryable: false });
    expect(readdirSync(app.uploadRoot)).toEqual([]);
  });

  it('rejects unsupported exact media types, SVG and HEIC before persistence', async () => {
    const app = await start();
    const png = fixture('neutral-alpha.png');
    for (const [mimeType, bytes] of [
      ['image/png; charset=binary', png],
      ['image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
      ['image/heic', Buffer.from('000000186674797068656963', 'hex')],
    ] as const) {
      const response = await upload(app.base, bytes, mimeType);
      expect(response.status).toBe(415);
    }
    expect(readdirSync(app.uploadRoot)).toEqual([]);
  });

  it('rejects missing and oversized Content-Length before body processing', async () => {
    const app = await start();
    const missing = await nodeRequest(app.port, '/api/room-image-uploads', {
      method: 'POST',
      headers: { ...trustedHeaders(), 'content-type': 'image/png', 'transfer-encoding': 'chunked' },
      body: fixture('neutral-alpha.png'),
    });
    expect(missing.status).toBe(411);
    expect(JSON.parse(missing.body).code).toBe('CONTENT_LENGTH_REQUIRED');

    const oversized = await nodeRequest(app.port, '/api/room-image-uploads', {
      method: 'POST',
      headers: { ...trustedHeaders(), 'content-type': 'image/png', 'content-length': '12582913' },
    });
    expect(oversized.status).toBe(413);
    expect(JSON.parse(oversized.body).code).toBe('UPLOAD_TOO_LARGE');
    expect(readdirSync(app.uploadRoot)).toEqual([]);
  });

  it('parses malformed, negative and multiple Content-Length fail-closed with stable errors and no temp writes', () => {
    const root = tempRoot('hauser-room-image-length-parser-');
    createRoomImageUploadStore({ root });
    const cases = [
      ['malformed', ['Content-Length', '12x']],
      ['negative', ['Content-Length', '-1']],
      ['multiple', ['Content-Length', '1', 'content-length', '1']],
    ] as const;
    for (const [label, rawHeaders] of cases) {
      expect(parseRoomImageContentLength([...rawHeaders]), label).toEqual({
        ok: false,
        status: 400,
        payload: {
          ok: false,
          code: 'INVALID_CONTENT_LENGTH',
          message: 'Content-Length ist ungültig oder inkohärent.',
          retryable: false,
        },
      });
    }
    expect(readdirSync(root)).toEqual([]);
  });

  it('enforces the real streaming limit and actual Content-Length parity without temp writes', async () => {
    const root = tempRoot('hauser-room-image-body-reader-');
    createRoomImageUploadStore({ root });
    const maxBytes = 12_582_912;
    const oversized = Readable.from([Buffer.alloc(maxBytes), Buffer.from([0])]) as any;
    oversized.complete = true;
    await expect(readBoundedRoomImageBody(oversized, maxBytes)).rejects.toMatchObject({
      status: 413,
      code: 'UPLOAD_TOO_LARGE',
      message: 'Das Bild überschreitet die Uploadgrenze von 12 MiB.',
    });

    const mismatched = Readable.from([Buffer.from('short')]) as any;
    mismatched.complete = true;
    await expect(readBoundedRoomImageBody(mismatched, 6)).rejects.toMatchObject({
      status: 400,
      code: 'CONTENT_LENGTH_MISMATCH',
      message: 'Die tatsächliche Uploadlänge stimmt nicht mit Content-Length überein.',
    });
    expect(readdirSync(root)).toEqual([]);
  });

  it('rejects the 24 MPixel bomb and cleans a disconnected partial request', async () => {
    const app = await start();
    const bomb = await upload(app.base, fixture('pixel-bomb-25mp.png'), 'image/png');
    expect([413, 422]).toContain(bomb.status);
    expect(readdirSync(app.uploadRoot)).toEqual([]);

    await new Promise<void>((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: app.port }, () => {
        socket.write([
          'POST /api/room-image-uploads HTTP/1.1',
          'Host: 127.0.0.1',
          `Origin: ${ORIGIN}`,
          `${IDENTITY_HEADER}: fixture-user`,
          'Content-Type: image/png',
          'Content-Length: 1000',
          '',
          'partial',
        ].join('\r\n'));
        socket.destroy();
        resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(readdirSync(app.uploadRoot)).toEqual([]);
  });

  it('enforces 30-minute TTL, startup orphan cleanup and preservation of unknown root entries', async () => {
    let clock = Date.parse('2026-08-03T10:00:00.000Z');
    const root = tempRoot('hauser-room-image-store-');
    const store = createRoomImageUploadStore({ root, now: () => clock });
    const created = store.create('fixture-user', {
      buffer: fixture('neutral-alpha.png'), width: 640, height: 480, mimeType: 'image/png',
    });
    expect(created.expiresAt).toBe('2026-08-03T10:30:00.000Z');
    writeFileSync(join(root, `${'a'.repeat(43)}.png`), 'orphan');
    writeFileSync(join(root, `.upload-${'b'.repeat(43)}-${'c'.repeat(16)}.tmp`), 'partial');
    writeFileSync(join(root, 'do-not-touch.txt'), 'foreign');

    const restarted = createRoomImageUploadStore({ root, now: () => clock });
    expect(restarted.hasOwn('fixture-user', created.uploadId)).toBe(true);
    expect(existsSync(join(root, `${'a'.repeat(43)}.png`))).toBe(false);
    expect(existsSync(join(root, `.upload-${'b'.repeat(43)}-${'c'.repeat(16)}.tmp`))).toBe(false);
    expect(readFileSync(join(root, 'do-not-touch.txt'), 'utf8')).toBe('foreign');

    clock += 30 * 60 * 1000;
    restarted.cleanup();
    expect(restarted.hasOwn('fixture-user', created.uploadId)).toBe(false);
    expect(readdirSync(root)).toEqual(['do-not-touch.txt']);
  });

  it('fails store startup closed when an owned syntactic partial cannot be removed', () => {
    const root = tempRoot('hauser-room-image-startup-partial-cleanup-failure-');
    const partial = join(root, `.upload-${'a'.repeat(43)}-${'b'.repeat(16)}.tmp`);
    writeFileSync(partial, 'owned partial');

    expect(() => createRoomImageUploadStore({
      root,
      removeFile(path: string) {
        if (path === partial) throw Object.assign(new Error('injected partial unlink failure'), { code: 'EACCES' });
        unlinkSync(path);
      },
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_UPLOAD_CLEANUP_FAILED' }));
    expect(readFileSync(partial, 'utf8')).toBe('owned partial');
  });

  it('surfaces cleanup failure when an atomic rename and its partial removal both fail', async () => {
    const root = tempRoot('hauser-room-image-atomic-partial-cleanup-failure-');
    let rejectPartialRemoval = false;
    const store = createRoomImageUploadStore({
      root,
      removeFile(path: string) {
        if (rejectPartialRemoval && /^\.upload-.*\.tmp$/.test(basename(path))) {
          throw Object.assign(new Error('injected atomic partial unlink failure'), { code: 'EACCES' });
        }
        unlinkSync(path);
      },
    });
    const created = store.create('fixture-user', {
      buffer: fixture('neutral-alpha.png'), width: 640, height: 480, mimeType: 'image/png',
    });
    const metadataPath = join(root, `${created.uploadId}.json`);
    unlinkSync(metadataPath);
    mkdirSync(metadataPath);
    rejectPartialRemoval = true;

    await expect(store.bindForJob('fixture-user', created.uploadId)).rejects.toMatchObject({
      code: 'ROOM_IMAGE_UPLOAD_CLEANUP_FAILED',
    });
    const partials = readdirSync(root).filter((name: string) => /^\.upload-.*\.tmp$/.test(name));
    expect(partials).toHaveLength(1);
    expect(lstatSync(join(root, partials[0])).isFile()).toBe(true);
  });

  it('treats a persisted in-use upload as consumed after restart and never rebinds it', async () => {
    const root = tempRoot('hauser-room-image-consumed-restart-');
    const store = createRoomImageUploadStore({ root });
    const created = store.create('fixture-user', {
      buffer: fixture('neutral-alpha.png'), width: 640, height: 480, mimeType: 'image/png',
    });
    expect(await store.bindForJob('fixture-user', created.uploadId)).not.toBeNull();
    expect(JSON.parse(readFileSync(join(root, `${created.uploadId}.json`), 'utf8')).inUse).toBe(true);

    const restarted = createRoomImageUploadStore({ root });
    expect(restarted.hasOwn('fixture-user', created.uploadId)).toBe(false);
    expect(await restarted.bindForJob('fixture-user', created.uploadId)).toBeNull();
    expect(readdirSync(root)).toEqual([]);
  });

  it('returns a controlled HTTP error and keeps a partially deleted upload non-bindable', async () => {
    const root = tempRoot('hauser-room-image-delete-cleanup-failure-');
    const store = createRoomImageUploadStore({
      root,
      removeFile(path: string) {
        if (path.endsWith('.json')) throw Object.assign(new Error('injected metadata unlink failure'), { code: 'EACCES' });
        unlinkSync(path);
      },
    });
    const app = await start({ roomImageUploadStore: store });
    const created = await (await upload(app.base, fixture('neutral-alpha.png'), 'image/png')).json();

    const response = await fetch(`${app.base}/api/room-image-uploads/${created.uploadId}`, {
      method: 'DELETE', headers: trustedHeaders(),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false, code: 'ROOM_IMAGE_UPLOAD_CLEANUP_FAILED', retryable: false,
    });
    expect(await store.bindForJob('fixture-user', created.uploadId)).toBeNull();
    expect(JSON.parse(readFileSync(join(root, `${created.uploadId}.json`), 'utf8')).inUse).toBe(true);
  });

  it('keeps a consumed upload fail-closed when post-handoff cleanup is only partially successful', async () => {
    const root = tempRoot('hauser-room-image-partial-cleanup-');
    let rejectMetadataRemoval = true;
    const store = createRoomImageUploadStore({
      root,
      removeFile(path: string) {
        if (rejectMetadataRemoval && path.endsWith('.json')) {
          throw Object.assign(new Error('injected metadata unlink failure'), { code: 'EACCES' });
        }
        unlinkSync(path);
      },
    });
    const created = store.create('fixture-user', {
      buffer: fixture('neutral-alpha.png'), width: 640, height: 480, mimeType: 'image/png',
    });
    const binding = await store.bindForJob('fixture-user', created.uploadId);

    await expect(binding!.materializeProviderJpeg(
      { x: 0.1, y: 0.1, width: 0.795, height: 0.75 },
      async () => 'handed-off',
    )).rejects.toMatchObject({ code: 'ROOM_IMAGE_UPLOAD_CLEANUP_FAILED' });
    expect(existsSync(join(root, `${created.uploadId}.png`))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, `${created.uploadId}.json`), 'utf8')).inUse).toBe(true);
    expect(await store.bindForJob('fixture-user', created.uploadId)).toBeNull();

    rejectMetadataRemoval = false;
    const restarted = createRoomImageUploadStore({ root });
    expect(await restarted.bindForJob('fixture-user', created.uploadId)).toBeNull();
    expect(readdirSync(root)).toEqual([]);
  });

  it('fails store startup closed when a consumed upload cannot be completely removed', async () => {
    const root = tempRoot('hauser-room-image-startup-cleanup-failure-');
    const store = createRoomImageUploadStore({ root });
    const created = store.create('fixture-user', {
      buffer: fixture('neutral-alpha.png'), width: 640, height: 480, mimeType: 'image/png',
    });
    expect(await store.bindForJob('fixture-user', created.uploadId)).not.toBeNull();

    expect(() => createRoomImageUploadStore({
      root,
      removeFile(path: string) {
        if (path.endsWith('.png')) throw Object.assign(new Error('injected source unlink failure'), { code: 'EACCES' });
        unlinkSync(path);
      },
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_UPLOAD_CLEANUP_FAILED' }));
    expect(existsSync(join(root, `${created.uploadId}.png`))).toBe(true);
    expect(await store.bindForJob('fixture-user', created.uploadId)).toBeNull();

    const recovered = createRoomImageUploadStore({ root });
    expect(await recovered.bindForJob('fixture-user', created.uploadId)).toBeNull();
    expect(readdirSync(root)).toEqual([]);
  });

  it('isolates identities, keeps delete idempotent and materializes an exact provider JPEG under a binding', async () => {
    const root = tempRoot('hauser-room-image-binding-');
    const store = createRoomImageUploadStore({ root });
    const app = await start({ roomImageUploadStore: store });
    const uploaded = await (await upload(app.base, fixture('neutral-alpha.png'), 'image/png')).json();

    const foreignDelete = await fetch(`${app.base}/api/room-image-uploads/${uploaded.uploadId}`, {
      method: 'DELETE', headers: { [IDENTITY_HEADER]: 'other-user', origin: ORIGIN },
    });
    expect(foreignDelete.status).toBe(204);
    expect(store.hasOwn('fixture-user', uploaded.uploadId)).toBe(true);
    expect(await store.bindForJob('other-user', uploaded.uploadId)).toBeNull();

    const binding = await store.bindForJob('fixture-user', uploaded.uploadId);
    expect(binding).not.toBeNull();
    const inUse = await fetch(`${app.base}/api/room-image-uploads/${uploaded.uploadId}`, {
      method: 'DELETE', headers: trustedHeaders(),
    });
    expect(inUse.status).toBe(409);
    expect((await inUse.json()).code).toBe('UPLOAD_IN_USE');

    let handedOff = false;
    const result = await binding!.materializeProviderJpeg(
      { x: 0.1, y: 0.1, width: 0.795, height: 0.75 },
      async (jpeg: Uint8Array) => {
        const metadata = await sharp(jpeg).metadata();
        expect(metadata).toMatchObject({ format: 'jpeg', width: 3392, height: 2400, space: 'srgb' });
        expect(jpeg.byteLength).toBeLessThan(50_000_000);
        handedOff = true;
        return 'persisted';
      },
    );
    expect(result).toBe('persisted');
    expect(handedOff).toBe(true);
    expect(store.hasOwn('fixture-user', uploaded.uploadId)).toBe(false);
    expect(readdirSync(root)).toEqual([]);

    const deletedAgain = await fetch(`${app.base}/api/room-image-uploads/${uploaded.uploadId}`, {
      method: 'DELETE', headers: trustedHeaders(),
    });
    expect(deletedAgain.status).toBe(204);
    const noDownload = await fetch(`${app.base}/api/room-image-uploads/${uploaded.uploadId}`, { headers: trustedHeaders() });
    expect(noDownload.status).not.toBe(200);
  });
});
