import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Buffer } from 'node:buffer';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { spawn } from 'node:child_process';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { createHash } from 'node:crypto';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { dirname, join } from 'node:path';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { createServer as createNetServer } from 'node:net';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import process from 'node:process';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { fileURLToPath } from 'node:url';
// @ts-expect-error The production server intentionally remains native Node ESM without declarations.
import { createCentralConfigStore, createConfigMutationCoordinator, createHmiServer, createRoomImageAssetStore, createRoomImageAuthConfig, createRoomImageJobStore, recoverSetupConfigTransactions, validateRoomImagePreviewBytes } from '../../../server.mjs';
import { compileHouseholdConfig, parseHouseholdConfig } from '../config/household-config.ts';
import { projectActiveHouseholdData } from '../config/household-runtime-data.ts';
import { providerPngToFinalAvif } from './room-image-transform-policy-v1';

const ORIGIN = 'http://room-image-b4.fixture';
const IDENTITY_HEADER = 'x-room-user';
const roots: string[] = [];
const servers: any[] = [];
const bytes = (value: string) => new TextEncoder().encode(value);

function root(prefix = 'hauser-room-image-b4-') {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function authConfig() {
  return createRoomImageAuthConfig({
    mode: 'trusted_proxy', trustedProxyCidrs: '127.0.0.1/32', identityHeader: IDENTITY_HEADER,
  });
}

function privateHeaders(extra: Record<string, string> = {}) {
  return { [IDENTITY_HEADER]: 'fixture-user', origin: ORIGIN, ...extra };
}

function mainRequest() {
  return {
    kind: 'main_candidates', clientRequestId: '11111111-1111-4111-8111-111111111111',
    uploadId: 'u'.repeat(43), crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    canonicalCropPixels: { x: 1, y: 1, width: 10, height: 10 },
    focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
    stylePreset: 'hauser-room-v1',
    adjustments: { declutter: 'light', tone: 'neutral', preserveFeatures: ['windows'] },
    candidateCount: 1, noticeVersion: 'room-image-v1', costConfirmed: true,
    confirmedProviderCalls: 2,
  };
}

function awaitingFinalJob(
  sandbox: string,
  avif = new TextEncoder().encode('fixture-avif'),
  now: () => number = () => 1_700_000_000_000,
  storeOptions: Record<string, any> = {},
) {
  const jobStore = createRoomImageJobStore({
    metadataRoot: join(sandbox, 'jobs'), tempRoot: join(sandbox, 'private'), now, ...storeOptions,
  });
  const main = jobStore.createMain('fixture-user', mainRequest(), bytes('source'), '1'.repeat(64)).record;
  const compositionAttempt = main.attempts[0];
  jobStore.transition(main.jobId, compositionAttempt.providerAttemptId, 'main-composition-start', 'started');
  jobStore.commitProviderTransition(main.jobId, compositionAttempt.providerAttemptId, 'main-composition-complete', {
    target: 'completed', outcome: 'result_valid', result: { type: 'composition', bytes: bytes('jpeg') },
  });
  const candidateAttempt = jobStore.get(main.jobId).attempts[1];
  const candidateId = 'c'.repeat(43);
  jobStore.transition(main.jobId, candidateAttempt.providerAttemptId, 'main-candidate-start', 'started');
  jobStore.commitProviderTransition(main.jobId, candidateAttempt.providerAttemptId, 'main-candidate-complete', {
    target: 'completed', outcome: 'result_valid',
    result: { type: 'candidate', candidateId, previewBytes: avif, providerBytes: bytes('jpeg') },
    jobState: {
      status: 'succeeded', phase: 'complete', cancellable: true,
      retryable: false, discardable: false, retry: null, error: null,
    },
  });
  const finalRequest = {
    kind: 'variant_set', clientRequestId: '22222222-2222-4222-8222-222222222222',
    parentJobId: main.jobId, candidateId,
    focus: { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
    noticeVersion: 'room-image-v1', costConfirmed: true, confirmedProviderCalls: 2,
  };
  const final = jobStore.createFinal('fixture-user', finalRequest, main, '2'.repeat(64)).record;
  for (const [index, variant] of ['dark', 'darkOff'].entries()) {
    const attempt = jobStore.get(final.jobId).attempts[index];
    jobStore.transition(final.jobId, attempt.providerAttemptId, `final-${variant}-start`, 'started');
    jobStore.commitProviderTransition(final.jobId, attempt.providerAttemptId, `final-${variant}-complete`, {
      target: 'completed', outcome: 'result_valid',
      result: { type: 'final', variant, previewBytes: avif },
    });
  }
  jobStore.setJobState(final.jobId, { phase: 'validating_set' });
  expect(jobStore.commitFinalValidation(final.jobId, avif).result).toBe(true);
  return { jobStore, finalJobId: final.jobId };
}

function installHousehold(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  cpSync(new URL('../../../config/examples/neutral-small.json', import.meta.url), path);
}

async function startB4(options: Record<string, any> = {}) {
  const sandbox = options.sandbox ?? root();
  const staticRoot = join(sandbox, 'dist');
  mkdirSync(staticRoot, { recursive: true });
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
  const householdConfigPath = join(sandbox, 'config', 'household.json');
  if (options.installHousehold !== false) installHousehold(householdConfigPath);
  const prepared = options.prepared ?? awaitingFinalJob(
    sandbox,
    options.avif ?? new TextEncoder().encode('fixture-avif'),
    options.now ?? (() => 1_700_000_000_000),
    { transactionStep: options.jobTransactionStep ?? (() => undefined) },
  );
  const configPath = join(sandbox, 'shared.json');
  if (options.sharedValues) writeFileSync(configPath, `${JSON.stringify(options.sharedValues)}\n`);
  const server = createHmiServer('', {
    staticRoot, configPath, householdConfigPath, householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    paperlessPin: '', paperlessToken: '', allowedOrigins: new Set([ORIGIN]),
    roomImageAuthConfig: authConfig(), roomImageUploadStore: { cleanup() {} },
    roomImageJobStore: prepared.jobStore,
    roomImageJobRunner: { reserve: () => null, cancel: () => 'not_cancellable' },
    roomImageAssetRoot: join(sandbox, 'assets'),
    roomImageAssetCatalogPath: join(sandbox, 'config', 'room-images', 'assets.json'),
    roomImagePreviewValidator: async () => undefined,
    configMutationCoordinator: options.coordinator ?? createConfigMutationCoordinator(),
    ...(options.serverOptions ?? {}),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`, server, sandbox, householdConfigPath,
    configPath, ...prepared,
  };
}

async function stop(server: any) {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  await new Promise<void>((resolve) => server.close(resolve));
}

function publishRequest(app: { base: string; finalJobId: string }, extraHeaders: Record<string, string> = {}, body = '{"confirmed":true}') {
  return fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/publish`, {
    method: 'POST', headers: privateHeaders({ 'content-type': 'application/json', ...extraHeaders }), body,
  });
}

function setupPayload(householdConfigPath: string, roomName = 'Configured by setup') {
  const source = existsSync(householdConfigPath)
    ? householdConfigPath
    : new URL('../../../config/examples/neutral-small.json', import.meta.url);
  const householdConfig = JSON.parse(readFileSync(source, 'utf8'));
  householdConfig.rooms[0].name = roomName;
  return {
    haUrl: 'http://home-assistant.fixture', haToken: 'fixture-token',
    householdConfig, jellyfin: { enabled: false },
  };
}

function assignmentRequest(
  app: { base: string },
  roomId: string,
  etag: string,
  asset: any,
  body: string | null = null,
) {
  return fetch(`${app.base}/api/room-image-assignments/${roomId}`, {
    method: 'PUT',
    headers: privateHeaders({ 'content-type': 'application/json', 'if-match': etag }),
    body: body ?? JSON.stringify({ asset }),
  });
}

async function publishAsset(app: { base: string; finalJobId: string }) {
  const response = await publishRequest(app);
  expect(response.status).toBe(200);
  return response.json();
}

async function waitUntil(predicate: () => boolean, message: string) {
  for (let spin = 0; spin < 500; spin += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(message);
}

function observedCoordinator() {
  const base = createConfigMutationCoordinator();
  let runs = 0;
  const waiters: Array<{ target: number; resolve: () => void }> = [];
  function notify() {
    for (const waiter of waiters.splice(0)) {
      if (runs >= waiter.target) waiter.resolve();
      else waiters.push(waiter);
    }
  }
  return {
    coordinator: {
      run(operation: () => unknown) {
        runs += 1;
        notify();
        return base.run(operation);
      },
      runSync(operation: () => unknown) { return base.runSync(operation); },
    },
    runs: () => runs,
    waitForRuns(target: number) {
      if (runs >= target) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push({ target, resolve }));
    },
  };
}

async function startSetup(options: Record<string, any> = {}) {
  const sandbox = options.sandbox ?? root('hauser-room-image-b4-setup-');
  const staticRoot = join(sandbox, 'dist');
  mkdirSync(staticRoot, { recursive: true });
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
  const householdConfigPath = join(sandbox, 'config', 'household.json');
  const configPath = join(sandbox, 'config', 'shared.json');
  if (options.installHousehold !== false) installHousehold(householdConfigPath);
  if (options.sharedValues) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(options.sharedValues)}\n`, { mode: 0o600 });
  }
  const server = createHmiServer('', {
    staticRoot,
    configPath,
    householdConfigPath,
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    requiredWritableDirs: [sandbox],
    paperlessPin: '',
    paperlessToken: '',
    allowedOrigins: new Set([ORIGIN]),
    roomImageUploadStore: { cleanup() {} },
    configMutationCoordinator: options.coordinator ?? createConfigMutationCoordinator(),
    setupConnectionVerifier: options.setupConnectionVerifier ?? (async () => ({ ok: true })),
    setupJellyfinVerifier: async () => ({ ok: true }),
    ...(options.serverOptions ?? {}),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    server,
    sandbox,
    householdConfigPath,
    configPath,
  };
}

function setupRequest(
  app: { base: string; householdConfigPath: string },
  headers: Record<string, string> = {},
  roomName = 'Configured by setup',
) {
  return fetch(`${app.base}/api/setup/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: JSON.stringify(setupPayload(app.householdConfigPath, roomName)),
  });
}

function setupSharedBoundary(configPath: string) {
  const snapshot = createCentralConfigStore(configPath).responseSnapshot();
  return {
    ...snapshot,
    etag: `"${createHash('sha256').update(snapshot.body).digest('hex')}"`,
  };
}

function byteEtag(value: Uint8Array) {
  return `"${createHash('sha256').update(value).digest('hex')}"`;
}

function setupJournalState(value: Uint8Array | null) {
  return value === null
    ? { exists: false, sha256: null, bytes: null }
    : {
        exists: true,
        sha256: createHash('sha256').update(value).digest('hex'),
        bytes: Buffer.from(value).toString('base64'),
      };
}

function setupJournalPathBinding(value: string) {
  const temporaryRoot = tmpdir();
  const canonical = value.startsWith(`${temporaryRoot}/`)
    ? join(realpathSync(temporaryRoot), value.slice(temporaryRoot.length))
    : value;
  return createHash('sha256').update(canonical).digest('hex');
}

function setupArtifacts(sandbox: string) {
  const found: string[] = [];
  function visit(path: string, prefix = '') {
    if (!existsSync(path)) return;
    for (const name of readdirSync(path).sort()) {
      const absolute = join(path, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (name === '.hauser-setup-transactions' || name.startsWith('.setup-')
          || name.endsWith('.journal')) found.push(relative);
      if (lstatSync(absolute).isDirectory() && !lstatSync(absolute).isSymbolicLink()) {
        visit(absolute, relative);
      }
    }
  }
  visit(sandbox);
  return found;
}

async function runSetupCrashChild(sandbox: string, crashStep: string, exitCode: number) {
  const serverModule = new URL('../../../server.mjs', import.meta.url).href;
  const householdFixture = fileURLToPath(new URL('../../../config/examples/neutral-small.json', import.meta.url));
  const script = `
    import { createHmiServer } from ${JSON.stringify(serverModule)};
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const sandbox = ${JSON.stringify(sandbox)};
    const staticRoot = join(sandbox, 'dist');
    const configPath = join(sandbox, 'config', 'shared.json');
    const householdConfigPath = join(sandbox, 'config', 'household.json');
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
    const householdConfig = JSON.parse(readFileSync(${JSON.stringify(householdFixture)}, 'utf8'));
    householdConfig.rooms[0].name = 'Recovered child generation';
    const server = createHmiServer('', {
      staticRoot, configPath, householdConfigPath, householdConfigMode: 'active',
      householdConfigMigrationResult: { ok: true, status: 'current' }, requiredWritableDirs: [sandbox],
      paperlessPin: '', paperlessToken: '', allowedOrigins: new Set([${JSON.stringify(ORIGIN)}]),
      roomImageUploadStore: { cleanup() {} },
      setupConnectionVerifier: async () => ({ ok: true }),
      setupJellyfinVerifier: async () => ({ ok: true }),
      setupMutationStep(step) {
        if (step === ${JSON.stringify(crashStep)}) process.exit(${exitCode});
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/setup/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ${JSON.stringify(ORIGIN)} },
      body: JSON.stringify({
        haUrl: 'http://child-home-assistant.fixture',
        haToken: ['child', 'fixture', 'token'].join('-'),
        householdConfig,
        jellyfin: { enabled: false },
      }),
    });
    await response.arrayBuffer();
    await new Promise((resolve) => server.close(resolve));
    process.exit(91);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.on('data', (chunk: any) => { stdout = `${stdout}${chunk}`.slice(-4096); });
  child.stderr.on('data', (chunk: any) => { stderr = `${stderr}${chunk}`.slice(-4096); });
  return new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 5_000);
    child.once('error', (error: any) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code: number | null, signal: string | null) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function freeLocalPort() {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!port) throw new Error('No local probe port available');
  return port;
}

async function startExecutableServer(env: Record<string, string>) {
  const executable = fileURLToPath(new URL('../../../server.mjs', import.meta.url));
  const child = spawn(process.execPath, [executable], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: any) => { stdout = `${stdout}${chunk}`.slice(-4096); });
  child.stderr.on('data', (chunk: any) => { stderr = `${stderr}${chunk}`.slice(-4096); });
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code: number | null, signal: string | null) => resolve({ code, signal }));
  });
  return { child, closed, output: () => ({ stdout, stderr }) };
}

async function stopExecutableServer(child: any, closed: Promise<any>) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          resolve();
        }, 2_000);
      }),
    ]);
    if (child.exitCode === null && child.signalCode === null) await closed;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

function publishedInventory(sandbox: string) {
  const sets = join(sandbox, 'assets', 'room-images');
  const catalog = join(sandbox, 'config', 'room-images', 'assets.json');
  return {
    sets: existsSync(sets) ? readdirSync(sets).sort() : [],
    catalog: existsSync(catalog) ? JSON.parse(readFileSync(catalog, 'utf8')) : null,
  };
}

function persistentInventory(path: string) {
  const entries: Array<{ path: string; type: string; mode: number; sha256?: string; size?: number }> = [];
  function visit(absolute: string, relative = '.') {
    const metadata = lstatSync(absolute);
    if (metadata.isDirectory()) {
      entries.push({ path: relative, type: 'directory', mode: metadata.mode & 0o777 });
      for (const name of readdirSync(absolute).sort()) {
        visit(join(absolute, name), relative === '.' ? name : `${relative}/${name}`);
      }
      return;
    }
    const contents = readFileSync(absolute);
    entries.push({
      path: relative,
      type: metadata.isFile() ? 'file' : 'other',
      mode: metadata.mode & 0o777,
      size: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }
  visit(path);
  return entries;
}

describe('B-08E10 lane B4 publish, assets, ETags and assignment', () => {
  it('publishes one immutable set for concurrent confirmation and replays the same asset', async () => {
    const app = await startB4();
    const request = () => fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/publish`, {
      method: 'POST', headers: privateHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ confirmed: true }),
    });
    const [left, right] = await Promise.all([request(), request()]);
    expect([left.status, right.status]).toEqual([200, 200]);
    const [first, second] = await Promise.all([left.json(), right.json()]);
    expect(second).toEqual(first);
    expect(first.assetId).toMatch(/^[a-z0-9](?:[a-z0-9_-]{41}[a-z0-9])$/);

    const replay = await request();
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(first);
    expect(readdirSync(join(app.sandbox, 'assets', 'room-images', first.assetId)).sort())
      .toEqual(['dark-off.avif', 'dark.avif', 'light.avif', 'manifest.json']);
    expect(readdirSync(join(app.sandbox, 'config', 'room-images')).sort()).toEqual(['assets.json']);
    expect(app.jobStore.publicJob(app.jobStore.get(app.finalJobId))).toMatchObject({
      status: 'succeeded', phase: 'complete', asset: first,
    });
    expect(app.jobStore.get(app.finalJobId).providerCalls.attempt).toMatchObject({
      plannedCount: 2, startedCount: 2, completedCount: 2, outcomeUnknownCount: 0,
    });
  });

  it('keeps a published set out of the expiry sweep so a restart still loads it', async () => {
    const sandbox = root();
    let clock = 1_700_000_000_000;
    const app = await startB4({ sandbox, now: () => clock });
    const asset = await publishAsset(app);
    clock += 25 * 60 * 60 * 1000;
    expect(() => app.jobStore.cleanup()).not.toThrow();
    expect(app.jobStore.get(app.finalJobId)).toMatchObject({ status: 'succeeded', phase: 'complete', asset });
    expect(() => createRoomImageJobStore({
      metadataRoot: join(sandbox, 'jobs'), tempRoot: join(sandbox, 'private'), now: () => clock,
    })).not.toThrow();
  });

  it('lists sanitized live assignments and serves only catalogued immutable variants', async () => {
    const app = await startB4();
    const published = await fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/publish`, {
      method: 'POST', headers: privateHeaders({ 'content-type': 'application/json' }),
      body: '{"confirmed":true}',
    });
    const asset = await published.json();
    const listing = await fetch(`${app.base}/api/room-image-assets`, { headers: privateHeaders() });
    expect(listing.status).toBe(200);
    const body = await listing.json();
    expect(body).toEqual({
      assets: [{
        ...asset, createdAt: expect.any(String), assignedRoomIds: [],
        byteLength: expect.any(Number),
      }],
      totalByteLength: expect.any(Number),
      householdEtag: expect.stringMatching(/^"[0-9a-f]{64}"$/),
    });
    expect(JSON.stringify(body)).not.toMatch(/fixture-user|source|prompt|provider|job|\/tmp\//i);

    const image = await fetch(`${app.base}${asset.variants.light}`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/avif');
    expect(image.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes('fixture-avif'));
    const head = await fetch(`${app.base}${asset.variants.darkOff}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    for (const path of [
      `/assets/room-images/${asset.assetId}/`,
      `/assets/room-images/${asset.assetId}/manifest.json`,
      `/assets/room-images/${asset.assetId}/../light.avif`,
      `/assets/room-images/${asset.assetId}/dusk.avif`,
      '/assets/room-images/.publishing-secret/light.avif',
    ]) expect((await fetch(`${app.base}${path}`)).status, path).toBe(404);
  });

  it('serves pre-published catalog assets without private auth or a job store while private APIs fail closed', async () => {
    const sandbox = root();
    const staticRoot = join(sandbox, 'dist');
    const householdConfigPath = join(sandbox, 'config', 'household.json');
    const catalogPath = join(sandbox, 'config', 'room-images', 'assets.json');
    const assetRoot = join(sandbox, 'assets');
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
    installHousehold(householdConfigPath);
    const seed = createRoomImageAssetStore({ catalogPath, assetRoot });
    const asset = seed.publish(
      'public_asset',
      { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      { light: bytes('public-light'), dark: bytes('public-dark'), darkOff: bytes('public-dark-off') },
    );
    const server = createHmiServer('', {
      staticRoot,
      householdConfigPath,
      householdConfigMode: 'active',
      householdConfigMigrationResult: { ok: true, status: 'current' },
      roomImageAuthConfig: createRoomImageAuthConfig(),
      roomImageUploadStore: { cleanup() {} },
      roomImageJobRoot: null,
      roomImageAssetRoot: assetRoot,
      roomImageAssetCatalogPath: catalogPath,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const get = await fetch(`${base}${asset.variants.light}`);
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes('public-light'));
    const head = await fetch(`${base}${asset.variants.darkOff}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const privateListing = await fetch(`${base}/api/room-image-assets`);
    expect(privateListing.status).toBe(503);
    await expect(privateListing.json()).resolves.toMatchObject({ code: 'AUTH_BOUNDARY_MISSING' });
  });

  it('uploads a manual room background, serves it and restores the default', async () => {
    const app = await startB4();
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const png = readFileSync(new URL('./fixtures/neutral-alpha.png', import.meta.url));
    const avif = await providerPngToFinalAvif(png);
    const upload = await fetch(`${app.base}/api/room-backgrounds/den`, {
      method: 'POST', headers: { origin: ORIGIN, 'if-match': etag, 'content-type': 'image/avif' }, body: Buffer.from(avif),
    });
    expect(upload.status).toBe(200);
    const uploaded = await upload.json();
    expect(uploaded).toMatchObject({ roomId: 'den', hero: { assetId: expect.stringMatching(/^manual_[0-9a-f]{32}$/) } });
    const asset = await fetch(`${app.base}/assets/room-images/${uploaded.hero.assetId}/light.avif`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('image/avif');
    expect((await asset.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).rooms[0].hero.assetId).toBe(uploaded.hero.assetId);

    const restore = await fetch(`${app.base}/api/room-backgrounds/den`, {
      method: 'DELETE', headers: { origin: ORIGIN, 'if-match': uploaded.etag },
    });
    expect(restore.status).toBe(200);
    await expect(restore.json()).resolves.toMatchObject({ roomId: 'den', hero: null });
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).rooms[0].hero).toBeNull();
    expect((await fetch(`${app.base}/assets/room-images/${uploaded.hero.assetId}/light.avif`)).status).toBe(404);
  });

  it('accepts a manual room background from the exact direct-LAN request origin', async () => {
    const app = await startB4();
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const png = readFileSync(new URL('./fixtures/neutral-alpha.png', import.meta.url));

    const upload = await fetch(`${app.base}/api/room-backgrounds/den`, {
      method: 'POST', headers: { origin: app.base, 'if-match': etag, 'content-type': 'image/png' }, body: png,
    });

    expect(upload.status).toBe(200);
    await expect(upload.json()).resolves.toMatchObject({
      roomId: 'den', hero: { assetId: expect.stringMatching(/^manual_[0-9a-f]{32}$/) },
    });
  });

  it('rejects unsafe manual room background requests without mutation', async () => {
    const app = await startB4();
    const before = readFileSync(app.householdConfigPath);
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const forbidden = await fetch(`${app.base}/api/room-backgrounds/den`, {
      method: 'POST', headers: { origin: 'https://attacker.invalid', 'if-match': etag, 'content-type': 'image/png' }, body: 'x',
    });
    expect(forbidden.status).toBe(403);
    const unsupported = await fetch(`${app.base}/api/room-backgrounds/den`, {
      method: 'POST', headers: { origin: ORIGIN, 'if-match': etag, 'content-type': 'image/gif' }, body: 'GIF89a',
    });
    expect(unsupported.status).toBe(415);
    expect(readFileSync(app.householdConfigPath)).toEqual(before);
  });

  it('does not publish a manual upload behind a stale household ETag', async () => {
    const app = await startB4();
    const png = readFileSync(new URL('./fixtures/neutral-alpha.png', import.meta.url));
    const response = await fetch(`${app.base}/api/room-backgrounds/den`, {
      method: 'POST', headers: { origin: ORIGIN, 'if-match': '"stale"', 'content-type': 'image/png' }, body: png,
    });
    expect(response.status).toBe(412);
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).rooms[0].hero).toBeNull();
    expect(readdirSync(join(app.sandbox, 'assets', 'room-images'))).toEqual([]);
  });

  it('uses strong byte ETags for household/shared config and protects assignment/delete', async () => {
    const app = await startB4({ sharedValues: { 'hmi:backend': 'fake' } });
    const published = await fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/publish`, {
      method: 'POST', headers: privateHeaders({ 'content-type': 'application/json' }), body: '{"confirmed":true}',
    });
    const asset = await published.json();
    const household = await fetch(`${app.base}/api/household-config`);
    const householdBytes = await household.text();
    const householdEtag = household.headers.get('etag');
    expect(householdEtag).toMatch(/^"[0-9a-f]{64}"$/);
    const shared = await fetch(`${app.base}/api/config`);
    expect(shared.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(shared.headers.get('etag')).not.toBe(householdEtag);

    const missing = await fetch(`${app.base}/api/room-image-assignments/den`, {
      method: 'PUT', headers: privateHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus } }),
    });
    expect(missing.status).toBe(428);
    const stale = await fetch(`${app.base}/api/room-image-assignments/den`, {
      method: 'PUT', headers: privateHeaders({ 'content-type': 'application/json', 'if-match': '"stale"' }),
      body: JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus } }),
    });
    expect(stale.status).toBe(412);
    expect(readFileSync(app.householdConfigPath, 'utf8')).toBe(householdBytes);

    const assigned = await fetch(`${app.base}/api/room-image-assignments/den`, {
      method: 'PUT', headers: privateHeaders({ 'content-type': 'application/json', 'if-match': householdEtag! }),
      body: JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus } }),
    });
    expect(assigned.status).toBe(200);
    const assignment = await assigned.json();
    expect(assignment).toEqual({ roomId: 'den', hero: { assetId: asset.assetId, focus: asset.focus }, etag: expect.any(String) });
    expect(assignment.etag).not.toBe(householdEtag);

    const blocked = await fetch(`${app.base}/api/room-image-assets/${asset.assetId}`, {
      method: 'DELETE', headers: privateHeaders(),
    });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({ code: 'ASSET_IN_USE', roomIds: ['den'] });

    const removed = await fetch(`${app.base}/api/room-image-assignments/den`, {
      method: 'PUT', headers: privateHeaders({ 'content-type': 'application/json', 'if-match': assignment.etag }),
      body: '{"asset":null}',
    });
    expect(removed.status).toBe(200);
    const deleted = await fetch(`${app.base}/api/room-image-assets/${asset.assetId}`, {
      method: 'DELETE', headers: privateHeaders(),
    });
    expect(deleted.status).toBe(204);
    expect(existsSync(join(app.sandbox, 'assets', 'room-images', asset.assetId))).toBe(false);
    expect((await fetch(`${app.base}${asset.variants.light}`)).status).toBe(404);
  });

  it('rejects auth, origin, closed bodies, foreign ownership, cancel and TTL without publication or counters', async () => {
    const app = await startB4();
    const beforeCounters = structuredClone(app.jobStore.get(app.finalJobId).providerCalls);
    const cases: Array<[string, () => Promise<Response>, number]> = [
      ['unauthenticated', () => fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/publish`, {
        method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{broken',
      }), 401],
      ['forbidden origin', () => fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/publish`, {
        method: 'POST', headers: { [IDENTITY_HEADER]: 'fixture-user', 'content-type': 'application/json' }, body: '{broken',
      }), 403],
      ['foreign job', () => publishRequest(app, { [IDENTITY_HEADER]: 'other-user' }), 404],
      ['missing confirmation', () => publishRequest(app, {}, '{}'), 400],
      ['negative confirmation', () => publishRequest(app, {}, '{"confirmed":false}'), 400],
      ['open body', () => publishRequest(app, {}, '{"confirmed":true,"extra":true}'), 400],
    ];
    for (const [label, request, status] of cases) {
      expect((await request()).status, label).toBe(status);
      expect(app.jobStore.get(app.finalJobId)).toMatchObject({
        status: 'awaiting_confirmation', phase: 'awaiting_confirmation', reservedAssetId: null, asset: null,
      });
      expect(app.jobStore.get(app.finalJobId).providerCalls).toEqual(beforeCounters);
      expect(publishedInventory(app.sandbox)).toEqual({ sets: [], catalog: null });
    }

    const cancelled = await fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/cancel`, {
      method: 'POST', headers: privateHeaders(),
    });
    expect(cancelled.status).toBe(409);
    expect(app.jobStore.get(app.finalJobId)).toMatchObject({
      status: 'awaiting_confirmation', phase: 'awaiting_confirmation', asset: null, reservedAssetId: null,
    });
    expect(app.jobStore.get(app.finalJobId).providerCalls).toEqual(beforeCounters);
    expect(publishedInventory(app.sandbox)).toEqual({ sets: [], catalog: null });

    let clock = 1_700_000_000_000;
    const ttl = await startB4({ now: () => clock });
    const ttlCounters = structuredClone(ttl.jobStore.get(ttl.finalJobId).providerCalls);
    clock += 24 * 60 * 60 * 1000;
    ttl.jobStore.cleanup();
    expect(ttl.jobStore.get(ttl.finalJobId)).toMatchObject({ status: 'expired', asset: null, reservedAssetId: null });
    expect(ttl.jobStore.get(ttl.finalJobId).providerCalls).toEqual(ttlCounters);
    expect(publishedInventory(ttl.sandbox)).toEqual({ sets: [], catalog: null });
  });

  it.each(['invalid-avif', 'hevc-in-heif'])('re-decodes every final immediately before publish and fails closed for %s', async (fault) => {
    const png = readFileSync(new URL('./fixtures/provider-portrait.png', import.meta.url));
    const validAvif = await providerPngToFinalAvif(png);
    const app = await startB4({
      avif: validAvif,
      serverOptions: {
        roomImagePreviewValidator: fault === 'hevc-in-heif'
          ? (bytes: Uint8Array, format: string) => validateRoomImagePreviewBytes(bytes, format, {
              async metadataReader(image: any) {
                return { ...(await image.metadata()), compression: 'hevc' };
              },
            })
          : validateRoomImagePreviewBytes,
      },
    });
    if (fault === 'invalid-avif') {
      const record = app.jobStore.get(app.finalJobId);
      writeFileSync(join(app.sandbox, 'private', record.temp.finals.dark), 'not-an-image');
    }
    const beforeCounters = structuredClone(app.jobStore.get(app.finalJobId).providerCalls);
    const response = await publishRequest(app);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'PUBLISH_FAILED' });
    expect(app.jobStore.get(app.finalJobId)).toMatchObject({ status: 'failed', error: { code: 'PUBLISH_FAILED' }, asset: null });
    expect(app.jobStore.get(app.finalJobId).providerCalls).toEqual(beforeCounters);
    expect(publishedInventory(app.sandbox)).toEqual({ sets: [], catalog: null });
  }, 20_000);

  it('holds publishing_set against cancel/discard/divergence while identical requests join exactly once', async () => {
    const gate = deferred();
    let validationEntered = false;
    const app = await startB4({
      serverOptions: {
        async roomImagePreviewValidator(_bytes: Uint8Array, _format: string, context: any) {
          if (context?.purpose === 'publish-set') {
            validationEntered = true;
            await gate.promise;
          }
        },
      },
    });
    const counters = structuredClone(app.jobStore.get(app.finalJobId).providerCalls);
    const first = publishRequest(app);
    for (let spin = 0; spin < 200 && !validationEntered; spin += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    expect(validationEntered).toBe(true);
    const reservedAssetId = app.jobStore.get(app.finalJobId).reservedAssetId;
    expect(app.jobStore.get(app.finalJobId)).toMatchObject({ phase: 'publishing_set', cancellable: false });

    const second = publishRequest(app);
    const [cancel, discard, divergent] = await Promise.all([
      fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/cancel`, { method: 'POST', headers: privateHeaders() }),
      fetch(`${app.base}/api/room-image-jobs/${app.finalJobId}/discard`, {
        method: 'POST', headers: privateHeaders({ 'content-type': 'application/json' }), body: '{}',
      }),
      publishRequest(app, {}, '{"confirmed":false}'),
    ]);
    expect([cancel.status, discard.status, divergent.status]).toEqual([409, 409, 409]);
    for (const response of [cancel, discard, divergent]) {
      await expect(response.json()).resolves.toMatchObject({ code: 'PUBLISH_IN_PROGRESS' });
    }
    expect(app.jobStore.get(app.finalJobId).reservedAssetId).toBe(reservedAssetId);
    expect(publishedInventory(app.sandbox)).toEqual({ sets: [], catalog: null });

    gate.resolve();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const assets = await Promise.all(responses.map((response) => response.json()));
    expect(assets[1]).toEqual(assets[0]);
    expect(assets[0].assetId).toBe(reservedAssetId);
    expect(app.jobStore.get(app.finalJobId).providerCalls).toEqual(counters);
    expect(publishedInventory(app.sandbox).sets).toEqual([reservedAssetId]);
    expect(publishedInventory(app.sandbox).catalog.assets).toHaveLength(1);
  });

  it('treats the catalog rename as the commit point and never removes its matching final set on a later fault', () => {
    const sandbox = root();
    let injected = false;
    const store = createRoomImageAssetStore({
      catalogPath: join(sandbox, 'config', 'room-images', 'assets.json'),
      assetRoot: join(sandbox, 'assets'),
      transactionStep(step: string) {
        if (step === 'catalog_renamed' && !injected) {
          injected = true;
          throw new Error('post-rename chmod/fsync fault');
        }
      },
    });
    const asset = store.publish(
      'commit_aware_asset',
      { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      { light: bytes('light'), dark: bytes('dark'), darkOff: bytes('dark-off') },
    );
    expect(injected).toBe(true);
    expect(asset.assetId).toBe('commit_aware_asset');
    expect(store.status(asset.assetId)).toBe('complete');
    expect(new Uint8Array(store.variantBytes(asset.assetId, 'light'))).toEqual(bytes('light'));
    expect(JSON.parse(readFileSync(store.catalogPath, 'utf8')).assets).toHaveLength(1);
  });

  it.each([
    ['staging_created', false, false],
    ['variant_light_written', false, false],
    ['variant_dark_written', false, false],
    ['variant_darkOff_written', false, false],
    ['staging_flushed', false, false],
    ['final_renamed', false, false],
    ['catalog_before_write', false, false],
    ['catalog_written', false, false],
    ['catalog_renamed', true, false],
    ['catalog_directory_fsynced', true, false],
    ['catalog_committed', true, false],
    ['before_job_commit', true, false],
    ['job_committed', true, true],
    ['before_temp_cleanup', true, true],
  ])('recovers deterministic publish crash at %s with the reserved id and no partial set', async (step, committed, jobCommitted) => {
    let injected = false;
    const inject = (current: string) => {
      if (!injected && current === step) {
        injected = true;
        throw Object.assign(new Error(`simulated crash at ${step}`), { simulateCrash: true });
      }
    };
    const app = await startB4({
      jobTransactionStep: inject,
      serverOptions: { roomImagePublishStep: inject },
    });
    const counters = structuredClone(app.jobStore.get(app.finalJobId).providerCalls);
    const crashedResponse = await publishRequest(app);
    expect(crashedResponse.status).toBe(500);
    expect(injected).toBe(true);
    const crashed = app.jobStore.get(app.finalJobId);
    const reservedAssetId = crashed.reservedAssetId;
    expect(crashed).toMatchObject(jobCommitted
      ? { status: 'succeeded', phase: 'complete', reservedAssetId, asset: { assetId: reservedAssetId } }
      : { status: 'awaiting_confirmation', phase: 'publishing_set', reservedAssetId, asset: null });
    expect(reservedAssetId).toMatch(/^[a-z0-9](?:[a-z0-9_-]{41}[a-z0-9])$/);
    expect(crashed.providerCalls).toEqual(counters);
    await stop(app.server);

    const restartedStore = createRoomImageJobStore({
      metadataRoot: join(app.sandbox, 'jobs'), tempRoot: join(app.sandbox, 'private'), now: () => 1_700_000_000_000,
    });
    const restarted = await startB4({
      sandbox: app.sandbox,
      prepared: { jobStore: restartedStore, finalJobId: app.finalJobId },
    });
    const recovered = restarted.jobStore.get(app.finalJobId);
    expect(recovered.reservedAssetId).toBe(reservedAssetId);
    expect(recovered.providerCalls).toEqual(counters);
    const inventory = publishedInventory(app.sandbox);
    expect(inventory.sets.some((name: string) => name.startsWith('.publishing-'))).toBe(false);
    if (committed) {
      expect(recovered).toMatchObject({ status: 'succeeded', phase: 'complete', asset: { assetId: reservedAssetId } });
      expect(inventory.sets).toEqual([reservedAssetId]);
      expect(inventory.catalog.assets).toHaveLength(1);
      expect((await fetch(`${restarted.base}/assets/room-images/${reservedAssetId}/light.avif`)).status).toBe(200);
    } else {
      expect(recovered).toMatchObject({ status: 'failed', phase: 'complete', error: { code: 'PUBLISH_FAILED' }, asset: null });
      expect(inventory.sets).toEqual([]);
      expect(inventory.catalog?.assets ?? []).toEqual([]);
      expect((await fetch(`${restarted.base}/assets/room-images/${reservedAssetId}/light.avif`)).status).toBe(404);
    }
  });

  it('marks ambiguous stage plus final recovery as PUBLISH_RECOVERY_REQUIRED without inventing an id', async () => {
    const sandbox = root();
    installHousehold(join(sandbox, 'config', 'household.json'));
    const prepared = awaitingFinalJob(sandbox);
    const begun = prepared.jobStore.beginPublish('fixture-user', prepared.finalJobId);
    expect(begun.type).toBe('started');
    const assetId = begun.record.reservedAssetId;
    const assetStore = createRoomImageAssetStore({
      catalogPath: join(sandbox, 'config', 'room-images', 'assets.json'), assetRoot: join(sandbox, 'assets'),
    });
    const setsRoot = join(assetStore.root, 'room-images');
    mkdirSync(join(setsRoot, `.publishing-${assetId}`), { recursive: true });
    mkdirSync(join(setsRoot, assetId), { recursive: true });

    const app = await startB4({ sandbox, prepared });
    const recovered = app.jobStore.get(app.finalJobId);
    expect(recovered).toMatchObject({
      status: 'failed', phase: 'complete', reservedAssetId: assetId,
      error: { code: 'PUBLISH_RECOVERY_REQUIRED' }, asset: null,
    });
    expect(readdirSync(setsRoot).sort()).toEqual([`.publishing-${assetId}`, assetId].sort());
    expect(existsSync(join(sandbox, 'config', 'room-images', 'assets.json'))).toBe(false);
    expect((await fetch(`${app.base}/assets/room-images/${assetId}/light.avif`)).status).toBe(404);
  });

  it('validates assignment bodies, focus and references, then atomically changes only room.hero in mode 0600', async () => {
    const assignmentSteps: Array<{
      step: string;
      path: string;
      temporary?: string;
      bytes: Uint8Array;
      activeBytes: Uint8Array;
      mode?: number;
    }> = [];
    const app = await startB4({
      serverOptions: {
        roomImagePublishStep(step: string, detail: { path?: string; temporary?: string }) {
          if (!step.startsWith('assignment_')) return;
          const inspected = step === 'assignment_before_rename' ? detail.temporary! : detail.path!;
          assignmentSteps.push({
            step,
            path: detail.path!,
            temporary: detail.temporary,
            bytes: readFileSync(inspected),
            activeBytes: readFileSync(detail.path!),
            mode: lstatSync(inspected).mode & 0o777,
          });
        },
      },
    });
    const asset = await publishAsset(app);
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const beforeBytes = readFileSync(app.householdConfigPath);
    const before = JSON.parse(beforeBytes.toString('utf8'));
    const invalidCases: Array<[string, string, string, number]> = [
      ['open body', 'den', JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus }, extra: true }), 400],
      ['open asset', 'den', JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus, path: '/tmp/leak' } }), 400],
      ['focus outside unit interval', 'den', JSON.stringify({ asset: { assetId: asset.assetId, focus: { ...asset.focus, panel: { x: 2, y: 0.5 } } } }), 400],
      ['unknown room', 'unknown-room', JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus } }), 404],
      ['room traversal', '..%2fden', JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus } }), 404],
      ['unknown asset', 'den', JSON.stringify({ asset: { assetId: 'unknown_asset', focus: asset.focus } }), 404],
    ];
    for (const [label, roomId, body, expected] of invalidCases) {
      const response = await assignmentRequest(app, roomId, etag, asset, body);
      expect(response.status, label).toBe(expected);
      expect(readFileSync(app.householdConfigPath)).toEqual(beforeBytes);
    }
    for (const [label, path] of [
      ['unknown asset delete', '/api/room-image-assets/unknown_asset'],
      ['asset delete traversal', '/api/room-image-assets/..%2funknown_asset'],
    ]) {
      const response = await fetch(`${app.base}${path}`, { method: 'DELETE', headers: privateHeaders() });
      expect(response.status, label).toBe(404);
      expect(readFileSync(app.householdConfigPath)).toEqual(beforeBytes);
      expect(existsSync(join(app.sandbox, 'assets', 'room-images', asset.assetId))).toBe(true);
    }

    const assigned = await assignmentRequest(app, 'den', etag, { assetId: asset.assetId, focus: asset.focus });
    expect(assigned.status).toBe(200);
    const assignedBody = await assigned.json();
    expect(assignedBody).toEqual({
      roomId: 'den', hero: { assetId: asset.assetId, focus: asset.focus }, etag: expect.stringMatching(/^"[0-9a-f]{64}"$/),
    });
    const after = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    const expected = structuredClone(before);
    expected.rooms.find((room: any) => room.id === 'den').hero = { assetId: asset.assetId, focus: asset.focus };
    expect(after).toEqual(expected);
    const parsed = parseHouseholdConfig(after);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(() => projectActiveHouseholdData(compileHouseholdConfig(parsed.value))).not.toThrow();
    expect(statSync(app.householdConfigPath).mode & 0o777).toBe(0o600);
    expect(assignmentSteps.map(({ step }) => step)).toEqual([
      'assignment_before_rename',
      'assignment_renamed',
      'assignment_directory_fsync',
      'assignment_committed',
    ]);
    expect(assignmentSteps[0].bytes).not.toEqual(beforeBytes);
    expect(assignmentSteps[0].activeBytes).toEqual(beforeBytes);
    expect(assignmentSteps[0].mode).toBe(0o600);
    expect(assignmentSteps[1].bytes).toEqual(readFileSync(app.householdConfigPath));
    expect(assignmentSteps[1].activeBytes).toEqual(readFileSync(app.householdConfigPath));
    expect(assignmentSteps[1].mode).toBe(0o600);
    expect(assignmentSteps[2].bytes).toEqual(readFileSync(app.householdConfigPath));
    expect(assignmentSteps[2].activeBytes).toEqual(readFileSync(app.householdConfigPath));
    expect(assignmentSteps[2].mode).toBe(0o600);
    expect(assignmentSteps[3].bytes).toEqual(readFileSync(app.householdConfigPath));
    expect(assignmentSteps[3].activeBytes).toEqual(readFileSync(app.householdConfigPath));
    expect(assignmentSteps[3].mode).toBe(0o600);
  });

  it.each([
    ['assignment_before_rename', false],
    ['assignment_renamed', true],
    ['assignment_directory_fsync', true],
  ])('keeps assignment response and active generation consistent across a %s fault', async (fault, committed) => {
    const steps: string[] = [];
    let injected = false;
    const app = await startB4({
      serverOptions: {
        roomImagePublishStep(step: string) {
          if (!step.startsWith('assignment_')) return;
          steps.push(step);
          if (step === fault && !injected) {
            injected = true;
            throw new Error(`injected ${fault}`);
          }
        },
      },
    });
    const asset = await publishAsset(app);
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const before = readFileSync(app.householdConfigPath);

    const response = await assignmentRequest(app, 'den', etag, {
      assetId: asset.assetId,
      focus: asset.focus,
    });
    expect(injected).toBe(true);
    const active = readFileSync(app.householdConfigPath);
    const partials = readdirSync(dirname(app.householdConfigPath))
      .filter((name: string) => name.startsWith('household.json.') && name.endsWith('.tmp'));
    expect(partials).toEqual([]);

    if (!committed) {
      expect(response.status).not.toBe(200);
      expect(active).toEqual(before);
      expect(steps.filter((step) => step === 'assignment_renamed')).toHaveLength(0);
      return;
    }

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      roomId: 'den',
      hero: { assetId: asset.assetId, focus: asset.focus },
      etag: byteEtag(active),
    });
    expect(JSON.parse(active.toString('utf8')).rooms
      .filter((room: any) => room.hero?.assetId === asset.assetId)).toHaveLength(1);
    expect(statSync(app.householdConfigPath).mode & 0o777).toBe(0o600);
    expect(steps.filter((step) => step === 'assignment_renamed')).toHaveLength(1);

    await stop(app.server);
    const restarted = await startB4({
      sandbox: app.sandbox,
      installHousehold: false,
      prepared: { jobStore: app.jobStore, finalJobId: app.finalJobId },
    });
    const restartedHousehold = await fetch(`${restarted.base}/api/household-config`);
    expect(restartedHousehold.status).toBe(200);
    expect(restartedHousehold.headers.get('etag')).toBe(byteEtag(active));
    expect(new Uint8Array(await restartedHousehold.arrayBuffer())).toEqual(new Uint8Array(active));
    expect(readFileSync(restarted.householdConfigPath)).toEqual(active);
    expect(statSync(restarted.householdConfigPath).mode & 0o777).toBe(0o600);
  });

  it('latches an unsafe post-rename assignment target instead of claiming either generation is active', async () => {
    const privateMarker = 'private-assignment-target-marker';
    let injected = false;
    const app = await startB4({
      serverOptions: {
        roomImagePublishStep(step: string, detail: { path?: string }) {
          if (step !== 'assignment_renamed' || injected) return;
          injected = true;
          writeFileSync(detail.path!, `{"unsafe":"${privateMarker}"}\n`, { mode: 0o600 });
          throw new Error('injected unsafe post-rename target');
        },
      },
    });
    const asset = await publishAsset(app);
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();

    const response = await assignmentRequest(app, 'den', etag, {
      assetId: asset.assetId,
      focus: asset.focus,
    });
    expect(injected).toBe(true);
    expect(response.status).toBe(503);
    const responseBody = await response.text();
    expect(responseBody).toContain('SETUP_CONFIG_RECOVERY_REQUIRED');
    expect(responseBody).not.toContain(privateMarker);
    expect(responseBody).not.toContain(app.sandbox);
    const unsafeBytes = readFileSync(app.householdConfigPath);
    const blockedRead = await fetch(`${app.base}/api/config`);
    expect(blockedRead.status).toBe(503);
    await expect(blockedRead.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
    expect(readFileSync(app.householdConfigPath)).toEqual(unsafeBytes);
    expect(readdirSync(dirname(app.householdConfigPath))
      .filter((name: string) => name.startsWith('household.json.') && name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps the non-contract assignment alias at a real 404 without SPA fallback or mutation', async () => {
    const app = await startB4();
    const asset = await publishAsset(app);
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const before = readFileSync(app.householdConfigPath);
    const response = await fetch(`${app.base}/api/rooms/den/room-image-assignment`, {
      method: 'PUT',
      headers: privateHeaders({ 'content-type': 'application/json', 'if-match': etag }),
      body: JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus } }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({ code: 'ROOM_IMAGE_ROUTE_NOT_FOUND' });
    expect(readFileSync(app.householdConfigPath)).toEqual(before);
  });

  it('rejects incomplete assignment and keeps missing/stale preconditions write-free', async () => {
    const app = await startB4();
    const asset = await publishAsset(app);
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const before = readFileSync(app.householdConfigPath);
    for (const [label, headers, status] of [
      ['missing', {}, 428],
      ['multiple/stale', { 'if-match': `${etag}, "other"` }, 412],
      ['stale', { 'if-match': '"stale"' }, 412],
    ] as const) {
      const response = await fetch(`${app.base}/api/room-image-assignments/den`, {
        method: 'PUT',
        headers: privateHeaders({ 'content-type': 'application/json', ...headers }),
        body: JSON.stringify({ asset: { assetId: asset.assetId, focus: asset.focus } }),
      });
      expect(response.status, label).toBe(status);
      expect(readFileSync(app.householdConfigPath)).toEqual(before);
    }
    rmSync(join(app.sandbox, 'assets', 'room-images', asset.assetId, 'dark.avif'));
    const incomplete = await assignmentRequest(app, 'den', etag, { assetId: asset.assetId, focus: asset.focus });
    expect(incomplete.status).toBe(409);
    await expect(incomplete.json()).resolves.toMatchObject({ code: 'ASSET_INCOMPLETE' });
    expect(readFileSync(app.householdConfigPath)).toEqual(before);
  });

  it.each(['delete_before_unlink', 'delete_unlinked'])('persists tombstone before %s failure, closes every read/write path and retries idempotently after restart', async (fault) => {
    const sandbox = root();
    const prepared = awaitingFinalJob(sandbox);
    const catalogPath = join(sandbox, 'config', 'room-images', 'assets.json');
    const assetRoot = join(sandbox, 'assets');
    let targetAssetId = '';
    let injected = false;
    let store: any;
    store = createRoomImageAssetStore({
      catalogPath,
      assetRoot,
      transactionStep(step: string) {
        if (step !== fault || injected) return;
        injected = true;
        const entry = JSON.parse(readFileSync(catalogPath, 'utf8')).assets
          .find((candidate: any) => candidate.assetId === targetAssetId);
        expect(entry.status).toBe('tombstone');
        expect(store.status(targetAssetId)).toBe('tombstone');
        expect(store.list()).toEqual([]);
        expect(store.variantBytes(targetAssetId, 'light')).toBeNull();
        throw new Error(`injected ${fault}`);
      },
    });
    const app = await startB4({
      sandbox,
      prepared,
      serverOptions: { roomImageAssetStore: store },
    });
    const asset = await publishAsset(app);
    targetAssetId = asset.assetId;
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const householdBytes = readFileSync(app.householdConfigPath);

    const failed = await fetch(`${app.base}/api/room-image-assets/${asset.assetId}`, {
      method: 'DELETE', headers: privateHeaders(),
    });
    expect(failed.status).toBe(503);
    expect(injected).toBe(true);
    const listing = await fetch(`${app.base}/api/room-image-assets`, { headers: privateHeaders() });
    expect(listing.status).toBe(200);
    await expect(listing.json()).resolves.toMatchObject({ assets: [] });
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${app.base}${asset.variants.light}`, { method });
      expect(response.status).toBe(404);
      if (method === 'HEAD') expect((await response.arrayBuffer()).byteLength).toBe(0);
    }
    const assignment = await assignmentRequest(app, 'den', etag, { assetId: asset.assetId, focus: asset.focus });
    expect(assignment.status).toBe(404);
    await expect(assignment.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    expect(readFileSync(app.householdConfigPath)).toEqual(householdBytes);

    await stop(app.server);
    const restartedStore = createRoomImageJobStore({
      metadataRoot: join(sandbox, 'jobs'), tempRoot: join(sandbox, 'private'), now: () => 1_700_000_000_000,
    });
    const restarted = await startB4({
      sandbox,
      prepared: { jobStore: restartedStore, finalJobId: app.finalJobId },
    });
    expect((await fetch(`${restarted.base}${asset.variants.light}`)).status).toBe(404);
    const retry = await fetch(`${restarted.base}/api/room-image-assets/${asset.assetId}`, {
      method: 'DELETE', headers: privateHeaders(),
    });
    expect(retry.status).toBe(204);
    expect(existsSync(join(sandbox, 'assets', 'room-images', asset.assetId))).toBe(false);
    expect(JSON.parse(readFileSync(catalogPath, 'utf8')).assets[0].status).toBe('tombstone');
    expect((await fetch(`${restarted.base}/api/room-image-assets/${asset.assetId}`, {
      method: 'DELETE', headers: privateHeaders(),
    })).status).toBe(204);
  });

  it.each(['assignment-first', 'delete-first'])('serializes assignment/delete fairly for %s without a tombstoned config reference', async (order) => {
    const observed = observedCoordinator();
    const gate = deferred();
    const app = await startB4({ coordinator: observed.coordinator });
    const asset = await publishAsset(app);
    const household = await fetch(`${app.base}/api/household-config`);
    const etag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const before = readFileSync(app.householdConfigPath);
    const baseline = observed.runs();
    const blocker = observed.coordinator.run(() => gate.promise);
    await waitUntil(() => observed.runs() === baseline + 1, 'coordinator blocker was not queued');

    let assignment!: Promise<Response>;
    let deletion!: Promise<Response>;
    if (order === 'assignment-first') {
      assignment = assignmentRequest(app, 'den', etag, { assetId: asset.assetId, focus: asset.focus });
      await waitUntil(() => observed.runs() === baseline + 2, 'assignment was not queued first');
      deletion = fetch(`${app.base}/api/room-image-assets/${asset.assetId}`, { method: 'DELETE', headers: privateHeaders() });
    } else {
      deletion = fetch(`${app.base}/api/room-image-assets/${asset.assetId}`, { method: 'DELETE', headers: privateHeaders() });
      await waitUntil(() => observed.runs() === baseline + 2, 'delete was not queued first');
      assignment = assignmentRequest(app, 'den', etag, { assetId: asset.assetId, focus: asset.focus });
    }
    await waitUntil(() => observed.runs() === baseline + 3, 'second mutation was not queued');
    gate.resolve();
    await blocker;
    const [assigned, deleted] = await Promise.all([assignment, deletion]);
    const config = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    if (order === 'assignment-first') {
      expect([assigned.status, deleted.status]).toEqual([200, 409]);
      await expect(deleted.json()).resolves.toMatchObject({ code: 'ASSET_IN_USE', roomIds: ['den'] });
      expect(config.rooms.find((room: any) => room.id === 'den').hero.assetId).toBe(asset.assetId);
      expect(JSON.parse(readFileSync(join(app.sandbox, 'config', 'room-images', 'assets.json'), 'utf8')).assets[0].status).toBe('active');
    } else {
      expect([assigned.status, deleted.status]).toEqual([404, 204]);
      await expect(assigned.json()).resolves.toMatchObject({ code: 'ASSET_NOT_FOUND' });
      expect(readFileSync(app.householdConfigPath)).toEqual(before);
      expect(config.rooms.every((room: any) => room.hero?.assetId !== asset.assetId)).toBe(true);
      expect(JSON.parse(readFileSync(join(app.sandbox, 'config', 'room-images', 'assets.json'), 'utf8')).assets[0].status).toBe('tombstone');
    }
  });

  it('serializes assignment with Shared Config and Setup without lost updates', async () => {
    const sharedObserved = observedCoordinator();
    const sharedGate = deferred();
    const sharedApp = await startB4({
      coordinator: sharedObserved.coordinator,
      sharedValues: { 'hmi:backend': 'fake' },
    });
    const sharedAsset = await publishAsset(sharedApp);
    const household = await fetch(`${sharedApp.base}/api/household-config`);
    const householdEtag = household.headers.get('etag')!;
    const shared = await fetch(`${sharedApp.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    const baseline = sharedObserved.runs();
    const blocker = sharedObserved.coordinator.run(() => sharedGate.promise);
    const assignment = assignmentRequest(sharedApp, 'den', householdEtag, {
      assetId: sharedAsset.assetId, focus: sharedAsset.focus,
    });
    await waitUntil(() => sharedObserved.runs() === baseline + 2, 'assignment did not queue behind shared blocker');
    const sharedWrite = fetch(`${sharedApp.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'if-match': sharedEtag },
      body: JSON.stringify({ updates: { 'hmi:ha-url': 'http://serialized.fixture' } }),
    });
    await waitUntil(() => sharedObserved.runs() === baseline + 3, 'shared write did not share coordinator');
    sharedGate.resolve();
    await blocker;
    expect((await assignment).status).toBe(200);
    expect((await sharedWrite).status).toBe(200);
    expect(JSON.parse(readFileSync(sharedApp.householdConfigPath, 'utf8')).rooms
      .find((room: any) => room.id === 'den').hero.assetId).toBe(sharedAsset.assetId);
    expect(JSON.parse(readFileSync(sharedApp.configPath, 'utf8'))['hmi:ha-url']).toBe('http://serialized.fixture');

    const setupObserved = observedCoordinator();
    const setupGate = deferred();
    const setupApp = await startB4({
      coordinator: setupObserved.coordinator,
      sharedValues: { 'hmi:backend': 'fake' },
      serverOptions: {
        setupConnectionVerifier: async () => ({ ok: true }),
        setupJellyfinVerifier: async () => ({ ok: true }),
      },
    });
    const setupAsset = await publishAsset(setupApp);
    const setupHousehold = await fetch(`${setupApp.base}/api/household-config`);
    const setupHouseholdEtag = setupHousehold.headers.get('etag')!;
    const setupShared = await fetch(`${setupApp.base}/api/config`);
    const setupSharedEtag = setupShared.headers.get('etag')!;
    const sharedBefore = readFileSync(setupApp.configPath);
    const setupBaseline = setupObserved.runs();
    const setupBlocker = setupObserved.coordinator.run(() => setupGate.promise);
    const setupAssignment = assignmentRequest(setupApp, 'den', setupHouseholdEtag, {
      assetId: setupAsset.assetId, focus: setupAsset.focus,
    });
    await waitUntil(() => setupObserved.runs() === setupBaseline + 2, 'assignment did not queue before setup');
    const reconfigure = setupRequest(setupApp, {
      'if-match': setupHouseholdEtag,
      'x-hauser-shared-config-if-match': setupSharedEtag,
    }, 'Setup must lose CAS');
    await waitUntil(() => setupObserved.runs() === setupBaseline + 3, 'setup did not share coordinator');
    setupGate.resolve();
    await setupBlocker;
    expect((await setupAssignment).status).toBe(200);
    expect((await reconfigure).status).toBe(412);
    expect(readFileSync(setupApp.configPath)).toEqual(sharedBefore);
    const setupDocument = JSON.parse(readFileSync(setupApp.householdConfigPath, 'utf8'));
    expect(setupDocument.rooms.find((room: any) => room.id === 'den').hero.assetId).toBe(setupAsset.assetId);
    expect(setupDocument.rooms[0].name).not.toBe('Setup must lose CAS');
  });

  it('allows headerless first setup only for absent configs and never overwrites a coordinator winner', async () => {
    const first = await startSetup({ installHousehold: false });
    const activated = await setupRequest(first);
    expect(activated.status).toBe(201);
    expect(existsSync(first.householdConfigPath)).toBe(true);
    expect(existsSync(first.configPath)).toBe(true);
    expect(statSync(first.householdConfigPath).mode & 0o777).toBe(0o600);

    const observed = observedCoordinator();
    const verifierGate = deferred();
    let verifierEntered = false;
    const raced = await startSetup({
      installHousehold: false,
      coordinator: observed.coordinator,
      setupConnectionVerifier: async () => {
        verifierEntered = true;
        await verifierGate.promise;
        return { ok: true };
      },
    });
    const request = setupRequest(raced, {}, 'Must not overwrite');
    await waitUntil(() => verifierEntered, 'setup verifier did not start');
    await observed.coordinator.run(() => installHousehold(raced.householdConfigPath));
    const winningBytes = readFileSync(raced.householdConfigPath);
    verifierGate.resolve();
    const response = await request;
    expect(response.status).toBe(412);
    expect(readFileSync(raced.householdConfigPath)).toEqual(winningBytes);
    expect(existsSync(raced.configPath)).toBe(false);
  });

  it('requires Shared CAS for initial setup that replaces existing values', async () => {
    const app = await startSetup({ sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://old.fixture' } });
    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    rmSync(app.householdConfigPath);
    const sharedBefore = readFileSync(app.configPath);

    const missing = await setupRequest(app);
    expect(missing.status).toBe(428);
    expect(existsSync(app.householdConfigPath)).toBe(false);
    expect(readFileSync(app.configPath)).toEqual(sharedBefore);
    const stale = await setupRequest(app, { 'x-hauser-shared-config-if-match': '"stale"' });
    expect(stale.status).toBe(412);
    expect(existsSync(app.householdConfigPath)).toBe(false);
    expect(readFileSync(app.configPath)).toEqual(sharedBefore);
    const accepted = await setupRequest(app, { 'x-hauser-shared-config-if-match': sharedEtag });
    expect(accepted.status).toBe(201);
    expect(JSON.parse(readFileSync(app.configPath, 'utf8'))['hmi:backend']).toBe('ha');
    expect(existsSync(app.householdConfigPath)).toBe(true);
  });

  it('rejects a supplied initial-setup Shared ETag when the loaded Shared file disappeared before the lock', async () => {
    const app = await startSetup({
      installHousehold: false,
      sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://loaded.fixture' },
    });
    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    await shared.arrayBuffer();
    rmSync(app.configPath);

    const response = await setupRequest(app, { 'x-hauser-shared-config-if-match': sharedEtag });
    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIG_PRECONDITION_FAILED' });
    expect(existsSync(app.configPath)).toBe(false);
    expect(existsSync(app.householdConfigPath)).toBe(false);
  });

  it.each(['present-to-absent', 'absent-to-present'])('binds Shared existence into setup CAS for %s even when response bytes stay identical', async (direction) => {
    const verifierGate = deferred();
    const verifierEntered = deferred();
    const app = await startSetup({
      installHousehold: false,
      ...(direction === 'present-to-absent' ? { sharedValues: {} } : {}),
      setupConnectionVerifier: async () => {
        verifierEntered.resolve();
        await verifierGate.promise;
        return { ok: true };
      },
    });
    const shared = setupSharedBoundary(app.configPath);
    expect(shared.exists).toBe(direction === 'present-to-absent');
    expect(JSON.parse(shared.body.toString('utf8'))).toEqual({ values: {} });

    const request = setupRequest(app, { 'x-hauser-shared-config-if-match': shared.etag });
    await verifierEntered.promise;
    if (direction === 'present-to-absent') rmSync(app.configPath);
    else {
      mkdirSync(dirname(app.configPath), { recursive: true, mode: 0o700 });
      writeFileSync(app.configPath, '{}', { mode: 0o600 });
    }
    const winningShared = direction === 'present-to-absent' ? null : readFileSync(app.configPath);
    verifierGate.resolve();

    const response = await request;
    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIG_PRECONDITION_FAILED' });
    expect(existsSync(app.householdConfigPath)).toBe(false);
    if (winningShared === null) expect(existsSync(app.configPath)).toBe(false);
    else expect(readFileSync(app.configPath)).toEqual(winningShared);
  });

  it('finishes durable setup recovery inside the same coordinator turn so an old-ETag Shared write cannot overwrite it', async () => {
    const observed = observedCoordinator();
    const entered = deferred();
    const release = deferred();
    const steps: string[] = [];
    const app = await startSetup({
      coordinator: observed.coordinator,
      sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://before.fixture' },
      serverOptions: {
        async setupMutationStep(step: string) {
          steps.push(step);
          if (step === 'shared_config_committed') {
            entered.resolve();
            await release.promise;
            throw new Error('forced setup failure after durable Shared commit');
          }
        },
      },
    });
    const household = await fetch(`${app.base}/api/household-config`);
    const householdEtag = household.headers.get('etag')!;
    await household.arrayBuffer();
    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    await shared.arrayBuffer();
    const baseline = observed.runs();
    const setup = setupRequest(app, {
      'if-match': householdEtag,
      'x-hauser-shared-config-if-match': sharedEtag,
    }, 'Durable recovered generation');
    await entered.promise;
    const loser = fetch(`${app.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'if-match': sharedEtag },
      body: JSON.stringify({ updates: { 'hmi:ha-url': 'http://stale-loser.fixture' } }),
    });
    await waitUntil(() => observed.runs() === baseline + 2, 'Shared loser did not queue behind setup recovery');
    release.resolve();

    const setupResponse = await setup;
    expect(setupResponse.status).toBe(500);
    const loserResponse = await loser;
    expect(loserResponse.status).toBe(412);
    await expect(loserResponse.json()).resolves.toMatchObject({ code: 'CONFIG_PRECONDITION_FAILED' });
    expect(steps).toContain('shared_config_committed');
    expect(JSON.parse(readFileSync(app.configPath, 'utf8'))['hmi:ha-url']).toBe('http://home-assistant.fixture');
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).rooms[0].name).toBe('Durable recovered generation');
    expect(setupArtifacts(app.sandbox)).toEqual([]);
  });

  it('latches an incoherent inline setup recovery failure until server restart and blocks every config route without further writes', async () => {
    const sandbox = root('hauser-setup-inline-recovery-latch-');
    const householdConfigPath = join(sandbox, 'config', 'household.json');
    const configPath = join(sandbox, 'config', 'shared.json');
    const privateMarker = 'private-inline-recovery-marker';
    const app = await startSetup({
      sandbox,
      sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://before.fixture' },
      serverOptions: {
        setupMutationStep(step: string) {
          if (step !== 'shared_config_committed') return;
          writeFileSync(householdConfigPath, `{"unsafe":"${privateMarker}"}\n`, { mode: 0o600 });
          throw new Error('forced incoherent inline recovery');
        },
      },
    });
    const blockedSetupBody = JSON.stringify(setupPayload(householdConfigPath, 'Must not retry setup'));
    const household = await fetch(`${app.base}/api/household-config`);
    const shared = await fetch(`${app.base}/api/config`);
    const headers = {
      'if-match': household.headers.get('etag')!,
      'x-hauser-shared-config-if-match': shared.headers.get('etag')!,
    };
    await Promise.all([household.arrayBuffer(), shared.arrayBuffer()]);

    const failed = await setupRequest(app, headers, 'Must remain latched');
    expect(failed.status).toBe(503);
    const failedBody = await failed.text();
    expect(failedBody).toContain('SETUP_CONFIG_RECOVERY_REQUIRED');
    expect(failedBody).not.toContain(privateMarker);
    expect(failedBody).not.toContain(sandbox);

    const sharedAfterFailure = readFileSync(configPath);
    const householdAfterFailure = readFileSync(householdConfigPath);
    const journalDirectory = join(sandbox, 'config', '.hauser-setup-transactions');
    const journalPath = join(journalDirectory, readdirSync(journalDirectory)[0]);
    const journalAfterFailure = readFileSync(journalPath);
    const blocked = await Promise.all([
      fetch(`${app.base}/api/config`),
      fetch(`${app.base}/api/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', origin: ORIGIN, 'if-match': byteEtag(sharedAfterFailure) },
        body: JSON.stringify({ updates: { 'hmi:ha-url': 'http://must-not-write.fixture' } }),
      }),
      fetch(`${app.base}/api/setup/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
        body: blockedSetupBody,
      }),
      fetch(`${app.base}/api/laundry/existing/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}',
      }),
      fetch(`${app.base}/api/room-image-assignments/den`, {
        method: 'PUT', headers: privateHeaders({ 'content-type': 'application/json', 'if-match': '"stale"' }), body: '{"asset":null}',
      }),
    ]);
    expect(blocked.map((response) => response.status)).toEqual([503, 503, 503, 503, 503]);
    for (const response of blocked) {
      const body = await response.text();
      expect(body).toContain('SETUP_CONFIG_RECOVERY_REQUIRED');
      expect(body).not.toContain(privateMarker);
      expect(body).not.toContain(sandbox);
    }
    expect(readFileSync(configPath)).toEqual(sharedAfterFailure);
    expect(readFileSync(householdConfigPath)).toEqual(householdAfterFailure);
    expect(readFileSync(journalPath)).toEqual(journalAfterFailure);

    const journal = JSON.parse(journalAfterFailure.toString('utf8'));
    const householdAfterBytes = Uint8Array.from(
      atob(journal.targets.household.after.bytes),
      (character) => character.charCodeAt(0),
    );
    writeFileSync(householdConfigPath, householdAfterBytes, { mode: 0o600 });
    expect(recoverSetupConfigTransactions({ configPath, householdConfigPath })).toMatchObject({
      ok: true, status: 'recovered', recovered: 1,
    });
    expect(setupArtifacts(sandbox)).toEqual([]);
    const stillLatched = await fetch(`${app.base}/api/config`);
    expect(stillLatched.status).toBe(503);
    await expect(stillLatched.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });

    await stop(app.server);
    const restarted = await startSetup({ sandbox, installHousehold: false });
    const recoveredRead = await fetch(`${restarted.base}/api/config`);
    expect(recoveredRead.status).toBe(200);
    expect(JSON.parse(await recoveredRead.text()).values['hmi:ha-url']).toBe('http://home-assistant.fixture');
    expect(JSON.parse(readFileSync(restarted.householdConfigPath, 'utf8')).rooms[0].name).toBe('Must remain latched');
  });

  it('rechecks the recovery latch when a pre-latch Shared PUT is dequeued and leaves the latched generation byte-exact', async () => {
    const observed = observedCoordinator();
    const setupEntered = deferred();
    const releaseSetup = deferred();
    const sandbox = root('hauser-setup-dequeued-latch-');
    const householdConfigPath = join(sandbox, 'config', 'household.json');
    const app = await startSetup({
      sandbox,
      coordinator: observed.coordinator,
      sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://before.fixture' },
      serverOptions: {
        async setupMutationStep(step: string) {
          if (step !== 'shared_config_committed') return;
          setupEntered.resolve();
          await releaseSetup.promise;
          writeFileSync(householdConfigPath, '{"unsafe":"queued-latch"}\n', { mode: 0o600 });
          throw new Error('forced queued recovery latch');
        },
      },
    });
    const household = await fetch(`${app.base}/api/household-config`);
    const shared = await fetch(`${app.base}/api/config`);
    const baseline = observed.runs();
    const setup = setupRequest(app, {
      'if-match': household.headers.get('etag')!,
      'x-hauser-shared-config-if-match': shared.headers.get('etag')!,
    }, 'Queued latch winner');
    let queuedShared: Promise<Response> | undefined;
    try {
      await Promise.all([household.arrayBuffer(), shared.arrayBuffer(), setupEntered.promise]);

      queuedShared = fetch(`${app.base}/api/config`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json', origin: ORIGIN,
          'if-match': byteEtag(createCentralConfigStore(app.configPath).responseBody()),
        },
        body: JSON.stringify({ updates: { 'hmi:ha-url': 'http://must-not-dequeue-write.fixture' } }),
      });
      await observed.waitForRuns(baseline + 2);
      releaseSetup.resolve();

      const setupResponse = await setup;
      expect(setupResponse.status).toBe(503);
      await expect(setupResponse.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
      const latchedShared = readFileSync(app.configPath);
      const latchedHousehold = readFileSync(app.householdConfigPath);
      const latchedArtifacts = persistentInventory(join(sandbox, 'config'));

      const dequeuedResponse = await queuedShared;
      expect(dequeuedResponse.status).toBe(503);
      await expect(dequeuedResponse.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
      expect(readFileSync(app.configPath)).toEqual(latchedShared);
      expect(readFileSync(app.householdConfigPath)).toEqual(latchedHousehold);
      expect(persistentInventory(join(sandbox, 'config'))).toEqual(latchedArtifacts);
      expect(JSON.parse(latchedShared.toString('utf8'))['hmi:ha-url']).toBe('http://home-assistant.fixture');
    } finally {
      releaseSetup.resolve();
      await Promise.allSettled(queuedShared ? [setup, queuedShared] : [setup]);
    }
  });

  it('does not fail or commit Publish metadata after beginPublish when recovery latches during validation', async () => {
    const validationEntered = deferred();
    const releaseValidation = deferred();
    const sandbox = root('hauser-publish-inflight-latch-');
    const householdConfigPath = join(sandbox, 'config', 'household.json');
    const app = await startB4({
      sandbox,
      sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://before.fixture' },
      serverOptions: {
        async roomImagePreviewValidator(_bytes: Uint8Array, _format: string, context: any) {
          if (context?.purpose !== 'publish-set') return;
          validationEntered.resolve();
          await releaseValidation.promise;
        },
        setupConnectionVerifier: async () => ({ ok: true }),
        setupJellyfinVerifier: async () => ({ ok: true }),
        setupMutationStep(step: string) {
          if (step !== 'shared_config_committed') return;
          writeFileSync(householdConfigPath, '{"unsafe":"publish-latch"}\n', { mode: 0o600 });
          throw new Error('forced publish recovery latch');
        },
      },
    });
    const household = await fetch(`${app.base}/api/household-config`);
    const shared = await fetch(`${app.base}/api/config`);
    const publish = publishRequest(app);
    try {
      await Promise.all([household.arrayBuffer(), shared.arrayBuffer(), validationEntered.promise]);
      expect(app.jobStore.get(app.finalJobId)).toMatchObject({ phase: 'publishing_set', asset: null });

      const setup = await setupRequest(app, {
        'if-match': household.headers.get('etag')!,
        'x-hauser-shared-config-if-match': shared.headers.get('etag')!,
      }, 'Publish latch winner');
      expect(setup.status).toBe(503);
      await expect(setup.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
      const latchedInventory = persistentInventory(sandbox);
      const latchedJob = readFileSync(join(app.jobStore.metadataRoot, `${app.finalJobId}.json`));

      releaseValidation.resolve();
      const publishResponse = await publish;
      expect(publishResponse.status).toBe(503);
      await expect(publishResponse.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
      expect(readFileSync(join(app.jobStore.metadataRoot, `${app.finalJobId}.json`))).toEqual(latchedJob);
      expect(app.jobStore.get(app.finalJobId)).toMatchObject({
        status: 'awaiting_confirmation', phase: 'publishing_set', asset: null, error: null,
      });
      expect(persistentInventory(sandbox)).toEqual(latchedInventory);
    } finally {
      releaseValidation.resolve();
      await Promise.allSettled([publish]);
    }
  });

  it('rejects a persisted publishing_set job with a noncanonical reservedAssetId before recovery can mutate persistence', () => {
    const sandbox = root('hauser-publishing-reserved-id-');
    const prepared = awaitingFinalJob(sandbox);
    expect(prepared.jobStore.beginPublish('fixture-user', prepared.finalJobId).type).toBe('started');
    const metadataPath = join(prepared.jobStore.metadataRoot, `${prepared.finalJobId}.json`);
    const record = JSON.parse(readFileSync(metadataPath, 'utf8'));
    record.reservedAssetId = 'A'.repeat(43);
    writeFileSync(metadataPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    const before = persistentInventory(sandbox);

    expect(() => createRoomImageJobStore({
      metadataRoot: prepared.jobStore.metadataRoot,
      tempRoot: prepared.jobStore.privateRoot,
      now: () => 1_700_000_000_000,
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
    expect(persistentInventory(sandbox)).toEqual(before);
  });

  it('keeps the executable server ready in recovery-required read-only mode without changing persistence', async () => {
    const sandbox = root('hauser-executable-recovery-read-only-');
    const configDirectory = join(sandbox, 'config');
    const householdConfigPath = join(configDirectory, 'household.json');
    const configPath = join(configDirectory, 'shared.json');
    const catalogPath = join(configDirectory, 'room-images', 'assets.json');
    const assetRoot = join(sandbox, 'assets');
    const uploadRoot = join(sandbox, 'uploads');
    installHousehold(householdConfigPath);
    writeFileSync(configPath, '{"hmi:backend":"fake"}\n', { mode: 0o600 });
    const assetStore = createRoomImageAssetStore({ catalogPath, assetRoot });
    const publicAsset = assetStore.publish(
      'executable_public_asset',
      { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      { light: bytes('executable-light'), dark: bytes('executable-dark'), darkOff: bytes('executable-dark-off') },
    );
    const prepared = awaitingFinalJob(join(configDirectory, 'room-images'));
    expect(prepared.jobStore.beginPublish('fixture-user', prepared.finalJobId).type).toBe('started');
    const setsRoot = join(assetRoot, 'room-images');
    mkdirSync(join(setsRoot, '.publishing-executable_orphan'));
    mkdirSync(join(setsRoot, 'executable_orphan'));
    writeFileSync(join(setsRoot, 'executable_orphan', 'orphan.bin'), 'orphan', { mode: 0o600 });
    mkdirSync(uploadRoot, { recursive: true });
    writeFileSync(join(uploadRoot, `.upload-${'u'.repeat(43)}-${'p'.repeat(16)}.tmp`), 'upload-partial', { mode: 0o600 });
    writeFileSync(join(prepared.jobStore.metadataRoot, `.job-${prepared.finalJobId}-${'p'.repeat(16)}.tmp`), 'job-partial', { mode: 0o600 });
    writeFileSync(join(prepared.jobStore.privateRoot, 'partials', '.room-image-executable.tmp'), 'private-partial', { mode: 0o600 });
    const journalDirectory = join(configDirectory, '.hauser-setup-transactions');
    mkdirSync(journalDirectory, { mode: 0o700 });
    writeFileSync(
      join(journalDirectory, 'setup-11111111-1111-4111-8111-111111111111.journal'),
      '{broken-executable-journal',
      { mode: 0o600 },
    );
    const before = persistentInventory(sandbox);
    const port = await freeLocalPort();
    const processProbe = await startExecutableServer({
      NODE_ENV: 'test', HMI_ROOM_IMAGE_TEST_ROOT_OVERRIDE: '1',
      HMI_HOST: '127.0.0.1', HMI_PORT: String(port), HMI_CONFIG_PATH: configPath,
      HMI_HOUSEHOLD_CONFIG_PATH: householdConfigPath, HMI_HOUSEHOLD_CONFIG_MODE: 'active',
      HMI_REQUIRED_WRITABLE_DIRS: sandbox, HMI_FAMILY_DATA_PATH: join(sandbox, 'family.json'),
      HMI_ROOM_IMAGE_ASSET_ROOT: assetRoot, HMI_ROOM_IMAGE_UPLOAD_ROOT: uploadRoot,
      HMI_ROOM_IMAGE_TEMP_ROOT: prepared.jobStore.privateRoot,
      HMI_ROOM_IMAGE_AUTH_MODE: 'trusted_proxy', HMI_ROOM_IMAGE_TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
      HMI_ROOM_IMAGE_IDENTITY_HEADER: IDENTITY_HEADER, HMI_AI_CUSTOMIZING_ENABLED: '0',
      HMI_KEYCHAIN_SERVICE: 'nonexistent-recovery-probe', HMI_KEYCHAIN_ACCOUNT: 'nonexistent-recovery-probe',
      HMI_ABLAGE_KEYCHAIN_SERVICE: 'nonexistent-recovery-probe',
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      let get: Response | undefined;
      for (let spin = 0; spin < 200 && !get; spin += 1) {
        if (processProbe.child.exitCode !== null) break;
        try { get = await fetch(`${base}${publicAsset.variants.light}`); } catch { /* child not listening yet */ }
        if (!get) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(get?.status, JSON.stringify(processProbe.output())).toBe(200);
      expect(new Uint8Array(await get!.arrayBuffer())).toEqual(bytes('executable-light'));
      const head = await fetch(`${base}${publicAsset.variants.darkOff}`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect((await head.arrayBuffer()).byteLength).toBe(0);
      const blocked = await Promise.all([
        fetch(`${base}/api/config`),
        fetch(`${base}/api/room-image-uploads`, {
          method: 'POST', headers: privateHeaders({ 'content-type': 'image/png', 'content-length': '1' }), body: 'x',
        }),
      ]);
      expect(blocked.map((response) => response.status)).toEqual([503, 503]);
      for (const response of blocked) {
        await expect(response.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
      }
      expect(processProbe.child.exitCode).toBeNull();
      expect(persistentInventory(sandbox)).toEqual(before);
    } finally {
      await stopExecutableServer(processProbe.child, processProbe.closed);
    }
  }, 10_000);

  it('keeps startup recovery failure write-free while serving only a valid catalogued public asset read-only', async () => {
    const sandbox = root('hauser-startup-read-only-assets-');
    const staticRoot = join(sandbox, 'dist');
    const configDirectory = join(sandbox, 'config');
    const householdConfigPath = join(configDirectory, 'household.json');
    const configPath = join(configDirectory, 'shared.json');
    const catalogPath = join(configDirectory, 'room-images', 'assets.json');
    const assetRoot = join(sandbox, 'assets');
    const uploadRoot = join(sandbox, 'uploads');
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
    installHousehold(householdConfigPath);
    writeFileSync(configPath, '{"hmi:backend":"fake"}\n', { mode: 0o600 });
    const seed = createRoomImageAssetStore({ catalogPath, assetRoot });
    const publicAsset = seed.publish(
      'startup_public_asset',
      { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      { light: bytes('startup-light'), dark: bytes('startup-dark'), darkOff: bytes('startup-dark-off') },
    );
    const prepared = awaitingFinalJob(sandbox);
    expect(prepared.jobStore.beginPublish('fixture-user', prepared.finalJobId).type).toBe('started');
    const setsRoot = join(assetRoot, 'room-images');
    mkdirSync(join(setsRoot, '.publishing-orphan_asset'));
    mkdirSync(join(setsRoot, 'orphan_asset'));
    writeFileSync(join(setsRoot, 'orphan_asset', 'orphan.bin'), 'orphan');
    mkdirSync(uploadRoot, { recursive: true });
    writeFileSync(join(uploadRoot, `.upload-${'u'.repeat(43)}-${'p'.repeat(16)}.tmp`), 'upload-partial', { mode: 0o600 });
    writeFileSync(join(prepared.jobStore.metadataRoot, `.job-${prepared.finalJobId}-${'p'.repeat(16)}.tmp`), 'job-partial', { mode: 0o600 });
    writeFileSync(join(prepared.jobStore.privateRoot, 'partials', '.room-image-orphan.tmp'), 'private-partial', { mode: 0o600 });
    const journalDirectory = join(configDirectory, '.hauser-setup-transactions');
    mkdirSync(journalDirectory, { mode: 0o700 });
    writeFileSync(
      join(journalDirectory, 'setup-11111111-1111-4111-8111-111111111111.journal'),
      '{broken-startup-journal',
      { mode: 0o600 },
    );
    const before = persistentInventory(sandbox);

    const server = createHmiServer('', {
      staticRoot, configPath, householdConfigPath, householdConfigMode: 'active',
      householdConfigMigrationResult: { ok: true, status: 'current' }, requiredWritableDirs: [sandbox],
      paperlessPin: '', paperlessToken: '', allowedOrigins: new Set([ORIGIN]),
      roomImageAuthConfig: authConfig(), roomImageUploadRoot: uploadRoot,
      roomImageJobRoot: prepared.jobStore.metadataRoot, roomImageTempRoot: prepared.jobStore.privateRoot,
      roomImageAssetRoot: assetRoot, roomImageAssetCatalogPath: catalogPath,
      familyDataPath: join(sandbox, 'family.json'),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const get = await fetch(`${base}${publicAsset.variants.light}`);
    expect(get.status).toBe(200);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes('startup-light'));
    const head = await fetch(`${base}${publicAsset.variants.darkOff}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect((await fetch(`${base}/assets/room-images/orphan_asset/light.avif`)).status).toBe(404);

    const blocked = await Promise.all([
      fetch(`${base}/api/config`, {
        method: 'PUT', headers: { 'content-type': 'application/json', origin: ORIGIN, 'if-match': '"stale"' },
        body: '{"updates":{"hmi:ha-url":"http://must-not-write.fixture"}}',
      }),
      fetch(`${base}/api/room-image-uploads`, {
        method: 'POST', headers: privateHeaders({ 'content-type': 'image/png', 'content-length': '1' }), body: 'x',
      }),
      fetch(`${base}/api/room-image-jobs/${prepared.finalJobId}/publish`, {
        method: 'POST', headers: privateHeaders({ 'content-type': 'application/json' }), body: '{"confirmed":true}',
      }),
      fetch(`${base}/api/room-image-jobs/${prepared.finalJobId}/cancel`, { method: 'POST', headers: privateHeaders() }),
      fetch(`${base}/api/room-image-assets/${publicAsset.assetId}`, { method: 'DELETE', headers: privateHeaders() }),
      fetch(`${base}/api/room-image-assignments/den`, {
        method: 'PUT', headers: privateHeaders({ 'content-type': 'application/json', 'if-match': '"stale"' }), body: '{"asset":null}',
      }),
    ]);
    expect(blocked.map((response) => response.status)).toEqual([503, 503, 503, 503, 503, 503]);
    for (const response of blocked) {
      await expect(response.json()).resolves.toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
    }
    expect(persistentInventory(sandbox)).toEqual(before);
  });

  it('requires both current ETags before any reconfigure write and accepts the matching pair', async () => {
    const app = await startSetup({ sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://old.fixture' } });
    const household = await fetch(`${app.base}/api/household-config`);
    const householdEtag = household.headers.get('etag')!;
    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    const householdBefore = readFileSync(app.householdConfigPath);
    const sharedBefore = readFileSync(app.configPath);
    const cases: Array<[string, Record<string, string>, number]> = [
      ['missing both', {}, 428],
      ['missing shared', { 'if-match': householdEtag }, 428],
      ['missing household', { 'x-hauser-shared-config-if-match': sharedEtag }, 428],
      ['stale household', { 'if-match': '"stale"', 'x-hauser-shared-config-if-match': sharedEtag }, 412],
      ['stale shared', { 'if-match': householdEtag, 'x-hauser-shared-config-if-match': '"stale"' }, 412],
    ];
    for (const [label, headers, expected] of cases) {
      const response = await setupRequest(app, headers, label);
      expect(response.status, label).toBe(expected);
      expect(readFileSync(app.householdConfigPath)).toEqual(householdBefore);
      expect(readFileSync(app.configPath)).toEqual(sharedBefore);
    }
    const accepted = await setupRequest(app, {
      'if-match': householdEtag,
      'x-hauser-shared-config-if-match': sharedEtag,
    }, 'Matching ETags');
    expect(accepted.status).toBe(200);
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).rooms[0].name).toBe('Matching ETags');
    expect(statSync(app.householdConfigPath).mode & 0o777).toBe(0o600);
    expect(statSync(app.configPath).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['shared_config_committed', 71, false],
    ['household_config_renamed', 72, true],
  ])('recovers a real child-process crash at %s to one complete generation without journals or partials', async (crashStep, exitCode, householdRenamed) => {
    const sandbox = root('hauser-setup-child-crash-');
    const crashed = await runSetupCrashChild(sandbox, crashStep, exitCode);
    expect(crashed).toEqual({ code: exitCode, signal: null, stdout: '', stderr: '', timedOut: false });

    const configDirectory = join(sandbox, 'config');
    const journalDirectory = join(configDirectory, '.hauser-setup-transactions');
    const journalNames = readdirSync(journalDirectory);
    expect(journalNames).toHaveLength(1);
    expect(statSync(configDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(journalDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(join(journalDirectory, journalNames[0])).mode & 0o777).toBe(0o600);
    const journal = JSON.parse(readFileSync(join(journalDirectory, journalNames[0]), 'utf8'));
    expect(journal).toMatchObject({ version: 1, phase: 'shared_committed' });
    expect(Object.keys(journal)).toEqual(['version', 'id', 'phase', 'targets']);
    expect(existsSync(join(configDirectory, 'shared.json'))).toBe(true);
    expect(existsSync(join(configDirectory, 'household.json'))).toBe(householdRenamed);

    const recovered = await startSetup({ sandbox, installHousehold: false });
    const health = await fetch(`${recovered.base}/api/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ status: 'ready' });
    const shared = JSON.parse(readFileSync(recovered.configPath, 'utf8'));
    const household = JSON.parse(readFileSync(recovered.householdConfigPath, 'utf8'));
    expect(shared['hmi:ha-url']).toBe('http://child-home-assistant.fixture');
    expect(household.rooms[0].name).toBe('Recovered child generation');
    expect(statSync(recovered.configPath).mode & 0o777).toBe(0o600);
    expect(statSync(recovered.householdConfigPath).mode & 0o777).toBe(0o600);
    expect(setupArtifacts(sandbox)).toEqual([]);
    expect(readdirSync(configDirectory).some((name: string) => name.startsWith('.setup-'))).toBe(false);
  }, 10_000);

  it('keeps the new common generation after a post-Household-commit error and restarts without replay artifacts', async () => {
    const app = await startSetup({
      sharedValues: { 'hmi:backend': 'fake', 'hmi:ha-url': 'http://before.fixture' },
      serverOptions: {
        setupMutationStep(step: string) {
          if (step === 'household_config_committed') throw new Error('forced post-Household-commit fault');
        },
      },
    });
    const householdResponse = await fetch(`${app.base}/api/household-config`);
    const sharedResponse = await fetch(`${app.base}/api/config`);
    const headers = {
      'if-match': householdResponse.headers.get('etag')!,
      'x-hauser-shared-config-if-match': sharedResponse.headers.get('etag')!,
    };
    await Promise.all([householdResponse.arrayBuffer(), sharedResponse.arrayBuffer()]);
    const response = await setupRequest(app, headers, 'Committed despite response fault');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'SETUP_RECONFIGURATION_FAILED' });
    const committedShared = readFileSync(app.configPath);
    const committedHousehold = readFileSync(app.householdConfigPath);
    expect(JSON.parse(committedShared.toString('utf8'))['hmi:ha-url']).toBe('http://home-assistant.fixture');
    expect(JSON.parse(committedHousehold.toString('utf8')).rooms[0].name).toBe('Committed despite response fault');
    expect(setupArtifacts(app.sandbox)).toEqual([]);

    await stop(app.server);
    const restarted = await startSetup({ sandbox: app.sandbox, installHousehold: false });
    expect(readFileSync(restarted.configPath)).toEqual(committedShared);
    expect(readFileSync(restarted.householdConfigPath)).toEqual(committedHousehold);
    expect(setupArtifacts(app.sandbox)).toEqual([]);
  });

  it.each(['corrupt-json', 'unsafe-mode'])('fails closed at startup for a %s setup journal without config mutation or path/credential disclosure', async (fault) => {
    const sandbox = root('hauser-setup-corrupt-journal-');
    const configDirectory = join(sandbox, 'config');
    const householdConfigPath = join(configDirectory, 'household.json');
    const configPath = join(configDirectory, 'shared.json');
    installHousehold(householdConfigPath);
    writeFileSync(configPath, '{"hmi:backend":"fake","hmi:ha-token":"private-fixture-marker"}\n', { mode: 0o600 });
    const sharedBefore = readFileSync(configPath);
    const householdBefore = readFileSync(householdConfigPath);
    const journalDirectory = join(configDirectory, '.hauser-setup-transactions');
    const journalPath = join(journalDirectory, 'setup-11111111-1111-4111-8111-111111111111.journal');
    mkdirSync(journalDirectory, { mode: 0o700 });
    writeFileSync(journalPath, '{broken-journal', { mode: 0o600 });
    if (fault === 'unsafe-mode') chmodSync(journalPath, 0o644);
    const journalBefore = readFileSync(journalPath);

    const app = await startSetup({ sandbox, installHousehold: false });
    const responses = await Promise.all([
      fetch(`${app.base}/api/health`),
      fetch(`${app.base}/api/config`),
      fetch(`${app.base}/api/household-config`),
      setupRequest(app),
      fetch(`${app.base}/api/room-image-assignments/den`, { method: 'PUT' }),
    ]);
    expect(responses.map((candidate) => candidate.status)).toEqual([503, 503, 503, 503, 503]);
    const bodies = await Promise.all(responses.map((candidate) => candidate.text()));
    for (const body of bodies) {
      expect(body).toContain('SETUP_CONFIG_RECOVERY_REQUIRED');
      expect(body).not.toContain(sandbox);
      expect(body).not.toContain('private-fixture-marker');
      expect(body).not.toContain('child-fixture-token');
    }
    expect(readFileSync(configPath)).toEqual(sharedBefore);
    expect(readFileSync(householdConfigPath)).toEqual(householdBefore);
    expect(readFileSync(journalPath)).toEqual(journalBefore);
    expect(statSync(journalPath).mode & 0o777).toBe(fault === 'unsafe-mode' ? 0o644 : 0o600);
  });

  it.each([
    ['shared.after absent', () => null, (value: any) => bytes(`${JSON.stringify(value)}\n`)],
    ['Shared-After with an unknown key', () => bytes('{"unknown":"private-after-marker"}\n'), (value: any) => bytes(`${JSON.stringify(value)}\n`)],
    ['Shared-After with a non-string value', () => bytes('{"hmi:backend":false}\n'), (value: any) => bytes(`${JSON.stringify(value)}\n`)],
    ['household.after absent', () => bytes('{"hmi:backend":"fake"}\n'), () => null],
    ['Household-After rejected by parse', () => bytes('{"hmi:backend":"fake"}\n'), () => bytes('{"schemaVersion":3}\n')],
    ['Household-After rejected by compile/project', () => bytes('{"hmi:backend":"fake"}\n'), (value: any) => {
      value.enabledModules.push('media');
      value.mediaTargets = [];
      return bytes(`${JSON.stringify(value)}\n`);
    }],
  ])('rejects semantically invalid %s before any setup recovery mutation', async (_label, sharedAfterFactory, householdAfterFactory) => {
    const sandbox = root('hauser-setup-semantic-journal-');
    const configDirectory = join(sandbox, 'config');
    const householdConfigPath = join(configDirectory, 'household.json');
    const configPath = join(configDirectory, 'shared.json');
    installHousehold(householdConfigPath);
    const householdBefore = readFileSync(householdConfigPath);
    const sharedBeforeEvidence = bytes('{"hmi:ha-token":"private-before-marker"}\n');
    const sharedAfter = sharedAfterFactory();
    const householdAfter = householdAfterFactory(JSON.parse(householdBefore.toString('utf8')));
    const setupBody = JSON.stringify({
      haUrl: 'http://home-assistant.fixture',
      haToken: 'private-request-marker',
      householdConfig: JSON.parse(householdBefore.toString('utf8')),
      jellyfin: { enabled: false },
    });
    if (sharedAfter !== null) writeFileSync(configPath, sharedAfter, { mode: 0o600 });

    const journalDirectory = join(configDirectory, '.hauser-setup-transactions');
    const id = '22222222-2222-4222-8222-222222222222';
    const journalPath = join(journalDirectory, `setup-${id}.journal`);
    mkdirSync(journalDirectory, { mode: 0o700 });
    const journal = {
      version: 1,
      id,
      phase: 'shared_committed',
      targets: {
        shared: {
          role: 'shared',
          pathBinding: setupJournalPathBinding(configPath),
          before: setupJournalState(sharedBeforeEvidence),
          after: setupJournalState(sharedAfter),
        },
        household: {
          role: 'household',
          pathBinding: setupJournalPathBinding(householdConfigPath),
          before: setupJournalState(householdBefore),
          after: setupJournalState(householdAfter),
        },
      },
    };
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`, { mode: 0o600 });
    const sharedTargetBefore = existsSync(configPath) ? readFileSync(configPath) : null;
    const journalBefore = readFileSync(journalPath);

    const app = await startSetup({ sandbox, installHousehold: false });
    const responses = await Promise.all([
      fetch(`${app.base}/api/health`),
      fetch(`${app.base}/api/config`),
      fetch(`${app.base}/api/household-config`),
      fetch(`${app.base}/api/setup/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: setupBody,
      }),
      fetch(`${app.base}/api/room-image-assignments/den`, { method: 'PUT' }),
    ]);
    expect(responses.map((candidate) => candidate.status)).toEqual([503, 503, 503, 503, 503]);
    for (const body of await Promise.all(responses.map((candidate) => candidate.text()))) {
      expect(body).toContain('SETUP_CONFIG_RECOVERY_REQUIRED');
      expect(body).not.toContain(sandbox);
      expect(body).not.toContain('private-before-marker');
      expect(body).not.toContain('private-after-marker');
      expect(body).not.toContain('private-request-marker');
    }
    expect(existsSync(configPath)).toBe(sharedTargetBefore !== null);
    if (sharedTargetBefore !== null) expect(readFileSync(configPath)).toEqual(sharedTargetBefore);
    expect(readFileSync(householdConfigPath)).toEqual(householdBefore);
    expect(readFileSync(journalPath)).toEqual(journalBefore);
    expect(statSync(journalDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(journalPath).mode & 0o777).toBe(0o600);
  });

  it('rejects symlinked asset/catalog ancestors without mutating an invalid existing catalog and still initializes safe missing paths', () => {
    const sandbox = root();
    const assetTarget = join(sandbox, 'asset-target');
    const linkedAssetParent = join(sandbox, 'linked-asset-parent');
    mkdirSync(assetTarget, { recursive: true });
    symlinkSync(assetTarget, linkedAssetParent);
    expect(() => createRoomImageAssetStore({
      catalogPath: join(sandbox, 'safe-config', 'room-images', 'assets.json'),
      assetRoot: join(linkedAssetParent, 'assets'),
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));

    const catalogTarget = join(sandbox, 'catalog-target');
    const linkedCatalogParent = join(sandbox, 'linked-catalog-parent');
    mkdirSync(catalogTarget, { recursive: true });
    symlinkSync(catalogTarget, linkedCatalogParent);
    expect(() => createRoomImageAssetStore({
      catalogPath: join(linkedCatalogParent, 'room-images', 'assets.json'),
      assetRoot: join(sandbox, 'safe-assets'),
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));

    const corruptCatalog = join(sandbox, 'corrupt-config', 'room-images', 'assets.json');
    const untouchedAssetRoot = join(sandbox, 'must-not-be-created');
    mkdirSync(dirname(corruptCatalog), { recursive: true });
    writeFileSync(corruptCatalog, '{broken');
    const corruptBytes = readFileSync(corruptCatalog);
    expect(() => createRoomImageAssetStore({ catalogPath: corruptCatalog, assetRoot: untouchedAssetRoot }))
      .toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
    expect(readFileSync(corruptCatalog)).toEqual(corruptBytes);
    expect(existsSync(untouchedAssetRoot)).toBe(false);

    const assetRoot = join(sandbox, 'assets');
    const store = createRoomImageAssetStore({
      catalogPath: join(sandbox, 'config', 'room-images', 'assets.json'), assetRoot,
    });
    const setsRoot = join(assetRoot, 'room-images');
    const reserved = 'reserved_asset';
    const orphanStage = 'orphan_stage';
    const orphanFinal = 'orphan_final';
    mkdirSync(join(setsRoot, `.publishing-${reserved}`));
    mkdirSync(join(setsRoot, reserved));
    mkdirSync(join(setsRoot, `.publishing-${orphanStage}`));
    mkdirSync(join(setsRoot, orphanFinal));
    store.cleanupOrphans(new Set([reserved]));
    expect(readdirSync(setsRoot).sort()).toEqual([`.publishing-${reserved}`, reserved].sort());
  });

  it('closes directory, manifest, traversal and HEAD paths after an asset file becomes a symlink', async () => {
    const app = await startB4();
    const asset = await publishAsset(app);
    const setPath = join(app.sandbox, 'assets', 'room-images', asset.assetId);
    const external = join(app.sandbox, 'external.avif');
    writeFileSync(external, 'external');
    rmSync(join(setPath, 'light.avif'));
    symlinkSync(external, join(setPath, 'light.avif'));
    for (const path of [
      `/assets/room-images/${asset.assetId}`,
      `/assets/room-images/${asset.assetId}/`,
      `/assets/room-images/${asset.assetId}/manifest.json`,
      `/assets/room-images/${asset.assetId}/%2e%2e%2flight.avif`,
      `/assets/room-images/${asset.assetId}/light.avif`,
    ]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${app.base}${path}`, { method });
        expect(response.status, `${method} ${path}`).toBe(404);
        if (method === 'HEAD') expect((await response.arrayBuffer()).byteLength).toBe(0);
      }
    }
    expect(() => createRoomImageAssetStore({
      catalogPath: join(app.sandbox, 'config', 'room-images', 'assets.json'),
      assetRoot: join(app.sandbox, 'assets'),
    })).toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
  });

  it('rejects a hash-matching but semantically wrong closed manifest document', () => {
    const sandbox = root();
    const catalogPath = join(sandbox, 'config', 'room-images', 'assets.json');
    const assetRoot = join(sandbox, 'assets');
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    const asset = store.publish(
      'manifest_asset',
      { panel: { x: 0.5, y: 0.48 }, phone: { x: 0.56, y: 0.43 } },
      { light: bytes('light'), dark: bytes('dark'), darkOff: bytes('dark-off') },
    );
    const manifestPath = join(assetRoot, 'room-images', asset.assetId, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.assetId = 'different_asset';
    const wrongManifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest)}\n`);
    writeFileSync(manifestPath, wrongManifestBytes, { mode: 0o600 });
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    catalog.assets[0].manifestSha256 = createHash('sha256').update(wrongManifestBytes).digest('hex');
    writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`, { mode: 0o600 });

    expect(() => createRoomImageAssetStore({ catalogPath, assetRoot }))
      .toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
  });

  it('fails closed for a corrupt catalog without mutating it', () => {
    const sandbox = root();
    const path = join(sandbox, 'config', 'room-images', 'assets.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{broken');
    const bytes = readFileSync(path);
    expect(() => createRoomImageAssetStore({ catalogPath: path, assetRoot: join(sandbox, 'assets') }))
      .toThrowError(expect.objectContaining({ code: 'ROOM_IMAGE_STORE_INVALID' }));
    expect(readFileSync(path)).toEqual(bytes);
  });
});
