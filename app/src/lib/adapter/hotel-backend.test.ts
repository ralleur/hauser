import { afterEach, describe, expect, it, vi } from 'vitest';
import { HotelBackend, HOTEL_COMMAND_ENDPOINT } from './hotel-backend.ts';

/* Backend und Gast-Store müssen dieselbe Modulinstanz teilen; ein frischer
   Store verlangt deshalb auch ein frisch importiertes Backend. */
async function freshPair() {
  vi.resetModules();
  const store = await import('../state/hotel-entities.svelte.ts');
  const adapter = await import('./hotel-backend.ts');
  return { store, HotelBackend: adapter.HotelBackend };
}

/* Geprüft wird die Grenze des Gast-Backends: was es sendet, was es beim
   Fehlschlag NICHT tut (Retry, Erfolg melden) und dass es weder Domain noch
   Token aus dem Client bezieht. */

const PROJECTION = {
  enabled: true,
  status: 'active',
  rooms: [{ roomId: 'living', entities: [{ entityId: 'light.living_ceiling', actions: ['turn_on', 'turn_off'], temperatureRange: null }] }],
  scenes: [],
  scripts: [],
  entities: [{ entityId: 'light.living_ceiling', state: 'on', attributes: { brightness: 128 } }],
  fetchedAt: 1_800_000_000_000,
  error: null,
};

function neutral() {
  return { enabled: true, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null };
}

function commandFetch(responses: unknown[] = [{ ok: true, status: 200 }]) {
  const calls: { url: string; init: any }[] = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (response instanceof Error) throw response;
    return response;
  });
  return { calls, impl: impl as unknown as typeof fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HotelBackend', () => {
  it('schickt Entity und Aktion anonym an den Proxy — ohne Domain und ohne Token', async () => {
    const { calls, impl } = commandFetch();
    const getItem = vi.fn(() => 'ha-token');
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn(), removeItem: vi.fn() });
    const refresh = vi.fn();
    const backend = new HotelBackend({ fetchImpl: impl, refresh });

    backend.callService('light', 'turn_on', 'light.living_ceiling', { brightness_pct: 60 });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    expect(calls[0].url).toBe(HOTEL_COMMAND_ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('omit');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      entityId: 'light.living_ceiling', action: 'turn_on', data: { brightness_pct: 60 },
    });
    expect(JSON.parse(calls[0].init.body).domain).toBeUndefined();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('meldet einen abgelehnten Befehl als Fehler und sendet ihn nicht erneut', async () => {
    const { calls, impl } = commandFetch([{ ok: false, status: 403 }]);
    const refresh = vi.fn();
    const failed: string[] = [];
    const backend = new HotelBackend({ fetchImpl: impl, refresh });
    backend.onCommandError((entityId) => failed.push(entityId));

    backend.callService('light', 'turn_on', 'light.living_ceiling', {});
    await vi.waitFor(() => expect(failed).toEqual(['light.living_ceiling']));

    expect(calls.length).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('behandelt einen Netzwerkausfall genauso wie eine Ablehnung', async () => {
    const { impl } = commandFetch([new Error('offline')]);
    const failed: string[] = [];
    const backend = new HotelBackend({ fetchImpl: impl, refresh: vi.fn() });
    backend.onCommandError((entityId) => failed.push(entityId));

    backend.callService('climate', 'set_temperature', 'climate.living', { temperature: 21 });
    await vi.waitFor(() => expect(failed).toEqual(['climate.living']));
  });

  it('reicht die Serverprojektion als Entity-Updates weiter und meldet Rücknahmen', async () => {
    const { store, HotelBackend: Backend } = await freshPair();
    const { impl } = commandFetch();
    const backend = new Backend({ fetchImpl: impl, refresh: vi.fn() });
    const updates: [string, unknown][] = [];
    backend.subscribe((entityId, value) => updates.push([entityId, value]));

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => PROJECTION })));
    await store.refreshHotelGuestEntities();
    expect(updates).toEqual([['light.living_ceiling', { on: true, brightness: 50 }]]);

    // Ein unveränderter Poll darf keinen laufenden Intent anfassen.
    await store.refreshHotelGuestEntities();
    expect(updates.length).toBe(1);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => neutral() })));
    await store.refreshHotelGuestEntities();
    expect(updates[1]).toEqual(['light.living_ceiling', undefined]);
  });

  it('meldet den Verbindungszustand aus dem Gast-Store', async () => {
    const { store, HotelBackend: Backend } = await freshPair();
    const { impl } = commandFetch();
    const backend = new Backend({ fetchImpl: impl, refresh: vi.fn() });
    const states: string[] = [];
    backend.onConnectionChange((status) => states.push(status));
    expect(states).toEqual(['connected']);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await store.refreshHotelGuestEntities();
    expect(states).toEqual(['connected', 'disconnected']);

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => PROJECTION })));
    await store.refreshHotelGuestEntities();
    expect(states).toEqual(['connected', 'disconnected', 'connected']);
  });

  it('startet das Polling erst mit start() und stoppt es wieder', async () => {
    const stop = vi.fn();
    const startPolling = vi.fn(() => stop);
    const backend = new HotelBackend({ fetchImpl: commandFetch().impl, startPolling, refresh: vi.fn() });

    expect(startPolling).not.toHaveBeenCalled();
    backend.start();
    backend.start();
    expect(startPolling).toHaveBeenCalledTimes(1);

    backend.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
