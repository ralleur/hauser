import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Buffer } from 'node:buffer';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { createHash } from 'node:crypto';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import * as nodeFs from 'node:fs/promises';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Readable } from 'node:stream';
// @ts-expect-error The production server intentionally remains native Node ESM without declarations.
import { createAmbientMapService, validateAmbientMapConfig, validateAmbientMapLocationPayload } from '../../server/ambient-map-service.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type TempPaths = { root: string; configPath: string; assetDirectory: string };

function tempPaths(): TempPaths {
  const root = mkdtempSync(join(tmpdir(), 'hauser-ambient-map-'));
  roots.push(root);
  return {
    root,
    configPath: join(root, 'data', 'ambient-map.json'),
    assetDirectory: join(root, 'assets', 'ambient-maps'),
  };
}

function renderResult(svg = '<svg/>', radiusMetres = 2_000) {
  return { svgBytes: new TextEncoder().encode(svg), radiusMetres, wayCount: 1, algorithmVersion: 1 };
}

async function waitFor(predicate: () => boolean, message = 'condition') {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

type Gate = { reached: Promise<void>; released: Promise<void>; markReached: () => void; release: () => void };

function createGate(): Gate {
  let markReached: () => void = () => {};
  let release: () => void = () => {};
  const reached = new Promise<void>((resolve) => { markReached = () => resolve(); });
  const released = new Promise<void>((resolve) => { release = () => resolve(); });
  return { reached, released, markReached, release };
}

/**
 * Maps a real filesystem path to the publish step it belongs to, so failures and
 * pauses can be injected at exactly one atomic step.
 */
function labelFor(paths: TempPaths, kind: string, path: string) {
  const dataDirectory = join(paths.root, 'data');
  if (path === paths.configPath) return `${kind}:config`;
  if (path === dataDirectory) return `${kind}:config-dir`;
  if (path === paths.assetDirectory) return `${kind}:asset-dir`;
  if (path.startsWith(`${paths.assetDirectory}/`)) {
    return path.endsWith('.partial') ? `${kind}:asset-staging` : `${kind}:asset`;
  }
  if (path.endsWith('.rollback')) return `${kind}:config-rollback`;
  if (path.startsWith(`${dataDirectory}/`) && path.endsWith('.partial')) return `${kind}:config-staging`;
  return `${kind}:other`;
}

type FsControl = { operations?: string[]; failOnce?: Set<string>; gates?: Map<string, Gate> };

function instrumentedFs(paths: TempPaths, control: FsControl) {
  const record = async (label: string) => {
    control.operations?.push(label);
    const gate = control.gates?.get(label);
    if (gate) {
      control.gates?.delete(label);
      gate.markReached();
      await gate.released;
    }
    if (control.failOnce?.has(label)) {
      control.failOnce.delete(label);
      throw new Error(`fixture failure at ${label}`);
    }
  };
  return {
    ...nodeFs,
    async open(path: string, flags: string | number, mode?: number) {
      const handle = await nodeFs.open(path, flags, mode);
      return {
        writeFile: async (bytes: unknown) => {
          await record(labelFor(paths, 'write', path));
          await handle.writeFile(bytes as string);
        },
        sync: async () => {
          await record(labelFor(paths, 'sync', path));
          await handle.sync();
        },
        close: () => handle.close(),
      };
    },
    async rename(from: string, to: string) {
      await record(from.endsWith('.rollback') ? 'rename:config-rollback' : labelFor(paths, 'rename', to));
      await nodeFs.rename(from, to);
    },
    async chmod(path: string, mode: number) {
      await record(labelFor(paths, 'chmod', path));
      await nodeFs.chmod(path, mode);
    },
  };
}

function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const bytes = body === undefined ? [] : [JSON.stringify(body)];
  const stream = Readable.from(bytes) as Readable & {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  stream.url = path;
  stream.method = method;
  stream.headers = {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers,
  };
  return stream;
}

async function invoke(service: ReturnType<typeof createAmbientMapService>, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  let status = 0;
  let responseHeaders: Record<string, string> = {};
  const chunks: Uint8Array[] = [];
  const response = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string> = {}) {
      status = nextStatus;
      responseHeaders = nextHeaders;
    },
    end(chunk?: string | Uint8Array) {
      if (chunk !== undefined) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
    },
  };
  const handled = await service.route(request(path, method, body, headers), response);
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* Asset responses are not JSON. */ }
  return {
    handled,
    status,
    headers: responseHeaders,
    text,
    json,
  };
}

function completeConfig(id = 'a'.repeat(64), overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    algorithmVersion: 1,
    location: { source: 'manual', latitude: 49.6069, longitude: 6.5508, label: 'Saarburg' },
    render: { radiusMetres: 2_000, completedAt: '2026-08-31T12:00:00.000Z' },
    asset: { id, byteLength: 6 },
    ...overrides,
  };
}

describe('ambient map config and input contracts', () => {
  it('accepts only the exact persisted schema, exact payload keys, safe labels and strict coordinates', () => {
    expect(validateAmbientMapConfig(completeConfig()).location.label).toBe('Saarburg');
    expect(validateAmbientMapLocationPayload({ source: 'home_assistant' })).toEqual({ source: 'home_assistant' });
    expect(validateAmbientMapLocationPayload({ source: 'browser', latitude: -90, longitude: 180 })).toEqual({
      source: 'browser', latitude: -90, longitude: 180,
    });

    for (const invalid of [
      { ...completeConfig(), extra: true },
      completeConfig('A'.repeat(64)),
      completeConfig('a'.repeat(63)),
      completeConfig('a'.repeat(64), { location: { source: 'manual', latitude: 91, longitude: 0 } }),
      completeConfig('a'.repeat(64), { location: { source: 'manual', latitude: 0, longitude: 0, label: 'bad\nlabel' } }),
      completeConfig('a'.repeat(64), { render: { radiusMetres: '2000', completedAt: 'today' } }),
    ]) expect(() => validateAmbientMapConfig(invalid)).toThrow();

    for (const invalid of [
      { source: 'home_assistant', latitude: 1 },
      { source: 'manual', latitude: 0, longitude: 0, label: 'no' },
      { source: 'browser', latitude: Number.NaN, longitude: 0 },
      { source: 'other', latitude: 0, longitude: 0 },
    ]) expect(() => validateAmbientMapLocationPayload(invalid)).toThrow();
  });
});

describe('ambient map persistence and jobs', () => {
  it('publishes content-hash assets and mode-0600 config, then removes the superseded asset', async () => {
    const paths = tempPaths();
    const results = [renderResult('<svg>one</svg>'), renderResult('<svg>two</svg>', 1_500)];
    const service = createAmbientMapService({
      ...paths,
      jobRunner: async () => results.shift(),
      now: () => new Date('2026-08-31T12:00:00.000Z'),
    });
    await service.ready;
    await service.selectLocation({ source: 'manual', latitude: 49.6, longitude: 6.5 });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'first publish');
    const first = service.getPublicStatus().asset.url.split('/').at(-1).replace('.svg', '');
    await service.selectLocation({ source: 'browser', latitude: 50.9, longitude: 6.9 });
    await waitFor(() => service.getPublicStatus().state === 'ready'
      && !service.getPublicStatus().asset.url.includes(first), 'second publish');

    const config = JSON.parse(readFileSync(paths.configPath, 'utf8'));
    const expected = createHash('sha256').update('<svg>two</svg>').digest('hex');
    expect(config).toEqual({
      version: 1,
      algorithmVersion: 1,
      location: { source: 'browser', latitude: 50.9, longitude: 6.9 },
      render: { radiusMetres: 1_500, completedAt: '2026-08-31T12:00:00.000Z' },
      asset: { id: expected, byteLength: 14 },
    });
    expect(statSync(paths.configPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(paths.assetDirectory, `${expected}.svg`), 'utf8')).toBe('<svg>two</svg>');
    await expect(nodeFs.access(join(paths.assetDirectory, `${first}.svg`))).rejects.toMatchObject({ code: 'ENOENT' });
    await service.close();
  });

  it('writes and flushes the asset and the rollback copy before the config is replaced', async () => {
    const paths = tempPaths();
    const control: FsControl = { operations: [], failOnce: new Set<string>() };
    const fs = instrumentedFs(paths, control);
    const results = [renderResult('<svg>old</svg>'), renderResult('<svg>new</svg>')];
    const service = createAmbientMapService({ ...paths, fs, jobRunner: async () => results.shift() });
    await service.ready;
    await service.selectLocation({ source: 'manual', latitude: 1, longitude: 2 });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'stable publish');
    const previousFile = readFileSync(paths.configPath, 'utf8');
    const previousStatus = service.getPublicStatus();

    control.operations!.length = 0;
    control.failOnce!.add('rename:config');
    await service.selectLocation({ source: 'manual', latitude: 40, longitude: 50 });
    await waitFor(() => service.getPublicStatus().state === 'error', 'failed config rename');

    expect(control.operations!.slice(0, 9)).toEqual([
      'write:asset-staging',
      'sync:asset-staging',
      'rename:asset',
      'sync:asset-dir',
      'write:config-staging',
      'sync:config-staging',
      'write:config-rollback',
      'sync:config-rollback',
      'rename:config',
    ]);
    expect(readFileSync(paths.configPath, 'utf8')).toBe(previousFile);
    expect(service.getPublicStatus().asset).toEqual(previousStatus.asset);
    expect(service.getAdminStatus()).toMatchObject({ source: 'manual' });
    await service.close();
  });

  it('runs at most one job, aborts superseded work, and never publishes stale or post-close results', async () => {
    const paths = tempPaths();
    const starts: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const jobRunner = (location: { latitude: number }, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
      starts.push(location.latitude);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      const timer = setTimeout(() => {
        running -= 1;
        resolve(renderResult(`<svg>${location.latitude}</svg>`));
      }, location.latitude === 1 ? 50 : 10);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        running -= 1;
        reject(new Error('aborted'));
      }, { once: true });
    });
    const service = createAmbientMapService({ ...paths, jobRunner });
    await service.ready;
    await service.selectLocation({ source: 'manual', latitude: 1, longitude: 1 });
    await service.selectLocation({ source: 'manual', latitude: 2, longitude: 2 });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'latest-wins publish');
    expect(starts).toEqual([1, 2]);
    expect(maxRunning).toBe(1);
    expect(readFileSync(paths.configPath, 'utf8')).toContain('"latitude": 2');

    await service.selectLocation({ source: 'manual', latitude: 3, longitude: 3 });
    await service.close();
    expect(readFileSync(paths.configPath, 'utf8')).not.toContain('"latitude": 3');
  });

  it('discards a publish superseded inside the awaited config commit phase', async () => {
    const paths = tempPaths();
    const gates = new Map<string, Gate>();
    const fs = instrumentedFs(paths, { gates });
    let renders = 0;
    const jobRunner = (location: { latitude: number }, { signal }: { signal: AbortSignal }) => {
      renders += 1;
      if (renders < 3) return Promise.resolve(renderResult(`<svg>${location.latitude}</svg>`));
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };
    const service = createAmbientMapService({ ...paths, fs, jobRunner });
    await service.ready;
    await service.selectLocation({ source: 'manual', latitude: 1, longitude: 1 });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'stable publish');
    const previousFile = readFileSync(paths.configPath, 'utf8');
    const previousStatus = service.getPublicStatus();

    const gate = createGate();
    gates.set('chmod:config', gate);
    await service.selectLocation({ source: 'manual', latitude: 2, longitude: 2 });
    await gate.reached;
    // The config of job 2 is already renamed into place; supersede it mid-commit.
    await service.selectLocation({ source: 'manual', latitude: 3, longitude: 3 });
    gate.release();
    await waitFor(() => renders === 3, 'superseded job to unwind');

    expect(readFileSync(paths.configPath, 'utf8')).toBe(previousFile);
    expect(readFileSync(paths.configPath, 'utf8')).toContain('"latitude": 1');
    expect(service.getPublicStatus().asset).toEqual(previousStatus.asset);
    expect(service.getAdminStatus()).toMatchObject({ source: 'manual' });
    const asset = await invoke(service, previousStatus.asset.url);
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('<svg>1</svg>');
    await service.close();
  });

  it('discards a publish closed inside the awaited config commit phase', async () => {
    const paths = tempPaths();
    const gates = new Map<string, Gate>();
    const fs = instrumentedFs(paths, { gates });
    let renders = 0;
    const service = createAmbientMapService({
      ...paths,
      fs,
      jobRunner: async (location: { latitude: number }) => {
        renders += 1;
        return renderResult(`<svg>${location.latitude}</svg>`);
      },
    });
    await service.ready;
    await service.selectLocation({ source: 'manual', latitude: 1, longitude: 1 });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'stable publish');
    const previousFile = readFileSync(paths.configPath, 'utf8');
    const previousStatus = service.getPublicStatus();

    const gate = createGate();
    gates.set('chmod:config', gate);
    await service.selectLocation({ source: 'manual', latitude: 2, longitude: 2 });
    await gate.reached;
    const closing = service.close();
    gate.release();
    await closing;

    expect(renders).toBe(2);
    expect(readFileSync(paths.configPath, 'utf8')).toBe(previousFile);
    expect(readFileSync(paths.configPath, 'utf8')).toContain('"latitude": 1');
    expect(service.getPublicStatus().asset).toEqual(previousStatus.asset);
    expect(readFileSync(join(paths.assetDirectory, `${previousStatus.asset.url.split('/').at(-1).replace('.svg', '')}.svg`), 'utf8'))
      .toBe('<svg>1</svg>');
  });

  it('loads only a valid complete asset, cleans partials/orphans, and regenerates a missing active asset', async () => {
    const paths = tempPaths();
    mkdirSync(join(paths.root, 'data'), { recursive: true });
    mkdirSync(paths.assetDirectory, { recursive: true });
    const missingId = createHash('sha256').update('<svg/>').digest('hex');
    writeFileSync(paths.configPath, JSON.stringify(completeConfig(missingId)));
    writeFileSync(join(paths.assetDirectory, '.old.partial'), 'partial');
    writeFileSync(join(paths.assetDirectory, `${'b'.repeat(64)}.svg`), 'orphan');
    let renders = 0;
    const service = createAmbientMapService({
      ...paths,
      jobRunner: async () => { renders += 1; return renderResult('<svg/>'); },
    });
    await service.ready;
    expect(['queued', 'running', 'ready']).toContain(service.getPublicStatus().state);
    await waitFor(() => service.getPublicStatus().state === 'ready', 'regenerated missing asset');
    expect(renders).toBe(1);
    expect(service.getPublicStatus().asset.url).toBe(`/assets/ambient-maps/${missingId}.svg`);
    await expect(nodeFs.access(join(paths.assetDirectory, '.old.partial'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeFs.access(join(paths.assetDirectory, `${'b'.repeat(64)}.svg`))).rejects.toMatchObject({ code: 'ENOENT' });
    await service.close();
  });
});

const PUBLISH_FAILURE_STEPS = [
  'write:asset-staging',
  'sync:asset-staging',
  'rename:asset',
  'sync:asset-dir',
  'write:config-staging',
  'sync:config-staging',
  'write:config-rollback',
  'sync:config-rollback',
  'rename:config',
  'chmod:config',
  'sync:config-dir',
];

describe('ambient map publish fault injection', () => {
  it.each(PUBLISH_FAILURE_STEPS)('keeps the previous location, config and active asset usable when %s fails', async (step) => {
    const paths = tempPaths();
    const control: FsControl = { failOnce: new Set<string>() };
    const fs = instrumentedFs(paths, control);
    let renders = 0;
    const service = createAmbientMapService({
      ...paths,
      fs,
      jobRunner: async () => { renders += 1; return renderResult(`<svg>${renders}</svg>`); },
    });
    await service.ready;
    await service.selectLocation({ source: 'manual', latitude: 1, longitude: 2 });
    await waitFor(() => service.getPublicStatus().state === 'ready', `${step}: stable publish`);
    const previousFile = readFileSync(paths.configPath, 'utf8');
    const previousStatus = service.getPublicStatus();

    control.failOnce!.add(step);
    await service.selectLocation({ source: 'browser', latitude: 40, longitude: 50 });
    await waitFor(() => service.getPublicStatus().state === 'error', `${step}: failed publish`);

    // Previous persisted config, in-memory state and served asset stay intact.
    expect(readFileSync(paths.configPath, 'utf8')).toBe(previousFile);
    expect(JSON.parse(previousFile).location).toEqual({ source: 'manual', latitude: 1, longitude: 2 });
    expect(statSync(paths.configPath).mode & 0o777).toBe(0o600);
    expect(service.getPublicStatus().asset).toEqual(previousStatus.asset);
    expect(service.getAdminStatus()).toMatchObject({ source: 'manual' });
    const asset = await invoke(service, previousStatus.asset.url);
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('<svg>1</svg>');

    // The previous location is still usable for a follow-up render.
    const regenerated = await invoke(service, '/api/admin/ambient-map/regenerate', 'POST', {});
    expect(regenerated.status).toBe(202);
    await waitFor(() => service.getPublicStatus().state === 'ready', `${step}: recovery publish`);
    expect(JSON.parse(readFileSync(paths.configPath, 'utf8')).location)
      .toEqual({ source: 'manual', latitude: 1, longitude: 2 });
    await service.close();
  });

  it('keeps the previous state usable even when the rollback itself fails', async () => {
    const paths = tempPaths();
    const control: FsControl = { failOnce: new Set<string>() };
    const fs = instrumentedFs(paths, control);
    let renders = 0;
    const service = createAmbientMapService({
      ...paths,
      fs,
      jobRunner: async () => { renders += 1; return renderResult(`<svg>${renders}</svg>`); },
    });
    await service.ready;
    await service.selectLocation({ source: 'manual', latitude: 1, longitude: 2 });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'stable publish');
    const previousStatus = service.getPublicStatus();

    control.failOnce!.add('chmod:config');
    control.failOnce!.add('rename:config-rollback');
    await service.selectLocation({ source: 'browser', latitude: 40, longitude: 50 });
    await waitFor(() => service.getPublicStatus().state === 'error', 'failed publish with failed rollback');

    expect(service.getPublicStatus().asset).toEqual(previousStatus.asset);
    expect(service.getAdminStatus()).toMatchObject({ source: 'manual' });
    const asset = await invoke(service, previousStatus.asset.url);
    expect(asset.status).toBe(200);
    expect(asset.text).toBe('<svg>1</svg>');
    const regenerated = await invoke(service, '/api/admin/ambient-map/regenerate', 'POST', {});
    expect(regenerated.status).toBe(202);
    await waitFor(() => service.getPublicStatus().state === 'ready', 'recovery publish');
    expect(JSON.parse(readFileSync(paths.configPath, 'utf8')).location)
      .toEqual({ source: 'manual', latitude: 1, longitude: 2 });
    await service.close();
  });
});

describe('ambient map routes', () => {
  it('keeps public/admin status sanitized and maps HA/input/method outcomes without error details', async () => {
    const paths = tempPaths();
    let resolveHa = true;
    const service = createAmbientMapService({
      ...paths,
      resolveHomeAssistantLocation: async () => {
        if (!resolveHa) throw new Error('secret-token at 49.6,6.5');
        return { latitude: 49.6069, longitude: 6.5508, location_name: 'Saarburg', ignored: true };
      },
      jobRunner: async () => renderResult(),
    });
    await service.ready;
    const accepted = await invoke(service, '/api/admin/ambient-map/location', 'POST', { source: 'home_assistant' });
    expect(accepted).toMatchObject({ status: 202, json: { state: 'queued' } });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'home assistant publish');
    const publicResponse = await invoke(service, '/api/ambient-map');
    const adminResponse = await invoke(service, '/api/admin/ambient-map');
    expect(JSON.stringify(publicResponse.json)).not.toMatch(/Saarburg|49\.6069|6\.5508|latitude|longitude/u);
    expect(adminResponse.json).toMatchObject({ source: 'home_assistant', label: 'Saarburg' });
    expect(JSON.stringify(adminResponse.json)).not.toMatch(/49\.6069|6\.5508|latitude|longitude/u);
    const readyAsset = publicResponse.json.asset;

    expect((await invoke(service, '/api/ambient-map', 'POST', {})).status).toBe(405);
    expect((await invoke(service, '/api/admin/ambient-map/regenerate', 'POST', { extra: true })).status).toBe(400);
    expect((await invoke(service, '/api/admin/ambient-map/location', 'POST', { source: 'manual', latitude: 91, longitude: 0 })).status).toBe(400);

    // A failing resolver is a job failure, never an HTTP error detail leak.
    resolveHa = false;
    const failing = await invoke(service, '/api/admin/ambient-map/location', 'POST', { source: 'home_assistant' });
    expect(failing.status).toBe(202);
    await waitFor(() => service.getPublicStatus().state === 'error', 'home assistant job failure');
    const errored = await invoke(service, '/api/ambient-map');
    expect(errored.json.state).toBe('error');
    expect(errored.json.asset).toEqual(readyAsset);
    expect(errored.text).not.toMatch(/secret|49\.6|6\.5/u);
    expect((await invoke(service, '/unrelated')).handled).toBe(false);
    await service.close();
  });

  it('answers 503 for a Home Assistant location when no Home Assistant access is configured', async () => {
    const paths = tempPaths();
    let renders = 0;
    const service = createAmbientMapService({
      ...paths,
      jobRunner: async () => { renders += 1; return renderResult(); },
    });
    await service.ready;
    const response = await invoke(service, '/api/admin/ambient-map/location', 'POST', { source: 'home_assistant' });
    expect(response.status).toBe(503);
    expect(response.json).toEqual({ code: 'HOME_ASSISTANT_UNAVAILABLE' });
    expect(service.getPublicStatus().state).toBe('empty');
    expect(renders).toBe(0);
    await service.close();
  });

  it('reserves the job order on arrival, answers 202 while the HA resolver is pending, and drops its late result', async () => {
    const paths = tempPaths();
    let releaseHa: ((value: unknown) => void) | undefined;
    let haCalls = 0;
    const service = createAmbientMapService({
      ...paths,
      resolveHomeAssistantLocation: () => new Promise((resolve) => {
        haCalls += 1;
        releaseHa = resolve;
      }),
      jobRunner: async (location: { latitude: number }) => renderResult(`<svg>${location.latitude}</svg>`),
    });
    await service.ready;
    const accepted = await invoke(service, '/api/admin/ambient-map/location', 'POST', { source: 'home_assistant' });
    expect(accepted).toMatchObject({ status: 202, json: { state: 'queued' } });
    expect(haCalls).toBe(1);
    expect(service.getPublicStatus().state).toBe('queued');

    // A newer order arrives while the HA lookup is still outstanding.
    const superseding = await invoke(service, '/api/admin/ambient-map/location', 'POST', {
      source: 'manual', latitude: 12, longitude: 13,
    });
    expect(superseding.status).toBe(202);
    await waitFor(() => service.getPublicStatus().state === 'ready', 'superseding manual publish');

    releaseHa?.({ latitude: 49.6069, longitude: 6.5508, location_name: 'Saarburg' });
    await settle();
    expect(JSON.parse(readFileSync(paths.configPath, 'utf8')).location)
      .toEqual({ source: 'manual', latitude: 12, longitude: 13 });
    expect(service.getAdminStatus()).toMatchObject({ source: 'manual' });
    expect(JSON.stringify(service.getAdminStatus())).not.toMatch(/Saarburg/u);
    await service.close();
  });

  it('serves only the current hash via GET/HEAD with immutable headers, ETag/304, and strict 404/405 behavior', async () => {
    const paths = tempPaths();
    const service = createAmbientMapService({ ...paths, jobRunner: async () => renderResult('<svg>asset</svg>') });
    await service.ready;
    await service.selectLocation({ source: 'browser', latitude: 10, longitude: 20 });
    await waitFor(() => service.getPublicStatus().state === 'ready', 'asset publish');
    const { url, etag } = service.getPublicStatus().asset;
    const id = url.split('/').at(-1).replace('.svg', '');
    const get = await invoke(service, url);
    expect(get.status).toBe(200);
    expect(get.text).toBe('<svg>asset</svg>');
    expect(get.headers).toMatchObject({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
    });
    const head = await invoke(service, url, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.text).toBe('');
    expect(head.headers).toEqual(get.headers);
    expect((await invoke(service, url, 'GET', undefined, { 'if-none-match': etag })).status).toBe(304);
    expect((await invoke(service, `/assets/ambient-maps/${'f'.repeat(64)}.svg`)).status).toBe(404);
    expect((await invoke(service, `/assets/ambient-maps/${id.toUpperCase()}.svg`)).status).toBe(404);
    expect((await invoke(service, '/assets/ambient-maps/../ambient-map.json')).status).toBe(404);
    expect((await invoke(service, url, 'POST', {})).status).toBe(405);
    await service.close();
  });

  it('answers location and regenerate mutations with 202 before their render jobs finish', async () => {
    const paths = tempPaths();
    let release: (() => void) | undefined;
    const jobRunner = () => new Promise((resolve) => {
      release = () => resolve(renderResult());
    });
    const service = createAmbientMapService({ ...paths, jobRunner });
    await service.ready;
    const response = await invoke(service, '/api/admin/ambient-map/location', 'POST', {
      source: 'manual', latitude: 49.6, longitude: 6.5,
    });
    expect(response.status).toBe(202);
    expect(service.getPublicStatus().state).toBe('running');
    release?.();
    await waitFor(() => service.getPublicStatus().state === 'ready', 'first render');

    const regenerate = await invoke(service, '/api/admin/ambient-map/regenerate', 'POST', {});
    expect(regenerate.status).toBe(202);
    release?.();
    await service.close();
  });
});

/* Ortssuche: der bequemste Weg zu einem Standort. Sie darf keinen Upstreamtext
   nach aussen geben, ohne Geokodierer sauber abgeschaltet bleiben, und die
   Ratengrenze des Dienstes eigenstaendig melden — sonst tippt ein Benutzer
   weiter, waehrend Nominatim ihn laengst abweist. */
describe('Ortssuche über die Route', () => {
  it('liefert geprüfte Treffer und reicht den Suchbegriff nicht zurück', async () => {
    const geocode = vi.fn(async () => [
      { label: 'Dortmund, Nordrhein-Westfalen, Deutschland', latitude: 51.5142, longitude: 7.4653 },
    ]);
    const service = createAmbientMapService({ ...tempPaths(), geocode });

    const result = await invoke(service, '/api/admin/ambient-map/search?q=Dortmund');

    expect(result.status).toBe(200);
    expect(result.json).toEqual({
      results: [{ label: 'Dortmund, Nordrhein-Westfalen, Deutschland', latitude: 51.5142, longitude: 7.4653 }],
    });
    expect(geocode).toHaveBeenCalledWith('Dortmund');
    await service.close();
  });

  it('bleibt ohne injizierten Geokodierer abgeschaltet statt halb zu funktionieren', async () => {
    const service = createAmbientMapService({ ...tempPaths() });

    const result = await invoke(service, '/api/admin/ambient-map/search?q=Dortmund');

    expect(result.status).toBe(503);
    expect(result.json).toEqual({ code: 'GEOCODE_UNAVAILABLE' });
    await service.close();
  });

  it('bildet Eingabe-, Raten- und Dienstfehler auf eigene Codes ab', async () => {
    const fail = (code: string) => async () => { throw Object.assign(new Error(code), { code }); };
    for (const [code, status] of [
      ['GEOCODE_INVALID_QUERY', 400],
      ['GEOCODE_RATE_LIMITED', 429],
      ['GEOCODE_UPSTREAM_FAILED', 502],
    ] as const) {
      const service = createAmbientMapService({ ...tempPaths(), geocode: fail(code) });
      const result = await invoke(service, '/api/admin/ambient-map/search?q=Dortmund');
      expect(result.status).toBe(status);
      expect(result.json).toEqual({ code });
      await service.close();
    }
  });

  it('lässt nur GET zu', async () => {
    const service = createAmbientMapService({ ...tempPaths(), geocode: async () => [] });
    const result = await invoke(service, '/api/admin/ambient-map/search?q=Dortmund', 'POST');
    expect(result.status).toBe(405);
    await service.close();
  });
});
