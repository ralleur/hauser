// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Server modules run in Node without app declarations.
import { createCommuteService, DEFAULT_COMMUTE, parseCommuteConfig, projectCommute, rainStart } from '../../server/commute.mjs';
// @ts-expect-error Native Node server module.
import { createLaundryHomeAssistantClient } from '../../server/laundry.mjs';
// @ts-expect-error Native Node test without @types/node.
import { WebSocketServer } from 'ws';
import { departureFor, inCommuteWindow, freshCommute, type CommuteConfig, type CommuteRoute } from './state/commute.ts';

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
  it('keeps older settings and validates active office days and the display window', () => {
    const { showRain: _rain, ...older } = config;
    expect(parseCommuteConfig(older).showRain).toBe(true);
    expect(parseCommuteConfig({ ...config, showRain: false }).showRain).toBe(false);
    expect(parseCommuteConfig({ ...config, days: [] })).toBeNull();
    expect(parseCommuteConfig({ ...config, until: config.from })).toBeNull();
    expect(parseCommuteConfig({ ...config, entryId: '', days: [] })).not.toBeNull();
  });
  it('shows the selected route with its actual delay and only its own reports, on the same map projection', () => {
    const route = projectCommute(config, raw, states, registry, now);
    expect(route.durationMinutes).toBe(37); expect(route.delayMinutes).toBe(12);
    expect(route.reports.map((r: { title: string }) => r.title)).toEqual(['A3: congestion']);
    expect(route.reports[0].point).toEqual(route.line[1]);
    expect(route.sections[0].points[0]).toEqual(route.line[1]);
    expect(route.sections[0].severe).toBe(true);
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
      expect(JSON.parse(body).parking).toHaveLength(2501);
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
