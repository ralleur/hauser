import { afterEach, describe, expect, it, vi } from 'vitest';

/* Der Gastpfad hat keinen HA-Zugang: er kennt nur die Serverprojektion. Geprüft
   wird deshalb die Grenze — was ankommt, was fail-closed verworfen wird und was
   der Client von sich aus gerade NICHT tut (Token lesen, Sitzung mitschicken). */

async function freshStore() {
  vi.resetModules();
  return await import('./hotel-entities.svelte.ts');
}

function activeProjection(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    status: 'active',
    rooms: [{
      roomId: 'living',
      entities: [
        { entityId: 'light.living_ceiling', actions: ['turn_on', 'turn_off'], temperatureRange: null },
        { entityId: 'climate.living', actions: ['set_temperature'], temperatureRange: { min: 18, max: 24 } },
      ],
    }],
    scenes: ['scene.apartment_evening'],
    scripts: [],
    entities: [
      { entityId: 'light.living_ceiling', state: 'on', attributes: { brightness: 128, color_mode: 'color_temp', color_temp_kelvin: 2700 } },
      { entityId: 'climate.living', state: 'heat', attributes: { temperature: 21, current_temperature: 20.5 } },
    ],
    fetchedAt: 1_800_000_000_000,
    error: null,
    ...overrides,
  };
}

const NEUTRAL_RESPONSE = {
  enabled: true, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null,
};

function stubFetch(payloads: unknown[]) {
  const calls: { url: string; init: any }[] = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const payload = payloads[Math.min(calls.length - 1, payloads.length - 1)];
    if (payload instanceof Error) throw payload;
    return { ok: true, json: async () => payload };
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Gast-Entity-Store', () => {
  it('übernimmt die Serverprojektion und übersetzt sie in die bekannten Control-Werte', async () => {
    stubFetch([activeProjection()]);
    const store = await freshStore();

    await store.refreshHotelGuestEntities();

    expect(store.hotelGuest.status).toBe('active');
    expect(store.hotelGuest.rooms[0].entities[1].temperatureRange).toEqual({ min: 18, max: 24 });
    expect(store.hotelEntityValue('light.living_ceiling')).toEqual({ on: true, brightness: 50, colorTemp: 2700, color: null });
    expect(store.hotelEntityValue('climate.living')).toEqual({ target: 21, hvac: 'heat', current: 20.5 });
  });

  it('fragt anonym und ohne gespeicherten Token ab', async () => {
    const calls = stubFetch([activeProjection()]);
    const getItem = vi.fn(() => 'ha-token');
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn(), removeItem: vi.fn() });
    const store = await freshStore();

    await store.refreshHotelGuestEntities();

    expect(getItem).not.toHaveBeenCalled();
    expect(calls[0].url).toBe('/api/hotel-mode/entities');
    expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.headers).toBeUndefined();
  });

  it('räumt die Steuerdaten sofort ab, sobald der Server neutral antwortet', async () => {
    stubFetch([activeProjection(), NEUTRAL_RESPONSE]);
    const store = await freshStore();

    await store.refreshHotelGuestEntities();
    expect(store.hotelEntityIds().length).toBe(2);

    await store.refreshHotelGuestEntities();
    expect(store.hotelGuest.status).toBe('inactive');
    expect(store.hotelGuest.entities).toEqual([]);
    expect(store.hotelGuest.rooms).toEqual([]);
    expect(store.hotelEntityValue('light.living_ceiling')).toBeUndefined();
  });

  it('verwirft eine unlesbare Antwort fail-closed', async () => {
    const store = await freshStore();

    for (const payload of [null, 'nope', [], { status: 'active' }, { enabled: true, status: 'sometimes' }]) {
      expect(store.parseHotelGuestProjection(payload).entities).toEqual([]);
      expect(store.parseHotelGuestProjection(payload).status).toBe('inactive');
    }
    expect(store.parseHotelGuestProjection(activeProjection({ entities: [{ entityId: 42 }, { state: 'on' }] })).entities)
      .toEqual([]);
  });

  it('hält den letzten bekannten Zustand, wenn der Server nicht antwortet', async () => {
    stubFetch([activeProjection(), new Error('offline')]);
    const store = await freshStore();

    await store.refreshHotelGuestEntities();
    await store.refreshHotelGuestEntities();

    expect(store.hotelGuest.error).toBe('HOTEL_ENTITIES_UNREACHABLE');
    expect(store.hotelGuest.status).toBe('active');
    expect(store.hotelEntityValue('light.living_ceiling')).toEqual({ on: true, brightness: 50, colorTemp: 2700, color: null });
  });

  it('pollt bis zum Stopp und danach nicht weiter', async () => {
    vi.useFakeTimers();
    const calls = stubFetch([activeProjection()]);
    const store = await freshStore();

    const stop = store.startHotelGuestEntities(5000);
    expect(calls.length).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(3);

    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.length).toBe(3);
  });
});
