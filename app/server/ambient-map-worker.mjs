import { parentPort } from 'node:worker_threads';
import {
  MAX_QUERY_RADIUS_METRES,
  HIGHWAY_TYPES,
  RENDERER_ERROR_CODES,
  AmbientMapRendererError,
  renderAmbientMap,
  validateCoordinates,
} from './ambient-map-renderer.mjs';

export const OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]);
export const OVERPASS_TIMEOUT_MS = 90_000;
/* AMBIENT-MAP S6: Die reale Overpass-Antwort für das Kölner Abfragefenster
   (10.000 × 6.250 m nach §4.1) misst 11.779.915 Bytes. Die vorherigen 8 MiB
   haben den Planfall aus §2 mit RESPONSE_TOO_LARGE abgebrochen. Die Grenze
   bleibt eine benannte Konstante nach §5.2 und liegt jetzt rund 2,1-fach über
   dem gemessenen Worst Case. */
export const OVERPASS_RESPONSE_LIMIT_BYTES = 24 * 1_024 * 1_024;
export const OVERPASS_USER_AGENT = 'Hauser/0.6 ambient-map-worker (+https://github.com/ralleur/hauser)';
export const WORKER_MESSAGE_TYPE = 'ambient-map:render';

export const WORKER_ERROR_CODES = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  UPSTREAMS_FAILED: 'UPSTREAMS_FAILED',
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_OSM_STRUCTURE: RENDERER_ERROR_CODES.INVALID_OSM_STRUCTURE,
  SVG_TOO_LARGE: RENDERER_ERROR_CODES.SVG_TOO_LARGE,
  INVALID_MESSAGE: 'INVALID_MESSAGE',
});

class AmbientMapWorkerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AmbientMapWorkerError';
    this.code = code;
  }
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}

export function validateWorkerMessage(message) {
  if (!exactKeys(message, ['type', 'latitude', 'longitude']) || message.type !== WORKER_MESSAGE_TYPE) {
    throw new AmbientMapWorkerError(WORKER_ERROR_CODES.INVALID_MESSAGE);
  }
  try {
    validateCoordinates(message.latitude, message.longitude);
  } catch {
    throw new AmbientMapWorkerError(WORKER_ERROR_CODES.INVALID_MESSAGE);
  }
  return { latitude: message.latitude, longitude: message.longitude };
}

function metresToLatitude(metres) {
  return metres / 6_378_137 * 180 / Math.PI;
}

function metresToLongitude(metres, latitude) {
  return metres / (6_378_137 * Math.cos(latitude * Math.PI / 180)) * 180 / Math.PI;
}

export function buildOverpassQuery(latitude, longitude) {
  validateCoordinates(latitude, longitude);
  const halfHeightMetres = MAX_QUERY_RADIUS_METRES / (1_920 / 1_200);
  const south = latitude - metresToLatitude(halfHeightMetres);
  const north = latitude + metresToLatitude(halfHeightMetres);
  const west = longitude - metresToLongitude(MAX_QUERY_RADIUS_METRES, latitude);
  const east = longitude + metresToLongitude(MAX_QUERY_RADIUS_METRES, latitude);
  const highwayPattern = HIGHWAY_TYPES.join('|');
  return `[out:json][timeout:90];way(${south},${west},${north},${east})["highway"~"^(${highwayPattern})$"];out geom;`;
}

function isTimeoutError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'ABORT_ERR';
}

async function readLimitedResponse(response, limitBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new AmbientMapWorkerError(WORKER_ERROR_CODES.RESPONSE_TOO_LARGE);
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limitBytes) {
        await reader.cancel();
        throw new AmbientMapWorkerError(WORKER_ERROR_CODES.RESPONSE_TOO_LARGE);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limitBytes) {
    throw new AmbientMapWorkerError(WORKER_ERROR_CODES.RESPONSE_TOO_LARGE);
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchOverpassData(latitude, longitude, {
  fetchImpl = globalThis.fetch,
  timeoutMs = OVERPASS_TIMEOUT_MS,
  responseLimitBytes = OVERPASS_RESPONSE_LIMIT_BYTES,
} = {}) {
  const query = buildOverpassQuery(latitude, longitude);
  let timeoutCount = 0;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response?.ok) continue;

      const text = await readLimitedResponse(response, responseLimitBytes);
      try {
        return JSON.parse(text);
      } catch {
        throw new AmbientMapWorkerError(WORKER_ERROR_CODES.INVALID_JSON);
      }
    } catch (error) {
      if (error instanceof AmbientMapWorkerError) throw error;
      if (isTimeoutError(error)) timeoutCount += 1;
      continue;
    }
  }

  throw new AmbientMapWorkerError(
    timeoutCount === OVERPASS_ENDPOINTS.length
      ? WORKER_ERROR_CODES.TIMEOUT
      : WORKER_ERROR_CODES.UPSTREAMS_FAILED,
  );
}

export async function executeWorkerMessage(message, dependencies = {}) {
  const centre = validateWorkerMessage(message);
  const data = await fetchOverpassData(centre.latitude, centre.longitude, dependencies);
  return renderAmbientMap(data, centre, dependencies.rendererOptions);
}

export function toWorkerErrorPayload(error) {
  const knownCodes = new Set(Object.values(WORKER_ERROR_CODES));
  const code = error instanceof AmbientMapWorkerError || error instanceof AmbientMapRendererError
    ? error.code
    : null;
  return { errorCode: knownCodes.has(code) ? code : WORKER_ERROR_CODES.UPSTREAMS_FAILED };
}

if (parentPort) {
  parentPort.once('message', async (message) => {
    try {
      const result = await executeWorkerMessage(message);
      parentPort.postMessage(result, [result.svgBytes.buffer]);
    } catch (error) {
      parentPort.postMessage(toWorkerErrorPayload(error));
    }
  });
}
