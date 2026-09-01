import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error The production renderer intentionally remains native Node ESM without declarations.
import { ALGORITHM_VERSION, HIGHWAY_TYPES, MAX_QUERY_RADIUS_METRES, RADIUS_CANDIDATES_METRES, RENDERER_ERROR_CODES, ROAD_CLASSES, VIEWBOX_HEIGHT, VIEWBOX_WIDTH, chooseRenderRadius, classifyHighway, clipSegmentLiangBarsky, projectToLocalMetres, projectToViewBox, renderAmbientMap, serializeSvg } from '../../server/ambient-map-renderer.mjs';
// @ts-expect-error The production worker intentionally remains native Node ESM without declarations.
import { OVERPASS_ENDPOINTS, OVERPASS_RESPONSE_LIMIT_BYTES, OVERPASS_TIMEOUT_MS, OVERPASS_USER_AGENT, WORKER_ERROR_CODES, WORKER_MESSAGE_TYPE, executeWorkerMessage, fetchOverpassData, toWorkerErrorPayload, validateWorkerMessage } from '../../server/ambient-map-worker.mjs';

const centre = { latitude: 49.6069, longitude: 6.5508 };

function horizontalRoads(count: number, halfHeight: number, halfWidth = 5_000) {
  return Array.from({ length: count }, (_, index) => ({
    highway: 'residential',
    points: [
      [-halfWidth, -halfHeight + index * (halfHeight * 2 / (count - 1))],
      [halfWidth, -halfHeight + index * (halfHeight * 2 / (count - 1))],
    ],
  }));
}

function localPointToGeo([x, y]: [number, number]) {
  const earthRadius = 6_378_137;
  return {
    lat: centre.latitude + y / earthRadius * 180 / Math.PI,
    lon: centre.longitude + x / (earthRadius * Math.cos(centre.latitude * Math.PI / 180)) * 180 / Math.PI,
  };
}

function osmFixture(highways = ['residential']) {
  return {
    version: 0.6,
    generator: '<script>foreign-generator</script>',
    elements: highways.map((highway, index) => ({
      type: 'way',
      id: `foreign-id-${index}`,
      tags: { highway, name: `foreign-name-${index}`, onload: 'alert(1)' },
      geometry: [localPointToGeo([-500, index * 20]), localPointToGeo([500, index * 20])],
    })),
  };
}

function response(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

function jsonResponse(value: unknown) {
  return response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function bodyReaderFailureResponse(error: Error) {
  return {
    ok: true,
    headers: new Headers(),
    body: {
      getReader: () => ({ read: vi.fn().mockRejectedValue(error) }),
    },
  } as unknown as Response;
}

async function capturedError(action: () => Promise<unknown>) {
  try {
    await action();
    throw new Error('Expected action to fail');
  } catch (error) {
    return toWorkerErrorPayload(error);
  }
}

describe('ambient map renderer contract', () => {
  it('uses the fixed projection, highway classes, widths and radius candidates', () => {
    expect({ VIEWBOX_WIDTH, VIEWBOX_HEIGHT, MAX_QUERY_RADIUS_METRES, ALGORITHM_VERSION }).toEqual({
      VIEWBOX_WIDTH: 1_920,
      VIEWBOX_HEIGHT: 1_200,
      MAX_QUERY_RADIUS_METRES: 5_000,
      ALGORITHM_VERSION: 1,
    });
    expect(RADIUS_CANDIDATES_METRES).toEqual([800, 1_000, 1_250, 1_500, 2_000, 2_500, 3_500, 5_000]);
    expect(HIGHWAY_TYPES).toEqual([
      'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
      'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
      'residential', 'living_street', 'service',
    ]);
    expect(ROAD_CLASSES).toEqual([
      { name: 'local', strokeWidth: 1 },
      { name: 'tertiary', strokeWidth: 1.4 },
      { name: 'secondary', strokeWidth: 1.9 },
      { name: 'primary', strokeWidth: 2.5 },
      { name: 'major', strokeWidth: 3.2 },
    ]);
    expect([
      classifyHighway('service'), classifyHighway('tertiary_link'), classifyHighway('secondary'),
      classifyHighway('primary_link'), classifyHighway('motorway'), classifyHighway('footway'),
    ]).toEqual(['local', 'tertiary', 'secondary', 'primary', 'major', null]);

    const local = projectToLocalMetres({ lat: centre.latitude, lon: centre.longitude }, centre);
    expect(local).toEqual([0, 0]);
    expect(projectToViewBox(local, 2_000)).toEqual([960, 600]);
  });

  it('chooses 800 m at the lower boundary, 2,000 m for Saarburg-like density and 5,000 m for Cologne-like density', () => {
    expect(chooseRenderRadius([]).radiusMetres).toBe(800);
    expect(chooseRenderRadius(horizontalRoads(10, 1_125)).radiusMetres).toBe(2_000);
    expect(chooseRenderRadius(horizontalRoads(30, 3_000)).radiusMetres).toBe(5_000);
  });

  it('clips crossing segments and excludes geometry fully outside the rectangle', () => {
    const bounds = { minX: -10, maxX: 10, minY: -5, maxY: 5 };
    expect(clipSegmentLiangBarsky([-20, 0], [20, 0], bounds)).toEqual([[-10, 0], [10, 0]]);
    expect(clipSegmentLiangBarsky([-20, 8], [20, 8], bounds)).toBeNull();

    const rendered = renderAmbientMap({
      elements: [{
        type: 'way', tags: { highway: 'residential' },
        geometry: [localPointToGeo([6_000, 0]), localPointToGeo([7_000, 0])],
      }],
    }, centre);
    expect(new TextDecoder().decode(rendered.svgBytes)).not.toContain('<path');
  });

  it('serializes at most five fixed grouped paths, rounds duplicates and excludes foreign OSM strings', () => {
    const result = renderAmbientMap(osmFixture([
      'residential', 'tertiary', 'secondary_link', 'primary', 'trunk_link',
    ]), centre);
    const svg = new TextDecoder().decode(result.svgBytes);
    expect(svg.match(/<svg\b/g)).toHaveLength(1);
    expect(svg.match(/<path\b/g)).toHaveLength(5);
    expect(svg).toContain('viewBox="0 0 1920 1200"');
    expect(svg).toContain('stroke-width="1"');
    expect(svg).toContain('stroke-width="1.4"');
    expect(svg).toContain('stroke-width="1.9"');
    expect(svg).toContain('stroke-width="2.5"');
    expect(svg).toContain('stroke-width="3.2"');
    expect(svg).not.toMatch(/foreign|script|onload|alert|style=|href=/i);

    const rounded = serializeSvg({ local: [[[0.1, 0.1], [0.4, 0.4], [1.2, 1.2]]] });
    expect(rounded).toContain('d="M0 0L1 1"');
    expect(rounded).not.toContain('L0 0');
  });

  it('enforces the named SVG maximum with a stable error', () => {
    expect(() => serializeSvg({ local: [[[0, 0], [1, 1]]] }, { maxBytes: 1 }))
      .toThrowError(RENDERER_ERROR_CODES.SVG_TOO_LARGE);
  });
});

describe('ambient map worker contract', () => {
  it('validates exact input fields and returns only the four allowed success fields', async () => {
    const message = { type: WORKER_MESSAGE_TYPE, ...centre };
    expect(validateWorkerMessage(message)).toEqual(centre);
    expect(() => validateWorkerMessage({ ...message, label: 'Saarburg' })).toThrowError(WORKER_ERROR_CODES.INVALID_MESSAGE);

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(osmFixture()));
    const result = await executeWorkerMessage(message, { fetchImpl });
    expect(Object.keys(result).sort()).toEqual(['algorithmVersion', 'radiusMetres', 'svgBytes', 'wayCount']);
    expect(result.svgBytes).toBeInstanceOf(Uint8Array);
    expect(result.radiusMetres).toBe(800);
    expect(result.wayCount).toBe(1);
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(JSON.stringify(result)).not.toMatch(/Saarburg|latitude|longitude|elements|geometry|foreign/i);
  });

  it('uses only the fixed upstreams, named limits and User-Agent, and retries only after an endpoint failure', async () => {
    expect(OVERPASS_ENDPOINTS).toEqual([
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter',
    ]);
    expect(OVERPASS_TIMEOUT_MS).toBe(90_000);
    expect(OVERPASS_RESPONSE_LIMIT_BYTES).toBe(24 * 1_024 * 1_024);
    expect(OVERPASS_USER_AGENT).toContain('Hauser');

    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('first upstream unavailable'))
      .mockResolvedValueOnce(jsonResponse(osmFixture()));
    await expect(fetchOverpassData(centre.latitude, centre.longitude, { fetchImpl })).resolves.toEqual(osmFixture());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(OVERPASS_ENDPOINTS);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST', headers: { 'User-Agent': OVERPASS_USER_AGENT },
    });

    const firstSuccess = vi.fn().mockResolvedValue(jsonResponse(osmFixture()));
    await fetchOverpassData(centre.latitude, centre.longitude, { fetchImpl: firstSuccess });
    expect(firstSuccess).toHaveBeenCalledTimes(1);
  });

  it('retries body-reader transport failures and reports final body-reader timeouts as TIMEOUT', async () => {
    const fallbackFetch = vi.fn()
      .mockResolvedValueOnce(bodyReaderFailureResponse(new Error('body transport failed')))
      .mockResolvedValueOnce(jsonResponse(osmFixture()));
    await expect(fetchOverpassData(centre.latitude, centre.longitude, { fetchImpl: fallbackFetch }))
      .resolves.toEqual(osmFixture());
    expect(fallbackFetch.mock.calls.map(([url]) => url)).toEqual(OVERPASS_ENDPOINTS);

    const timeoutFetch = vi.fn().mockImplementation(() => Promise.resolve(bodyReaderFailureResponse(
      Object.assign(new Error('body timed out'), { name: 'TimeoutError' }),
    )));
    const payload = await capturedError(() => fetchOverpassData(
      centre.latitude, centre.longitude, { fetchImpl: timeoutFetch },
    ));
    expect(payload).toEqual({ errorCode: WORKER_ERROR_CODES.TIMEOUT });
    expect(timeoutFetch.mock.calls.map(([url]) => url)).toEqual(OVERPASS_ENDPOINTS);
  });

  it.each([
    [WORKER_ERROR_CODES.TIMEOUT, () => capturedError(() => fetchOverpassData(
      centre.latitude, centre.longitude,
      { fetchImpl: vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })) },
    ))],
    [WORKER_ERROR_CODES.UPSTREAMS_FAILED, () => capturedError(() => fetchOverpassData(
      centre.latitude, centre.longitude,
      { fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 503 })) },
    ))],
    [WORKER_ERROR_CODES.RESPONSE_TOO_LARGE, () => capturedError(() => fetchOverpassData(
      centre.latitude, centre.longitude,
      { fetchImpl: vi.fn().mockResolvedValue(response('oversized')), responseLimitBytes: 2 },
    ))],
    [WORKER_ERROR_CODES.INVALID_JSON, () => capturedError(() => fetchOverpassData(
      centre.latitude, centre.longitude,
      { fetchImpl: vi.fn().mockResolvedValue(response('{not-json')) },
    ))],
    [WORKER_ERROR_CODES.INVALID_OSM_STRUCTURE, () => capturedError(() => executeWorkerMessage(
      { type: WORKER_MESSAGE_TYPE, ...centre },
      { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ elements: [{ type: 'node' }] })) },
    ))],
    [WORKER_ERROR_CODES.SVG_TOO_LARGE, () => capturedError(() => executeWorkerMessage(
      { type: WORKER_MESSAGE_TYPE, ...centre },
      { fetchImpl: vi.fn().mockResolvedValue(jsonResponse(osmFixture())), rendererOptions: { maxBytes: 1 } },
    ))],
  ])('reports the stable %s error code without raw upstream data', async (expectedCode, action) => {
    const payload = await action();
    expect(payload).toEqual({ errorCode: expectedCode });
    expect(JSON.stringify(payload)).not.toMatch(/Saarburg|latitude|longitude|geometry|not-json|oversized/i);
  });
});
