import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { createServer } from 'node:http';
// @ts-expect-error Native Node ESM Servermodul.
import { createAppCommandService, serveAppCommands } from '../../server/app-commands.mjs';

describe('REST-Zugang für Widgets', () => {
  it.each(['/api/app/states?ids=light.review', '/api/app/persons', '/api/app/todo', '/api/app/todo?entity=todo.review'])(
    'meldet einen Timeout im Antwortkörper als 503 HA_UNAVAILABLE: %s', async (url) => {
      const upstream = createServer((_req: unknown, res: any) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('['); // Header kommen an; der JSON-Rumpf bleibt unvollständig.
      });
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
      try {
        const address = upstream.address();
        if (!address || typeof address === 'string') throw new Error('Missing test port');
        const service = createAppCommandService({
          resolveAccess: () => ({ baseUrl: `http://127.0.0.1:${address.port}`, token: 'test-only' }), timeoutMs: 100,
        });
        let status = 0;
        let body: unknown;
        await serveAppCommands({ url, method: 'GET', hauserDevice: true }, {
          writeHead(code: number) { status = code; },
          end(value: string) { body = JSON.parse(value); },
        }, { service, allowedOrigins: new Set() });
        expect(status).toBe(503);
        expect(body).toMatchObject({ ok: false, code: 'HA_UNAVAILABLE' });
      } finally {
        upstream.closeAllConnections();
        await new Promise<void>((resolve, reject) => upstream.close((error?: Error) => error ? reject(error) : resolve()));
      }
    },
  );

  it('unterscheidet ungültiges JSON von einem Verbindungsabbruch beim Lesen', async () => {
    const answer = (error: Error) => createAppCommandService({
      resolveAccess: () => ({ baseUrl: 'http://ha.local', token: 'test-only' }),
      fetchImpl: async () => ({ ok: true, json: async () => { throw error; } }),
    });
    await expect(answer(new SyntaxError('Invalid JSON')).persons()).rejects.toMatchObject({ code: 'HA_ERROR', status: 502 });
    await expect(answer(new TypeError('terminated')).persons()).rejects.toMatchObject({ code: 'HA_UNAVAILABLE', status: 503 });
  });

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

  it('ordnet HAs Antwort ein: überlastet ist ein Zustand, abgelehnt trägt den Grund (Stresshaus #23)', async () => {
    const answer = (status: number, message = '') => createAppCommandService({
      resolveAccess: () => ({ baseUrl: 'http://ha.local:8123', token: 'T' }),
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ message }) }),
    });
    const cmd = { domain: 'climate', service: 'set_temperature', entityId: 'climate.bad', data: { temperature: 99 } };
    await expect(answer(503, 'Unruhe').command(cmd)).rejects.toMatchObject({ code: 'HA_UNAVAILABLE', status: 503 });
    await expect(answer(400, 'Temperatur außerhalb des Bereichs').command(cmd)).rejects.toMatchObject({ code: 'HA_REJECTED', status: 422, message: 'Temperatur außerhalb des Bereichs' });
    await expect(answer(500, 'kaputt').command(cmd)).rejects.toMatchObject({ code: 'HA_ERROR', status: 502 });
    const offline = createAppCommandService({ resolveAccess: () => ({ baseUrl: 'http://ha.local', token: 'T' }), fetchImpl: async () => { throw new Error('timeout'); } });
    await expect(offline.command(cmd)).rejects.toMatchObject({ code: 'HA_UNAVAILABLE' });
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
