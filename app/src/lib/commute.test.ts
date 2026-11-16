// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { Readable } from 'node:stream';
// @ts-expect-error Server modules run in Node without app declarations.
import { commuteGeometry, createCommuteService, DEFAULT_COMMUTE, parseCommuteConfig, projectCommute, rainStart } from '../../server/commute.mjs';
// @ts-expect-error Native Node server module.
import { commuteOverviewTiles } from '../../server/commute-overview.mjs';
// @ts-expect-error Native Node server module.
import { createLaundryHomeAssistantClient } from '../../server/laundry.mjs';
// @ts-expect-error Native Node test without @types/node.
import { WebSocketServer } from 'ws';
import { commuteMapCoverage, commutePanelWidth, departureFor, fitCommuteLayout, inCommuteWindow, freshCommute, type CommuteConfig, type CommuteRoute, type MapPoint } from './state/commute.ts';

const now = Date.parse('2026-11-16T06:18:00Z');
const config: CommuteConfig = { ...DEFAULT_COMMUTE, entryId: 'work' };
const raw = { points: [[50.9, 6.8], [50.95, 6.95], [51, 7.1]], duration: 2220,
  live: { at: new Date(now).toISOString(), delay: 720, sections: [{ points: [[50.95, 6.95], [50.96, 6.96]], delay: 420, magnitude: 3 }] } };
const states = [
  { entity_id: 'sensor.work_reports', state: '1', attributes: { live: true, search_mode: 'route_live', friendly_name: 'Work' } },
  { entity_id: 'geo_location.work_jam', state: '2', attributes: { latitude: 50.95, longitude: 6.95, type: 'jam', summary: 'A3: congestion', delay: 720 } },
  { entity_id: 'geo_location.other_accident', state: '1', attributes: { type: 'accident', summary: 'Different route', delay: 900 } },
];
const registry = states.map((s) => ({ entity_id: s.entity_id, config_entry_id: s.entity_id.includes('other') ? 'other' : 'work', platform: 'tomtom' }));

describe('Morning commute', () => {
  it.each<{ route: string; line: MapPoint[]; height: number; above: boolean }>([
    { route: 'horizontal', line: [[0, 0], [680, 200]], height: 560, above: true },
    { route: 'vertical', line: [[0, 0], [90, 285]], height: 560, above: false },
    { route: 'diagonal', line: [[0, 0], [680, 285]], height: 560, above: true },
    { route: 'diagonal', line: [[0, 0], [680, 285]], height: 440, above: false },
  ])('fits the $route route around the clock and card with $height px available', ({ line, height, above }) => {
    const area = { x: 320, y: 80, width: 1000, height };
    const gap = 24, clockHeight = 140, cardHeight = 190;
    const panelWidth = commutePanelWidth(area.width, gap);
    const { clockX, clockY, cardX, cardY, scale, tx, ty } = fitCommuteLayout(line, area, gap, panelWidth, clockHeight, cardHeight);
    expect(cardX > clockX).toBe(above);
    expect(scale).toBeGreaterThan(0.75);
    for (const [x, y] of line) {
      const screenX = tx + x * scale, screenY = ty + y * scale;
      expect(screenX).toBeGreaterThanOrEqual(above ? area.x : cardX + panelWidth + gap);
      expect(screenY).toBeGreaterThanOrEqual(above ? Math.max(clockY + clockHeight, cardY + cardHeight) + gap : area.y);
      expect(screenX).toBeLessThanOrEqual(area.x + area.width);
      expect(screenY).toBeLessThanOrEqual(area.y + area.height);
    }
  });
  it('requests the entire narrow screen and a margin in projected map coordinates', () => {
    const area = { x: 24, y: 92, width: 366, height: 525 };
    const line: MapPoint[] = [[180, 427], [820, 143]];
    const layout = fitCommuteLayout(line, area, 24, commutePanelWidth(area.width, 24), 140, 181);
    const [minX, minY, maxX, maxY] = commuteMapCoverage(414, 896, layout, 48);
    expect(layout.tx + minX * layout.scale).toBeLessThanOrEqual(-48);
    expect(layout.ty + minY * layout.scale).toBeLessThanOrEqual(-48);
    expect(layout.tx + maxX * layout.scale).toBeGreaterThanOrEqual(462);
    expect(layout.ty + maxY * layout.scale).toBeGreaterThanOrEqual(944);
    expect(minY).toBeLessThan(-90);
    expect(maxY).toBeGreaterThan(690);
  });
  it('covers the wide Bonn–Wesel viewport with a bounded set of overview tiles', () => {
    const tiles = commuteOverviewTiles([49.6, 1.6, 53, 9.7]);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThanOrEqual(12);
    const { zoom } = tiles[0];
    expect(zoom).toBeLessThan(10);
    const edges = (lat: number, lon: number) => ({ zoom,
      column: Math.floor((lon + 180) / 360 * 2 ** zoom),
      row: Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** zoom),
    });
    expect(tiles).toContainEqual(edges(49.6, 1.6));
    expect(tiles).toContainEqual(edges(53, 9.7));
  });
  it('keeps older settings and validates active office days and the display window', () => {
    const { showRain: _rain, ...older } = config;
    expect(parseCommuteConfig(older).showRain).toBe(true);
    expect(parseCommuteConfig({ ...config, showRain: false }).showRain).toBe(false);
    expect(parseCommuteConfig({ ...config, days: [] })).toBeNull();
    expect(parseCommuteConfig({ ...config, until: config.from })).toBeNull();
    expect(parseCommuteConfig({ ...config, entryId: '', days: [] })).not.toBeNull();
    expect(parseCommuteConfig({ ...older, parkingEntity: 'sensor.old_parking' })).not.toHaveProperty('parkingEntity');
    expect(parseCommuteConfig({ ...config, arrivals: { 8: '08:00' } })).toBeNull();
    expect(parseCommuteConfig({ ...config, nextArrival: { date: '2026-02-30', time: '08:00' } })).toBeNull();
  });
  it('shows the selected route with its actual delay and only its own reports, on the same map projection', () => {
    const route = projectCommute(config, raw, states, registry, now);
    expect(route.durationMinutes).toBe(37); expect(route.delayMinutes).toBe(12);
    expect(route.reports.map((r: { title: string }) => r.title)).toEqual(['A3: congestion']);
    expect(route.reports[0].point).toEqual(route.line[1]);
    expect(route.sections[0].points[0]).toEqual(route.line[1]);
    expect(route.sections[0].severe).toBe(true);
  });
  it('keeps traffic, road weather and cameras visible when they are reported together', () => {
    const extra = ['ice', 'fog', 'camera_fixed', 'camera_mobile'].map((type) => ({
      entity_id: `geo_location.work_${type}`, state: '1', attributes: { latitude: 50.95, longitude: 6.95, type, summary: type },
    }));
    const entries = extra.map(({ entity_id }) => ({ entity_id, config_entry_id: 'work', platform: 'tomtom' }));
    const route = projectCommute(config, raw, [...states, ...extra], [...registry, ...entries], now);
    expect(route.cameraCount).toBe(2);
    expect(route.reports.map(({ category, group }: { category: string; group: string }) => [category, group])).toEqual([
      ['jam', 'traffic'], ['ice', 'weather'], ['fog', 'weather'], ['camera_fixed', 'camera'], ['camera_mobile', 'camera'],
    ]);
    expect(route).not.toHaveProperty('parking');
  });
  it('never presents an old route, an unavailable source or a missing duration as live', () => {
    expect(projectCommute(config, raw, states, registry, now + 31 * 60_000)).toBeNull();
    expect(projectCommute(config, { ...raw, duration: null }, states, registry, now)).toBeNull();
    expect(projectCommute(config, raw, states.map((s) => ({ ...s, state: 'unavailable' })), registry, now)).toBeNull();
    expect(projectCommute(config, { ...raw, points: [[NaN, 1], [2, 3]] }, states, registry, now)).toBeNull();
    expect(freshCommute({ updatedAt: new Date(now).toISOString() } as CommuteRoute, new Date(now + 31 * 60_000))).toBe(false);
  });
  it('calculates 07:23 departure for 37 minutes and 08:00 arrival, without adding delay a second time', () => {
    const morning = new Date(2026, 10, 16, 7, 18);
    const departure = departureFor(config, 37, morning);
    expect(departure.at.getHours()).toBe(7); expect(departure.at.getMinutes()).toBe(23); expect(departure.minutes).toBe(5);
    expect(inCommuteWindow(config, morning)).toBe(true);
    expect(inCommuteWindow(config, new Date(2026, 10, 15, 7, 18))).toBe(false);
    expect(inCommuteWindow(config, new Date(2026, 10, 16, 9, 0))).toBe(false);
    expect(inCommuteWindow({ ...config, days: [1], from: '23:00', until: '02:00' }, new Date(2026, 10, 17, 1))).toBe(true);
  });
  it('applies an arrival exception to one office day and uses weekday times thereafter', () => {
    const schedule = { ...config, days: [1, 3], arrivals: { 1: '08:30', 3: '09:30' }, nextArrival: { date: '2026-11-16', time: '10:00' } };
    expect(parseCommuteConfig(schedule)).toMatchObject({ arrivals: schedule.arrivals, nextArrival: schedule.nextArrival });
    const monday = departureFor(schedule, 30, new Date(2026, 10, 16, 7));
    expect(monday.arrival).toBe('10:00');
    expect(monday.at).toEqual(new Date(2026, 10, 16, 9, 30));
    const wednesday = departureFor(schedule, 30, new Date(2026, 10, 16, 11));
    expect(wednesday.at).toEqual(new Date(2026, 10, 18, 9));
    expect(departureFor(schedule, 30, new Date(2026, 10, 23, 7)).arrival).toBe('08:30');
    const overnight = { ...schedule, from: '23:00', until: '02:00', nextArrival: { date: '2026-11-16', time: '01:30' } };
    expect(departureFor(overnight, 30, new Date(2026, 10, 17, 0, 30)).at).toEqual(new Date(2026, 10, 17, 1));
  });
  it('uses the forecast location offset and hides stale rain information', () => {
    const forecast = { updatedAt: new Date(now).toISOString(), current: { rain: 0 }, utc_offset_seconds: 3600,
      minutely_15: { time: ['2026-11-16T07:15', '2026-11-16T07:45'], rain: [0, .4] } };
    expect(rainStart(forecast, now)).toBe('2026-11-16T06:30:00.000Z');
    expect(rainStart(forecast, now + 31 * 60_000)).toBeNull();
  });
  it('discovers HA routes and reads their geometry via TomTom without fetching traffic itself', async () => {
    const ws = vi.fn(async (type: string) => type === 'config/entity_registry/list' ? registry : type === 'get_states' ? states : raw);
    const close = vi.fn();
    const service = createCommuteService({ configStore: { read: () => ({ 'hmi:commute:v1': JSON.stringify(config) }) },
      resolveCredentials: () => ({}), clientFactory: () => ({ ws, close }),
      now: () => now, fetchImpl: async () => ({ ok: false }) });
    expect((await service.options()).routes).toEqual([{ id: 'work', name: 'Work' }]);
    expect((await service.read()).route.durationMinutes).toBe(37);
    expect(ws).toHaveBeenCalledWith('tomtom/route', { config_entry_id: 'work' });
    expect(close).toHaveBeenCalled();
  });
  it('reports a TomTom name conflict before saving a new route', async () => {
    const update = vi.fn();
    const rest = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: { type: 'form', step_id: 'user', flow_id: 'pending' } })
      .mockResolvedValueOnce({ status: 200, body: { type: 'abort', reason: 'already_configured', flow_id: 'pending' } });
    const service = createCommuteService({ configStore: { update }, resolveCredentials: () => ({}),
      clientFactory: () => ({ rest, close: vi.fn() }) });
    const request = Object.assign(Readable.from([JSON.stringify({
      config: DEFAULT_COMMUTE, name: 'Arbeitsweg',
      start: { label: 'Home', latitude: 50.9, longitude: 6.8 },
      destination: { label: 'Office', latitude: 51, longitude: 7.1 },
    })]), { method: 'PUT', url: '/api/admin/commute/route', headers: {}, rawHeaders: ['Content-Type', 'application/json'] });
    const response = { writeHead: vi.fn(), end: vi.fn() };

    await service.serve(request, response, new Set());

    expect(response.writeHead).toHaveBeenCalledWith(409, expect.any(Object));
    expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({ code: 'COMMUTE_ROUTE_NAME_TAKEN' });
    expect(rest).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });
  it.each(['ready', 'unavailable'])('reports a loading background map until it is %s', async (result) => {
    let finishMap!: (response: Response) => void;
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishMap = resolve; }))
      .mockResolvedValue({ ok: false });
    const ws = vi.fn(async (type: string) => type === 'config/entity_registry/list' ? registry : type === 'get_states' ? states : raw);
    const service = createCommuteService({ configStore: { read: () => ({ 'hmi:commute:v1': JSON.stringify(config) }) },
      resolveCredentials: () => ({}), clientFactory: () => ({ ws, close: vi.fn() }), now: () => now, fetchImpl });

    const first = (await service.read()).route;
    expect(first).toMatchObject({ mapStatus: 'loading', roads: [], durationMinutes: 37 });
    expect(first.line.length).toBeGreaterThan(1);
    finishMap(result === 'ready' ? Response.json({ elements: [{
      type: 'way', tags: { highway: 'primary' }, geometry: raw.points.map(([lat, lon]) => ({ lat, lon })),
    }] }) : new Response(null, { status: 503 }));

    await vi.waitFor(async () => {
      const { route } = await service.read();
      expect(route.mapStatus).toBe(result);
      expect(route.roads.length).toBe(result === 'ready' ? 1 : 0);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(result === 'ready' ? 1 : 2);
    expect(ws.mock.calls.filter(([type]) => type === 'tomtom/route')).toHaveLength(1);
  });
  it('loads and clips streets and water using the wider bounds requested by the screen', async () => {
    const bounds = { minX: -512, minY: -512, maxX: 1536, maxY: 1024 };
    const geometry = commuteGeometry(raw);
    const toOsm = (x: number, y: number) => {
      const [, lon, lat] = geometry.geographicBounds({ minX: x, maxX: x, minY: y, maxY: y });
      return { lat, lon };
    };
    const fetchImpl = vi.fn(async (_url: string, _init: { body: URLSearchParams }) => Response.json({ elements: [
      { type: 'way', tags: { highway: 'primary' }, geometry: [toOsm(-768, -250), toOsm(-200, -250)] },
      { type: 'way', tags: { natural: 'water' }, geometry: [toOsm(-640, -450), toOsm(-350, -450), toOsm(-350, -300), toOsm(-640, -300), toOsm(-640, -450)] },
    ] }));
    const ws = vi.fn(async (type: string) => type === 'config/entity_registry/list' ? registry : type === 'get_states' ? states : raw);
    const service = createCommuteService({ configStore: { read: () => ({ 'hmi:commute:v1': JSON.stringify(config) }) },
      resolveCredentials: () => ({}), clientFactory: () => ({ ws, close: vi.fn() }), now: () => now, fetchImpl });
    async function read(mapBounds: string) {
      const response = { writeHead: vi.fn(), end: vi.fn() };
      await service.serve({ method: 'GET', url: `/api/commute?mapBounds=${mapBounds}`, headers: {} }, response, new Set());
      expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      return JSON.parse(response.end.mock.calls[0][0]).route;
    }

    expect(await read('route')).toMatchObject({ roads: [], durationMinutes: 37 });
    expect(await read('-8448,-512,1536,1024')).toMatchObject({ mapStatus: 'too-large', durationMinutes: 37 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      const route = await read('-512,-512,1536,1024');
      expect(route.mapStatus).toBe('ready');
      expect(route.roads).toEqual([[[-512, -250], [-200, -250]]]);
      expect(route.areas[0].rings[0]).toContainEqual([-512, -450]);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].body.get('data')).toContain(geometry.geographicBounds(bounds).join(','));
  });
  it.each(['direct', 'supervisor'])('loads settings and live traffic above 1 MiB through the real %s client', async (mode) => {
    const largeStates = [...states, ...Array.from({ length: 2500 }, (_, index) => ({
      entity_id: `sensor.fixture_${index}`, state: '0', attributes: { details: 'x'.repeat(500) },
    }))];
    expect(new TextEncoder().encode(JSON.stringify(largeStates)).length).toBeGreaterThan(1024 * 1024);
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const socketPath = mode === 'supervisor' ? '/core/websocket' : '/api/websocket';
    let installed = true;
    const paths: string[] = [];
    server.on('connection', (socket: any, request: { url: string }) => {
      paths.push(request.url);
      socket.send(JSON.stringify({ type: 'auth_required' }));
      socket.on('message', (data: { toString(): string }) => {
        const frame = JSON.parse(data.toString());
        if (frame.type === 'auth') { socket.send(JSON.stringify({ type: 'auth_ok' })); return; }
        const result = frame.type === 'get_states' ? (installed ? largeStates : largeStates.slice(states.length))
          : frame.type === 'config/entity_registry/list' ? (installed ? registry : []) : raw;
        socket.send(JSON.stringify({ id: frame.id, type: 'result', success: true, result }));
      });
    });
    const rest = vi.fn(() => { throw new Error('State discovery must not use REST'); });
    const service = createCommuteService({
      configStore: { read: () => ({ 'hmi:commute:v1': JSON.stringify(config) }) },
      resolveCredentials: () => ({ baseUrl, token: 'fixture', ...(mode === 'supervisor' ? { websocketUrl: baseUrl.replace('http:', 'ws:') + socketPath } : {}) }),
      clientFactory: (options: object) => createLaundryHomeAssistantClient({ ...options, fetchImpl: rest }),
      now: () => now, fetchImpl: async () => ({ ok: false }),
    });
    try {
      let status = 0;
      let body = '';
      await service.serve({ method: 'GET', url: '/api/admin/commute', headers: {} }, {
        writeHead: (value: number) => { status = value; }, end: (value: string) => { body = value; },
      }, new Set());
      expect(status).toBe(200);
      expect(JSON.parse(body).routes).toEqual([{ id: 'work', name: 'Work' }]);
      expect(JSON.parse(body)).not.toHaveProperty('parking');
      expect((await service.read()).route.durationMinutes).toBe(37);
      installed = false;
      expect((await service.options()).routes).toEqual([]);
      expect(rest).not.toHaveBeenCalled();
      expect(paths.every((path) => path === socketPath)).toBe(true);
    } finally {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });
});
