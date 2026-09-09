import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { createAppCommandService } from '../../server/app-commands.mjs';

describe('REST-Zugang für Widgets', () => {
  it('ruft den HA-Service mit entity_id und Daten auf', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const service = createAppCommandService({
      resolveAccess: () => ({ baseUrl: 'http://ha.local:8123/', token: 'T' }),
      fetchImpl: async (url: string, init: RequestInit) => { calls.push({ url, init }); return { ok: true, json: async () => [] }; },
    });
    await service.command({ domain: 'light', service: 'turn_on', entityId: 'light.flur', data: { brightness_pct: 40 } });
    expect(calls[0].url).toBe('http://ha.local:8123/api/services/light/turn_on');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ entity_id: 'light.flur', brightness_pct: 40 });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer T');
  });

  it('weist ungültige Befehle ab und meldet fehlenden HA-Zugang', async () => {
    const service = createAppCommandService({ resolveAccess: () => null, fetchImpl: async () => ({ ok: true, json: async () => [] }) });
    await expect(service.command({ domain: 'light', service: 'turn_on; rm', entityId: 'light.flur', data: {} })).rejects.toMatchObject({ code: 'COMMAND_INVALID' });
    await expect(service.command({ domain: 'light', service: 'turn_on', entityId: 'light.flur', data: {} })).rejects.toMatchObject({ code: 'HA_UNAVAILABLE' });
  });

  it('listet Bewohner aus person.*', async () => {
    const service = createAppCommandService({
      resolveAccess: () => ({ baseUrl: 'http://ha.local:8123', token: 'T' }),
      fetchImpl: async () => ({ ok: true, json: async () => [
        { entity_id: 'person.sam', state: 'home', attributes: { friendly_name: 'Sam' } },
        { entity_id: 'light.flur', state: 'on', attributes: {} },
      ] }),
    });
    expect(await service.persons()).toEqual([{ entityId: 'person.sam', name: 'Sam', state: 'home' }]);
  });

  it('liest nur die gewünschten Zustände und markiert Unbekanntes', async () => {
    const service = createAppCommandService({
      resolveAccess: () => ({ baseUrl: 'http://ha.local:8123', token: 'T' }),
      fetchImpl: async () => ({ ok: true, json: async () => [
        { entity_id: 'light.flur', state: 'on', attributes: { brightness: 128 }, last_changed: '2026-09-08T10:00:00Z' },
        { entity_id: 'light.bad', state: 'off', attributes: {} },
      ] }),
    });
    const states = await service.states(['light.flur', 'light.nix', 'kaputt']);
    expect(states).toEqual([
      { entityId: 'light.flur', state: 'on', attributes: { brightness: 128 }, changedAt: '2026-09-08T10:00:00Z' },
      { entityId: 'light.nix', state: null, attributes: {}, changedAt: null },
    ]);
  });
});
