import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { constants as fsConstants } from 'node:fs';
import * as defaultFs from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { WORKER_MESSAGE_TYPE } from './ambient-map-worker.mjs';

export const AMBIENT_MAP_CONFIG_VERSION = 1;
export const AMBIENT_MAP_CONFIG_PATH = '/data/ambient-map.json';
export const AMBIENT_MAP_ASSET_DIRECTORY = '/assets/ambient-maps';
export const AMBIENT_MAP_BODY_LIMIT_BYTES = 4_096;

const ASSET_ID_PATTERN = /^[0-9a-f]{64}$/;
const ASSET_PATH_PATTERN = /^\/assets\/ambient-maps\/([0-9a-f]{64})\.svg$/;
const LOCATION_SOURCES = new Set(['home_assistant', 'browser', 'manual']);
const PUBLIC_ROUTE = '/api/ambient-map';
const ADMIN_ROUTE = '/api/admin/ambient-map';
const LOCATION_ROUTE = '/api/admin/ambient-map/location';
const REGENERATE_ROUTE = '/api/admin/ambient-map/regenerate';
const SEARCH_ROUTE = '/api/admin/ambient-map/search';

export class AmbientMapInputError extends Error {}
export class AmbientMapHomeAssistantUnavailableError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function validateCoordinates(latitude, longitude) {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)
    || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude)
    || longitude < -180 || longitude > 180) {
    throw new AmbientMapInputError();
  }
  return { latitude, longitude };
}

function validateLabel(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new AmbientMapInputError();
  const label = value.trim();
  if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new AmbientMapInputError();
  }
  return label;
}

export function validateAmbientMapLocation(value) {
  if (!hasExactKeys(value, ['source', 'latitude', 'longitude'], ['label'])
    || !LOCATION_SOURCES.has(value.source)) {
    throw new AmbientMapInputError();
  }
  const coordinates = validateCoordinates(value.latitude, value.longitude);
  const label = validateLabel(value.label);
  return {
    source: value.source,
    ...coordinates,
    ...(label === undefined ? {} : { label }),
  };
}

export function validateAmbientMapConfig(value) {
  if (!hasExactKeys(value, ['version', 'algorithmVersion', 'location', 'render', 'asset'])
    || value.version !== AMBIENT_MAP_CONFIG_VERSION
    || !Number.isSafeInteger(value.algorithmVersion) || value.algorithmVersion < 1
    || !hasExactKeys(value.render, ['radiusMetres', 'completedAt'])
    || !Number.isSafeInteger(value.render.radiusMetres)
    || value.render.radiusMetres < 1 || value.render.radiusMetres > 5_000
    || typeof value.render.completedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.render.completedAt)
    || Number.isNaN(Date.parse(value.render.completedAt))
    || !hasExactKeys(value.asset, ['id', 'byteLength'])
    || typeof value.asset.id !== 'string' || !ASSET_ID_PATTERN.test(value.asset.id)
    || !Number.isSafeInteger(value.asset.byteLength) || value.asset.byteLength < 1) {
    throw new AmbientMapInputError();
  }
  const location = validateAmbientMapLocation(value.location);
  return {
    version: AMBIENT_MAP_CONFIG_VERSION,
    algorithmVersion: value.algorithmVersion,
    location,
    render: {
      radiusMetres: value.render.radiusMetres,
      completedAt: value.render.completedAt,
    },
    asset: { id: value.asset.id, byteLength: value.asset.byteLength },
  };
}

export function validateAmbientMapLocationPayload(value) {
  if (!isRecord(value) || typeof value.source !== 'string') throw new AmbientMapInputError();
  if (value.source === 'home_assistant') {
    if (!hasExactKeys(value, ['source'])) throw new AmbientMapInputError();
    return { source: value.source };
  }
  if ((value.source !== 'browser' && value.source !== 'manual')
    || !hasExactKeys(value, ['source', 'latitude', 'longitude'])) {
    throw new AmbientMapInputError();
  }
  return { source: value.source, ...validateCoordinates(value.latitude, value.longitude) };
}

function assetPath(assetDirectory, assetId) {
  if (!ASSET_ID_PATTERN.test(assetId)) throw new AmbientMapInputError();
  return join(assetDirectory, `${assetId}.svg`);
}

async function flushDirectory(fs, path) {
  const handle = await fs.open(path, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSyncedFile(fs, path, bytes, mode) {
  const handle = await fs.open(path, 'wx', mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function unlinkBestEffort(fs, path) {
  try {
    await fs.unlink(path);
  } catch {
    // Cleanup never invalidates an already published state.
  }
}

function defaultWorkerFactory() {
  return new Worker(new URL('./ambient-map-worker.mjs', import.meta.url));
}

function runWorker(workerFactory, location, signal) {
  return new Promise((resolve, reject) => {
    const worker = workerFactory();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      void worker.terminate();
      finish(reject, new Error('aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      if (code !== 0 && !signal.aborted) finish(reject, new Error('worker_failed'));
    });
    worker.once('message', (result) => {
      void worker.terminate();
      if (!isRecord(result) || Object.hasOwn(result, 'errorCode')) {
        /* Den Code des Workers durchreichen statt verwerfen: „Erzeugung
           fehlgeschlagen" ist fuer den Benutzer wertlos, „Kartendienst nicht
           erreichbar" dagegen einzuordnen — und genau das ist der haeufigste
           Fall, weil Overpass ein von Freiwilligen betriebener Dienst ist. */
        const code = typeof result?.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.errorCode)
          ? result.errorCode
          : null;
        finish(reject, Object.assign(new Error('render_failed'), code ? { code } : {}));
        return;
      }
      finish(resolve, result);
    });
    worker.postMessage({
      type: WORKER_MESSAGE_TYPE,
      latitude: location.latitude,
      longitude: location.longitude,
    });
  });
}

/**
 * Resolves `promise` unless the job is superseded first. A superseded job stops
 * waiting immediately and its late result is dropped, so a slow Home Assistant
 * lookup can never overtake a newer order or block the next job.
 */
function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      void Promise.resolve(promise).catch(() => {});
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function validateRenderResult(result) {
  if (!isRecord(result)
    || !(result.svgBytes instanceof Uint8Array)
    || result.svgBytes.byteLength < 1
    || !Number.isSafeInteger(result.radiusMetres)
    || result.radiusMetres < 1 || result.radiusMetres > 5_000
    || !Number.isSafeInteger(result.algorithmVersion)
    || result.algorithmVersion < 1) {
    throw new Error('render_failed');
  }
  return {
    svgBytes: Buffer.from(result.svgBytes),
    radiusMetres: result.radiusMetres,
    algorithmVersion: result.algorithmVersion,
  };
}

function jsonResponse(response, statusCode, value, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

function emptyResponse(response, statusCode, headers = {}) {
  response.writeHead(statusCode, headers);
  response.end();
}

async function readJsonBody(request, limitBytes) {
  const contentType = String(request.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new AmbientMapInputError();
  const declaredLength = Number(request.headers?.['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) throw new AmbientMapInputError();
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.byteLength;
    if (byteLength > limitBytes) throw new AmbientMapInputError();
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AmbientMapInputError();
  }
}

export function createAmbientMapService({
  configPath = AMBIENT_MAP_CONFIG_PATH,
  assetDirectory = AMBIENT_MAP_ASSET_DIRECTORY,
  fs = defaultFs,
  workerFactory = defaultWorkerFactory,
  jobRunner,
  resolveHomeAssistantLocation,
  /* S3-Integration: Ob ein Home-Assistant-Zugang existiert, entscheidet der
     Server pro Anfrage neu — die Ersteinrichtung schreibt ihn ohne Neustart.
     Ohne Prädikat gilt allein das Vorhandensein des Resolvers. */
  homeAssistantConfigured = () => true,
  /* Ortssuche. Ohne injizierten Geokodierer bleibt die Route schlicht
     abgeschaltet — kein halb funktionierendes Suchfeld. */
  geocode = null,
  now = () => new Date(),
  bodyLimitBytes = AMBIENT_MAP_BODY_LIMIT_BYTES,
  makeId = randomUUID,
} = {}) {
  const configDirectory = dirname(configPath);
  const render = jobRunner ?? ((location, { signal }) => runWorker(workerFactory, location, signal));
  let activeConfig = null;
  let jobState = 'empty';
  /* Warum der letzte Auftrag scheiterte — nur im Adminstatus, nie öffentlich.
     Ohne diese Angabe steht in der Oberfläche „Erzeugung fehlgeschlagen" ohne
     jeden Hinweis darauf, dass etwa Home Assistant nicht erreichbar ist. Es ist
     ein Fehlercode, kein Standortdatum. */
  let jobErrorCode = null;
  let generation = 0;
  let activeJob = null;
  let closed = false;

  async function readCompleteAsset(config) {
    try {
      const bytes = await fs.readFile(assetPath(assetDirectory, config.asset.id));
      return bytes.byteLength === config.asset.byteLength
        && createHash('sha256').update(bytes).digest('hex') === config.asset.id;
    } catch {
      return false;
    }
  }

  async function cleanupAssets(referencedId) {
    let entries;
    try {
      entries = await fs.readdir(assetDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory() || (entry.name === `${referencedId}.svg` && ASSET_ID_PATTERN.test(referencedId ?? ''))) return;
      await unlinkBestEffort(fs, join(assetDirectory, entry.name));
    }));
  }

  async function publish(location, result, jobGeneration) {
    const validated = validateRenderResult(result);
    const assetId = createHash('sha256').update(validated.svgBytes).digest('hex');
    const finalAssetPath = assetPath(assetDirectory, assetId);
    const assetStagingPath = join(assetDirectory, `.${assetId}.${makeId()}.partial`);
    const completedAtValue = now();
    const completedAt = completedAtValue instanceof Date
      ? completedAtValue.toISOString()
      : new Date(completedAtValue).toISOString();
    const nextConfig = validateAmbientMapConfig({
      version: AMBIENT_MAP_CONFIG_VERSION,
      algorithmVersion: validated.algorithmVersion,
      location,
      render: { radiusMetres: validated.radiusMetres, completedAt },
      asset: { id: assetId, byteLength: validated.svgBytes.byteLength },
    });
    const configStagingPath = join(configDirectory, `.ambient-map.${makeId()}.partial`);
    const rollbackPath = join(configDirectory, `.ambient-map.${makeId()}.rollback`);
    let previousConfigBytes = null;
    let configReplaced = false;
    try {
      previousConfigBytes = await fs.readFile(configPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    // The rollback copy is staged before the config is replaced, so undoing a
    // failed commit is a single atomic rename that needs no further write.
    async function restorePreviousConfig() {
      if (previousConfigBytes === null) {
        await unlinkBestEffort(fs, configPath);
        try { await flushDirectory(fs, configDirectory); } catch { /* Best possible rollback. */ }
        return;
      }
      await fs.rename(rollbackPath, configPath);
      await fs.chmod(configPath, 0o600);
      await flushDirectory(fs, configDirectory);
    }

    try {
      await writeSyncedFile(fs, assetStagingPath, validated.svgBytes, 0o600);
      if (closed || jobGeneration !== generation) throw new Error('stale');
      await fs.rename(assetStagingPath, finalAssetPath);
      await flushDirectory(fs, assetDirectory);
      if (closed || jobGeneration !== generation) throw new Error('stale');
      await writeSyncedFile(fs, configStagingPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 0o600);
      if (previousConfigBytes !== null) {
        await writeSyncedFile(fs, rollbackPath, previousConfigBytes, 0o600);
      }
      if (closed || jobGeneration !== generation) throw new Error('stale');
      await fs.rename(configStagingPath, configPath);
      configReplaced = true;
      await fs.chmod(configPath, 0o600);
      await flushDirectory(fs, configDirectory);
      // Commit boundary: a supersede or close during the awaited durability
      // steps above must never become visible, so the rollback path applies.
      if (closed || jobGeneration !== generation) throw new Error('stale');
    } catch (error) {
      await unlinkBestEffort(fs, assetStagingPath);
      await unlinkBestEffort(fs, configStagingPath);
      if (configReplaced) {
        try { await restorePreviousConfig(); } catch { /* Preserve the original publish failure. */ }
      }
      await unlinkBestEffort(fs, rollbackPath);
      throw error;
    }
    await unlinkBestEffort(fs, rollbackPath);

    const previousAssetId = activeConfig?.asset.id;
    activeConfig = nextConfig;
    if (previousAssetId && previousAssetId !== assetId) {
      await unlinkBestEffort(fs, assetPath(assetDirectory, previousAssetId));
    }
    await cleanupAssets(assetId);
  }

  /**
   * Reserves a unique job generation for `locationSource` synchronously, so the
   * order of incoming mutations is fixed before any awaited resolution. The
   * source is either a ready location or an async resolver (Home Assistant).
   */
  function schedule(locationSource) {
    if (closed) return false;
    const nextGeneration = ++generation;
    const previous = activeJob;
    previous?.controller.abort();
    jobState = 'queued';
    const controller = new AbortController();
    const promise = (async () => {
      if (previous) await previous.promise.catch(() => {});
      if (closed || controller.signal.aborted || nextGeneration !== generation) return;
      try {
        const location = typeof locationSource === 'function'
          ? await raceAbort(locationSource(), controller.signal)
          : locationSource;
        if (closed || controller.signal.aborted || nextGeneration !== generation) return;
        jobState = 'running';
        const result = await render(location, { signal: controller.signal, generation: nextGeneration });
        if (closed || controller.signal.aborted || nextGeneration !== generation) return;
        await publish(location, result, nextGeneration);
        if (!closed && nextGeneration === generation) { jobState = 'ready'; jobErrorCode = null; }
      } catch (error) {
        if (!closed && nextGeneration === generation) {
          jobState = 'error';
          /* Ausschließlich eigene Codes: die Fehler dieses Features tragen sie
             als `message`, alles Fremde bleibt anonym. */
          const code = typeof error?.code === 'string' ? error.code
            : typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]*$/.test(error.message)
              ? error.message
              : null;
          jobErrorCode = code;
        }
      } finally {
        if (activeJob?.generation === nextGeneration) activeJob = null;
      }
    })();
    activeJob = { generation: nextGeneration, controller, promise };
    return true;
  }

  async function initialize() {
    await fs.mkdir(configDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(assetDirectory, { recursive: true, mode: 0o700 });
    let storedConfig = null;
    try {
      storedConfig = validateAmbientMapConfig(JSON.parse(await fs.readFile(configPath, 'utf8')));
      await fs.chmod(configPath, 0o600);
    } catch {
      storedConfig = null;
    }
    if (storedConfig && await readCompleteAsset(storedConfig)) {
      activeConfig = storedConfig;
      jobState = 'ready';
      jobErrorCode = null;
      await cleanupAssets(storedConfig.asset.id);
      return;
    }
    await cleanupAssets(storedConfig?.asset.id);
    if (storedConfig) schedule(storedConfig.location);
  }

  const ready = initialize();

  function publicStatus() {
    const result = { version: AMBIENT_MAP_CONFIG_VERSION, state: jobState };
    if (!activeConfig) return result;
    return {
      ...result,
      radiusMetres: activeConfig.render.radiusMetres,
      asset: {
        url: `/assets/ambient-maps/${activeConfig.asset.id}.svg`,
        etag: `"${activeConfig.asset.id}"`,
        byteLength: activeConfig.asset.byteLength,
      },
    };
  }

  function adminStatus() {
    const result = publicStatus();
    const withError = jobState === 'error' && jobErrorCode
      ? { ...result, errorCode: jobErrorCode }
      : result;
    if (!activeConfig) return withError;
    return {
      ...withError,
      source: activeConfig.location.source,
      ...(activeConfig.location.label ? { label: activeConfig.location.label } : {}),
    };
  }

  async function resolveHomeAssistantLocationSource() {
    let resolved;
    try {
      resolved = await resolveHomeAssistantLocation();
      if (!isRecord(resolved)) throw new Error();
      const coordinates = validateCoordinates(resolved.latitude, resolved.longitude);
      const label = validateLabel(resolved.location_name);
      return { source: 'home_assistant', ...coordinates, ...(label ? { label } : {}) };
    } catch {
      // Never surface the upstream error; the job reports a generic error state.
      throw new AmbientMapHomeAssistantUnavailableError();
    }
  }

  /**
   * Accepts a location mutation. Only checks that need no I/O run here — the
   * Home Assistant lookup itself happens inside the reserved job, so the route
   * answers immediately even while the resolver is still pending.
   */
  async function selectLocation(payload) {
    const selection = validateAmbientMapLocationPayload(payload);
    if (selection.source !== 'home_assistant') {
      schedule(selection);
      return;
    }
    if (typeof resolveHomeAssistantLocation !== 'function' || !homeAssistantConfigured()) {
      throw new AmbientMapHomeAssistantUnavailableError();
    }
    schedule(resolveHomeAssistantLocationSource);
  }

  async function serveAsset(request, response, id) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      emptyResponse(response, 405, { Allow: 'GET, HEAD' });
      return;
    }
    if (!activeConfig || activeConfig.asset.id !== id) {
      emptyResponse(response, 404);
      return;
    }
    let bytes;
    try {
      bytes = await fs.readFile(assetPath(assetDirectory, id));
    } catch {
      emptyResponse(response, 404);
      return;
    }
    if (bytes.byteLength !== activeConfig.asset.byteLength
      || createHash('sha256').update(bytes).digest('hex') !== id) {
      emptyResponse(response, 404);
      return;
    }
    const headers = {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${id}"`,
      'Content-Length': String(bytes.byteLength),
    };
    if (request.headers?.['if-none-match'] === headers.ETag) {
      emptyResponse(response, 304, headers);
      return;
    }
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  }

  async function route(request, response) {
    await ready;
    let pathname;
    const rawPathname = typeof request.url === 'string' ? request.url.split('?', 1)[0] : '';
    const rawAssetRequest = rawPathname.startsWith('/assets/ambient-maps/');
    try {
      pathname = new URL(request.url, 'http://ambient-map.invalid').pathname;
    } catch {
      return false;
    }
    const assetMatch = ASSET_PATH_PATTERN.exec(pathname);
    if (assetMatch) {
      await serveAsset(request, response, assetMatch[1]);
      return true;
    }
    if (rawAssetRequest || pathname.startsWith('/assets/ambient-maps/')) {
      emptyResponse(response, request.method === 'GET' || request.method === 'HEAD' ? 404 : 405,
        request.method === 'GET' || request.method === 'HEAD' ? {} : { Allow: 'GET, HEAD' });
      return true;
    }
    if (pathname === PUBLIC_ROUTE || pathname === ADMIN_ROUTE) {
      if (request.method !== 'GET') {
        emptyResponse(response, 405, { Allow: 'GET' });
      } else {
        jsonResponse(response, 200, pathname === PUBLIC_ROUTE ? publicStatus() : adminStatus());
      }
      return true;
    }
    if (pathname === LOCATION_ROUTE) {
      if (request.method !== 'POST') {
        emptyResponse(response, 405, { Allow: 'POST' });
        return true;
      }
      try {
        await selectLocation(await readJsonBody(request, bodyLimitBytes));
        jsonResponse(response, 202, { state: 'queued' });
      } catch (error) {
        jsonResponse(response, error instanceof AmbientMapHomeAssistantUnavailableError ? 503 : 400, {
          code: error instanceof AmbientMapHomeAssistantUnavailableError
            ? 'HOME_ASSISTANT_UNAVAILABLE'
            : 'INVALID_REQUEST',
        });
      }
      return true;
    }
    if (pathname === SEARCH_ROUTE) {
      if (request.method !== 'GET') {
        emptyResponse(response, 405, { Allow: 'GET' });
        return true;
      }
      if (typeof geocode !== 'function') {
        jsonResponse(response, 503, { code: 'GEOCODE_UNAVAILABLE' });
        return true;
      }
      let query;
      try {
        query = new URL(request.url, 'http://ambient-map.invalid').searchParams.get('q');
      } catch {
        query = null;
      }
      try {
        jsonResponse(response, 200, { results: await geocode(query) });
      } catch (error) {
        /* Eigene Codes, kein Upstreamtext. Der Suchbegriff selbst taucht in
           keiner Antwort wieder auf. */
        const code = typeof error?.code === 'string' ? error.code : 'GEOCODE_UPSTREAM_FAILED';
        const status = code === 'GEOCODE_INVALID_QUERY' ? 400
          : code === 'GEOCODE_RATE_LIMITED' ? 429
          : 502;
        jsonResponse(response, status, { code });
      }
      return true;
    }
    if (pathname === REGENERATE_ROUTE) {
      if (request.method !== 'POST') {
        emptyResponse(response, 405, { Allow: 'POST' });
        return true;
      }
      try {
        const body = await readJsonBody(request, bodyLimitBytes);
        if (!hasExactKeys(body, []) || !activeConfig) throw new AmbientMapInputError();
        schedule(activeConfig.location);
        jsonResponse(response, 202, { state: 'queued' });
      } catch {
        jsonResponse(response, 400, { code: 'INVALID_REQUEST' });
      }
      return true;
    }
    return false;
  }

  async function close() {
    closed = true;
    generation += 1;
    activeJob?.controller.abort();
    await activeJob?.promise.catch(() => {});
  }

  return {
    ready,
    route,
    close,
    getPublicStatus: publicStatus,
    getAdminStatus: adminStatus,
    selectLocation,
    regenerate() {
      if (!activeConfig) throw new AmbientMapInputError();
      schedule(activeConfig.location);
    },
  };
}
