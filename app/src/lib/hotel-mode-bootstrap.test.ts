import { describe, expect, it, vi } from 'vitest';
import neutralApartment from '../../config/examples/neutral-apartment.json';
import { compileHouseholdConfig, parseHouseholdConfig } from './config/household-config.ts';
import {
  HOTEL_ENABLED_KEY,
  HOTEL_SESSION_ENDPOINT,
  HOTEL_STATUS_ENDPOINT,
  decideHotelSurface,
  resolveHotelBootstrap,
  restrictHouseholdModelForGuest,
} from './hotel-mode-bootstrap.ts';

/* Geprüft wird die Zustandsentscheidung vor dem Appstart und die Verengung des
   Haushaltsmodells: was ein Gast überhaupt geladen bekommt und was schon vor
   dem ersten Import wegfällt. */

const ACTIVE_STATUS = {
  enabled: true,
  status: 'active',
  checkoutEnabled: true,
  stay: { id: 'stay-a', checkIn: 1, checkOut: 2, welcomeMessage: 'Willkommen!' },
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
  };
}

function stubbedFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    impl: (async (url: string) => {
      calls.push(url);
      const payload = routes[url];
      if (payload instanceof Error) throw payload;
      if (payload === undefined) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => payload };
    }) as unknown as typeof fetch,
  };
}

function guestModel() {
  const parsed = parseHouseholdConfig({ ...neutralApartment });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return compileHouseholdConfig(parsed.value);
}

describe('decideHotelSurface', () => {
  it('lässt einen deaktivierten Hotel Mode unverändert durch', () => {
    for (const status of [null, {}, { enabled: false, status: 'active' }, 'nope', []]) {
      expect(decideHotelSurface(status, { unlocked: true }).surface).toBe('disabled');
    }
  });

  it('gewinnt mit einer offenen Adminsitzung über den Gastzustand', () => {
    expect(decideHotelSurface(ACTIVE_STATUS, { configured: true, unlocked: true }))
      .toEqual({ surface: 'admin', stayId: null, welcomeMessage: null, checkoutEnabled: false });
  });

  it('bleibt ohne laufenden Aufenthalt neutral', () => {
    expect(decideHotelSurface({ enabled: true, status: 'inactive', stay: null }, { unlocked: false }))
      .toEqual({ surface: 'inactive', stayId: null, welcomeMessage: null, checkoutEnabled: false });
    // Ein Kalenderkonflikt liefert serverseitig 'inactive'; alles Unbekannte
    // wird hier ebenfalls neutral behandelt.
    expect(decideHotelSurface({ enabled: true, status: 'unklar' }, null).surface).toBe('inactive');
  });

  it('übernimmt Aufenthalt und Willkommensnachricht nur im aktiven Zustand', () => {
    expect(decideHotelSurface(ACTIVE_STATUS, { unlocked: false }))
      .toEqual({ surface: 'active', stayId: 'stay-a', welcomeMessage: 'Willkommen!', checkoutEnabled: true });
    expect(decideHotelSurface({ enabled: true, status: 'active', stay: { id: 7 } }, null))
      .toEqual({ surface: 'active', stayId: null, welcomeMessage: null, checkoutEnabled: false });
  });
});

describe('resolveHotelBootstrap', () => {
  it('fragt die Sitzung gar nicht erst ab, wenn Hotel Mode aus ist', async () => {
    const { calls, impl } = stubbedFetch({ [HOTEL_STATUS_ENDPOINT]: { enabled: false, status: 'inactive' } });
    const storage = memoryStorage();

    expect((await resolveHotelBootstrap({ fetchImpl: impl, storage })).surface).toBe('disabled');
    expect(calls).toEqual([HOTEL_STATUS_ENDPOINT]);
    expect(storage.values[HOTEL_ENABLED_KEY]).toBe('disabled');
  });

  it('merkt sich die Einrichtung und liest danach beide Endpunkte', async () => {
    const { calls, impl } = stubbedFetch({
      [HOTEL_STATUS_ENDPOINT]: ACTIVE_STATUS,
      [HOTEL_SESSION_ENDPOINT]: { configured: true, unlocked: false },
    });
    const storage = memoryStorage();

    expect((await resolveHotelBootstrap({ fetchImpl: impl, storage })).surface).toBe('active');
    expect(calls).toEqual([HOTEL_STATUS_ENDPOINT, HOTEL_SESSION_ENDPOINT]);
    expect(storage.values[HOTEL_ENABLED_KEY]).toBe('enabled');
  });

  it('fällt bei einem abgerissenen Statusabruf auf die bekannte Einrichtung zurück', async () => {
    const { impl } = stubbedFetch({ [HOTEL_STATUS_ENDPOINT]: new Error('offline') });

    expect((await resolveHotelBootstrap({
      fetchImpl: impl, storage: memoryStorage({ [HOTEL_ENABLED_KEY]: 'enabled' }),
    })).surface).toBe('inactive');
    expect((await resolveHotelBootstrap({ fetchImpl: impl, storage: memoryStorage() })).surface)
      .toBe('disabled');
  });

  it('bleibt neutral, wenn nur der Sitzungsabruf scheitert', async () => {
    const { impl } = stubbedFetch({
      [HOTEL_STATUS_ENDPOINT]: { enabled: true, status: 'inactive', stay: null },
      [HOTEL_SESSION_ENDPOINT]: new Error('offline'),
    });

    expect((await resolveHotelBootstrap({ fetchImpl: impl, storage: memoryStorage() })).surface)
      .toBe('inactive');
  });

  it('liest keinen localStorage-Eintrag außer der Einrichtungsnotiz', async () => {
    const getItem = vi.fn(() => null);
    const { impl } = stubbedFetch({ [HOTEL_STATUS_ENDPOINT]: { enabled: false } });

    await resolveHotelBootstrap({ fetchImpl: impl, storage: { getItem, setItem: vi.fn() } });
    expect(getItem.mock.calls.flat()).not.toContain('hmi:ha-token');
  });
});

describe('restrictHouseholdModelForGuest', () => {
  const access = [{ roomId: 'living', entityIds: ['light.living_ceiling', 'climate.living'] }];

  it('behält nur freigegebene Räume und deren freigegebene Entities', () => {
    const guest = restrictHouseholdModelForGuest(guestModel(), access);

    expect(guest.rooms.map((room) => room.id)).toEqual(['living']);
    expect(guest.rooms[0].visibleEntities.map((entity) => entity.entityId).sort())
      .toEqual(['climate.living', 'light.living_ceiling']);
    expect(guest.subscriptionEntityIds).toEqual(['climate.living', 'light.living_ceiling']);
    expect(guest.entityIds).toEqual(guest.subscriptionEntityIds);
  });

  it('lässt genau ein Navigationsziel übrig und keine leeren Tabs', () => {
    const guest = restrictHouseholdModelForGuest(guestModel(), access);

    expect(guest.enabledModules).toEqual(['home']);
    expect(guest.navigation).toEqual([expect.objectContaining({ order: 0, target: { type: 'module', id: 'home' } })]);
  });

  it('entfernt Energie, Medien und die globalen Betreiber-Entities', () => {
    const guest = restrictHouseholdModelForGuest(guestModel(), access);

    expect(guest.energy).toBeNull();
    expect(guest.mediaTargets).toEqual([]);
    expect(guest.globalEntities).toEqual({
      sun: null, vacationMode: null, homeOffScript: null, laundry: { washer: null, dryer: null },
    });
  });

  it('lässt ohne Freigabe nichts übrig und wirft nicht', () => {
    const guest = restrictHouseholdModelForGuest(guestModel(), []);

    expect(guest.rooms).toEqual([]);
    expect(guest.subscriptionEntityIds).toEqual([]);
    expect(guest.navigation.length).toBe(1);
  });

  it('ignoriert einen Raum, dessen freigegebene Entities es gar nicht gibt', () => {
    const guest = restrictHouseholdModelForGuest(guestModel(), [
      { roomId: 'living', entityIds: ['light.does_not_exist'] },
      { roomId: 'kein_raum', entityIds: ['light.living_ceiling'] },
    ]);

    expect(guest.rooms).toEqual([]);
  });

  it('bleibt eine gültige Projektion für die produktive Shell', async () => {
    const { projectActiveHouseholdData } = await import('./config/household-runtime-data.ts');
    const projected = projectActiveHouseholdData(restrictHouseholdModelForGuest(guestModel(), access));

    expect(projected.ROOM_SEED.map((room) => room.id)).toEqual(['living']);
    expect(projected.NAV_TABS.map((tab) => tab.id)).toEqual(['home']);
    expect(projected.MEDIA_SEED).toEqual([]);
    expect(projected.SUN_ENTITY).toBeNull();
  });
});
