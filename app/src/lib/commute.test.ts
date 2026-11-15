// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Server modules run in Node without app declarations.
import { createCommuteService, DEFAULT_COMMUTE, parseCommuteConfig, projectCommute, rainStart } from '../../server/commute.mjs';
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
    const ws = vi.fn(async (type: string) => type === 'config/entity_registry/list' ? registry : raw);
    const close = vi.fn();
    const service = createCommuteService({ configStore: { read: () => ({ 'hmi:commute:v1': JSON.stringify(config) }) },
      resolveCredentials: () => ({}), clientFactory: () => ({ ws, close, rest: async () => ({ status: 200, body: states }) }),
      now: () => now, fetchImpl: async () => ({ ok: false }) });
    expect((await service.options()).routes).toEqual([{ id: 'work', name: 'Work' }]);
    expect((await service.read()).route.durationMinutes).toBe(37);
    expect(ws).toHaveBeenCalledWith('tomtom/route', { config_entry_id: 'work' });
    expect(close).toHaveBeenCalled();
  });
});
