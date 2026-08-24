import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import neutralApartment from '../../config/examples/neutral-apartment.json';
import neutralSmall from '../../config/examples/neutral-small.json';
// @ts-expect-error native .mjs runtime contract
import { createHmiServer, createHotelCommandClient, createHotelCommandService, createHotelGuestStateService, createHotelModeStayService, createHotelModeStore, createHotelStatesClient } from '../../server.mjs';

const servers: any[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Wednesday 2026-07-15, 12:00 UTC — inside the fixture stay below. */
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

const TIMED_EVENT = {
  uid: 'stay-a',
  summary: 'Familie Sommer',
  description: 'Willkommen im Apartment!',
  start: '2026-07-14T15:00:00+02:00',
  end: '2026-07-18T11:00:00+02:00',
};

const OVERLAPPING_EVENT = {
  uid: 'stay-b',
  summary: 'Doppelbuchung',
  description: null,
  start: '2026-07-15T10:00:00+02:00',
  end: '2026-07-20T11:00:00+02:00',
};

/** Home Assistant answers with far more than a guest control ever reads. */
const HA_STATES: Record<string, { state: string; attributes: Record<string, unknown> }> = {
  'light.living_ceiling': {
    state: 'on',
    attributes: {
      brightness: 128,
      color_mode: 'color_temp',
      color_temp_kelvin: 2700,
      friendly_name: 'Deckenlicht Wohnen',
      supported_features: 44,
      device_id: 'a1b2c3',
      context: { user_id: 'admin' },
    },
  },
  'climate.living': {
    state: 'heat',
    attributes: {
      temperature: 21,
      current_temperature: 20.5,
      hvac_modes: ['heat', 'cool', 'off'],
      friendly_name: 'Heizung Wohnen',
    },
  },
  'light.bath_mirror': { state: 'off', attributes: { friendly_name: 'Spiegellicht' } },
  'lock.front_door': { state: 'locked', attributes: { friendly_name: 'Haustür' } },
};

function policyFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...neutralApartment.hotelMode,
    enabled: true,
    kioskAcknowledged: true,
    ...overrides,
  };
}

function apartmentHousehold(overrides: Record<string, unknown> = {}) {
  return { ...neutralApartment, hotelMode: policyFixture(overrides) };
}

function fixture({
  events = [TIMED_EVENT] as unknown[],
  policy = policyFixture() as unknown,
  states = HA_STATES as Record<string, unknown>,
  credentials = { 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'fixture-token' } as Record<string, string>,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-proxy-'));
  roots.push(root);
  const store = createHotelModeStore(join(root, 'hotel-mode.json'));
  const state = {
    now: NOW,
    events,
    states,
    requested: [] as string[],
    failure: null as null | { ok: false; code: string },
  };
  const stays = createHotelModeStayService({
    store,
    configStore: { read: () => credentials },
    now: () => state.now,
    policyReader: () => policy,
    calendarClientFactory: () => ({ events: async () => ({ ok: true, events: state.events }) }),
  });
  const guests = createHotelGuestStateService({
    stays,
    configStore: { read: () => credentials },
    now: () => state.now,
    policyReader: () => policy,
    statesClientFactory: () => ({
      state: async (entityId: string) => {
        state.requested.push(entityId);
        if (state.failure) return state.failure;
        const raw = state.states[entityId];
        if (!raw) return { ok: true, entity: null };
        return { ok: true, entity: raw };
      },
    }),
  });
  return { guests, stays, state, store };
}

function entityMap(projection: any): Record<string, any> {
  return Object.fromEntries(projection.entities.map((entity: any) => [entity.entityId, entity]));
}

describe('Hotel-Mode-Gastprojektion', () => {
  it('liefert nur freigegebene Entities und nur die von den Controls gelesenen Attribute', async () => {
    const { guests, state } = fixture();

    const projection = await guests.read();
    expect(projection.status).toBe('active');
    expect(state.requested.sort()).toEqual(['climate.living', 'light.bath_mirror', 'light.living_ceiling']);

    const entities = entityMap(projection);
    expect(Object.keys(entities).sort()).toEqual(['climate.living', 'light.bath_mirror', 'light.living_ceiling']);
    expect(entities['light.living_ceiling']).toEqual({
      entityId: 'light.living_ceiling',
      state: 'on',
      attributes: { brightness: 128, color_mode: 'color_temp', color_temp_kelvin: 2700 },
    });
    expect(entities['climate.living'].attributes).toEqual({ temperature: 21, current_temperature: 20.5 });
    expect(JSON.stringify(projection)).not.toContain('friendly_name');
    expect(JSON.stringify(projection)).not.toContain('supported_features');
  });

  it('gibt die Raum- und Aktionsfreigabe unverändert aus der Policy weiter', async () => {
    const { guests } = fixture();

    const projection = await guests.read();
    expect(projection.rooms.map((room: any) => room.roomId)).toEqual(['living', 'bath']);
    expect(projection.rooms[0].entities).toEqual([
      { entityId: 'light.living_ceiling', actions: ['turn_on', 'turn_off'], temperatureRange: null },
      { entityId: 'climate.living', actions: ['set_temperature', 'set_hvac_mode'], temperatureRange: { min: 18, max: 24 } },
    ]);
    expect(projection.scenes).toEqual(['scene.apartment_evening']);
  });

  it('fragt nicht freigegebene Entities gar nicht erst ab', async () => {
    const { guests, state } = fixture();

    await guests.read();
    expect(state.requested).not.toContain('lock.front_door');
  });

  it('meldet fehlende Home-Assistant-Zugangsdaten, statt Geräte zu erfinden', async () => {
    // A manual override keeps the stay active even without Home Assistant, so
    // the missing credentials really reach the guest projection.
    const { guests, stays } = fixture({ credentials: {} });
    stays.setOverride({ startsAt: NOW - 1000, endsAt: NOW + 3600_000 });

    const projection = await guests.read();
    expect(projection.status).toBe('active');
    expect(projection.entities).toEqual([]);
    expect(projection.error).toBe('HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');
  });

  it('liefert vor dem Check-in und nach dem Check-out keine Steuerdaten', async () => {
    const { guests, state } = fixture();

    state.now = Date.UTC(2026, 6, 13, 12, 0, 0);
    const before = await guests.read();
    expect(before).toEqual({
      enabled: true, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null,
    });
    expect(state.requested).toEqual([]);

    state.now = Date.parse('2026-07-18T11:00:00+02:00');
    expect((await guests.read()).entities).toEqual([]);
  });

  it('liefert nach einem Gast-Checkout keine Steuerdaten mehr', async () => {
    const { guests, store, state } = fixture();
    const active = await guests.read();
    expect(active.entities.length).toBe(3);

    const stay = (await fixture().stays.resolve()).stay;
    store.update(() => ({ checkout: { stayId: stay.uid, checkedOutAt: state.now } }));
    state.now = NOW + 60_000;

    const after = await guests.read();
    expect(after.status).toBe('inactive');
    expect(after.entities).toEqual([]);
    expect(after.rooms).toEqual([]);
  });

  it('liefert bei einem widersprüchlichen Kalender keine Steuerdaten', async () => {
    const { guests } = fixture({ events: [TIMED_EVENT, OVERLAPPING_EVENT] });

    const projection = await guests.read();
    expect(projection.status).toBe('inactive');
    expect(projection.entities).toEqual([]);
  });

  it('liefert ohne Hotel-Policy nichts', async () => {
    const { guests, state } = fixture({ policy: null });

    const projection = await guests.read();
    expect(projection).toEqual({
      enabled: false, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null,
    });
    expect(state.requested).toEqual([]);
  });

  it('bündelt Gastabrufe kurz und liest Home Assistant erst danach erneut', async () => {
    const { guests, state } = fixture();

    await guests.read();
    await guests.read();
    expect(state.requested.length).toBe(3);

    state.now = NOW + 3000;
    await guests.read();
    expect(state.requested.length).toBe(6);
  });

  it('hält den zuletzt bekannten Zustand, wenn Home Assistant ausfällt', async () => {
    const { guests, state } = fixture();
    await guests.read();

    state.failure = { ok: false, code: 'HOTEL_STATES_UNREACHABLE' };
    state.now = NOW + 3000;
    const degraded = await guests.read();
    expect(degraded.error).toBe('HOTEL_STATES_UNREACHABLE');
    expect(degraded.entities.length).toBe(3);
    expect(degraded.fetchedAt).toBe(NOW);
  });

});

describe('Hotel-Mode-Zustandsclient', () => {
  function client(response: unknown, { throws = false } = {}) {
    const calls: string[] = [];
    const states = createHotelStatesClient({
      baseUrl: 'http://ha.fixture',
      token: 'fixture-token',
      fetchImpl: async (url: URL, init: any) => {
        calls.push(`${String(url)}|${init.headers.authorization}`);
        if (throws) throw new Error('offline');
        return response;
      },
    });
    return { calls, states };
  }

  function haResponse(status: number, body: unknown) {
    return { status, text: async () => JSON.stringify(body) };
  }

  it('liest genau eine Entity mit dem serverseitigen Token', async () => {
    const { calls, states } = client(haResponse(200, {
      entity_id: 'light.living_ceiling', state: 'on', attributes: { brightness: 10 },
    }));

    const result = await states.state('light.living_ceiling');
    expect(result).toEqual({ ok: true, entity: { state: 'on', attributes: { brightness: 10 } } });
    expect(calls).toEqual(['http://ha.fixture/api/states/light.living_ceiling|Bearer fixture-token']);
  });

  it('verwirft eine Antwort, die eine andere Entity trägt', async () => {
    const { states } = client(haResponse(200, { entity_id: 'lock.front_door', state: 'unlocked', attributes: {} }));

    expect(await states.state('light.living_ceiling')).toEqual({ ok: false, code: 'HOTEL_STATES_INVALID_RESPONSE' });
  });

  it('behandelt eine fehlende Entity als schlicht nicht vorhanden', async () => {
    const { states } = client(haResponse(404, { message: 'Entity not found.' }));

    expect(await states.state('light.living_ceiling')).toEqual({ ok: true, entity: null });
  });

  it('unterscheidet Auth-, HTTP- und Verbindungsfehler', async () => {
    expect(await client(haResponse(401, {})).states.state('light.living_ceiling'))
      .toEqual({ ok: false, code: 'HOTEL_STATES_AUTH_FAILED' });
    expect(await client(haResponse(500, {})).states.state('light.living_ceiling'))
      .toEqual({ ok: false, code: 'HOTEL_STATES_HTTP_ERROR' });
    expect(await client(null, { throws: true }).states.state('light.living_ceiling'))
      .toEqual({ ok: false, code: 'HOTEL_STATES_UNREACHABLE' });
  });

  it('lehnt eine übergroße Antwort ab, statt sie zu verarbeiten', async () => {
    const { states } = client({ status: 200, text: async () => 'x'.repeat(64 * 1024 + 1) });

    expect(await states.state('light.living_ceiling')).toEqual({ ok: false, code: 'HOTEL_STATES_INVALID_RESPONSE' });
  });
});

function serverFixture(household: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-proxy-http-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>fixture</title>');
  const configPath = join(root, 'config.json');
  const householdConfigPath = join(root, 'household.json');
  writeFileSync(configPath, JSON.stringify({ 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'fixture-token' }));
  writeFileSync(householdConfigPath, JSON.stringify(household));
  return { root, configPath, householdConfigPath, staticRoot };
}

async function start(household: unknown, options: Record<string, unknown> = {}) {
  const paths = serverFixture(household);
  const server = createHmiServer('', {
    ...paths,
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    allowedOrigins: new Set(['http://client.fixture']),
    paperlessPin: '',
    paperlessToken: '',
    hotelModeNow: () => NOW,
    hotelCalendarClientFactory: () => ({ events: async () => ({ ok: true, events: [TIMED_EVENT] }) }),
    hotelStatesClientFactory: () => ({
      state: async (entityId: string) => ({ ok: true, entity: HA_STATES[entityId] ?? null }),
    }),
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

describe('GET /api/hotel-mode/entities', () => {
  it('beantwortet den Gastpfad ohne Adminsitzung und ohne neues Cookie', async () => {
    const base = await start(apartmentHousehold());

    const response = await fetch(`${base}/api/hotel-mode/entities`, { headers: { origin: 'http://client.fixture' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    const body = await response.json();
    expect(body.status).toBe('active');
    expect(body.entities.map((entity: any) => entity.entityId).sort())
      .toEqual(['climate.living', 'light.bath_mirror', 'light.living_ceiling']);
    // No stay identity leaks through the control channel.
    expect(JSON.stringify(body)).not.toContain('Familie Sommer');
    expect(JSON.stringify(body)).not.toContain('Willkommen im Apartment');
  });

  it('bleibt bei deaktiviertem Hotel Mode vollständig neutral', async () => {
    const base = await start(neutralSmall);

    const body = await (await fetch(`${base}/api/hotel-mode/entities`, { headers: { origin: 'http://client.fixture' } })).json();
    expect(body).toEqual({
      enabled: false, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null,
    });
  });

  it('gibt die Route ohne erlaubte Herkunft nicht frei', async () => {
    const base = await start(apartmentHousehold());

    const response = await fetch(`${base}/api/hotel-mode/entities`, { headers: { origin: 'http://evil.fixture' } });
    expect(response.status).toBe(403);
  });
});

/* ── H05: der geprüfte Gast-Schreibpfad ── */

function commandFixture({
  policy = policyFixture() as unknown,
  credentials = { 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'fixture-token' } as Record<string, string>,
  failure = null as null | { ok: false; code: string },
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-command-'));
  roots.push(root);
  const store = createHotelModeStore(join(root, 'hotel-mode.json'));
  const state = { now: NOW, calls: [] as any[], invalidated: 0 };
  const stays = createHotelModeStayService({
    store,
    configStore: { read: () => credentials },
    now: () => state.now,
    policyReader: () => policy,
    calendarClientFactory: () => ({ events: async () => ({ ok: true, events: [TIMED_EVENT] }) }),
  });
  const commands = createHotelCommandService({
    stays,
    guests: { invalidate: () => { state.invalidated += 1; } },
    configStore: { read: () => credentials },
    policyReader: () => policy,
    commandClientFactory: () => ({
      call: async (domain: string, service: string, entityId: string, data: unknown) => {
        state.calls.push({ domain, service, entityId, data });
        return failure ?? { ok: true };
      },
    }),
  });
  return { commands, state, store, stays };
}

describe('Hotel-Mode-Gastbefehle', () => {
  it('führt einen freigegebenen Befehl mit neu aufgebauter Nutzlast aus', async () => {
    const { commands, state } = commandFixture();

    expect(await commands.execute({ entityId: 'light.living_ceiling', action: 'turn_on', data: { brightness_pct: 60 } }))
      .toEqual({ ok: true });
    expect(state.calls).toEqual([
      { domain: 'light', service: 'turn_on', entityId: 'light.living_ceiling', data: { brightness_pct: 60 } },
    ]);
    expect(state.invalidated).toBe(1);
  });

  it('nimmt die Domain aus der Entity-ID, nicht aus der Anfrage', async () => {
    const { commands, state } = commandFixture();

    await commands.execute({ entityId: 'climate.living', action: 'set_temperature', data: { temperature: 21 }, domain: 'light' } as any);
    expect(state.calls[0].domain).toBe('climate');
  });

  it('lehnt nicht freigegebene Entities, Aktionen und Werte ab', async () => {
    const { commands, state } = commandFixture();

    expect(await commands.execute({ entityId: 'lock.front_door', action: 'turn_on' }))
      .toEqual({ ok: false, status: 403, code: 'HOTEL_COMMAND_ENTITY_NOT_ALLOWED' });
    expect(await commands.execute({ entityId: 'light.living_ceiling', action: 'start' }))
      .toEqual({ ok: false, status: 403, code: 'HOTEL_COMMAND_ACTION_NOT_ALLOWED' });
    expect(await commands.execute({ entityId: 'climate.living', action: 'set_temperature', data: { temperature: 30 } }))
      .toEqual({ ok: false, status: 403, code: 'HOTEL_COMMAND_VALUE_NOT_ALLOWED' });
    expect(await commands.execute({ entityId: 'light.living_ceiling', action: 'turn_on', data: { transition: 5 } }))
      .toEqual({ ok: false, status: 403, code: 'HOTEL_COMMAND_VALUE_NOT_ALLOWED' });
    expect(state.calls).toEqual([]);
  });

  it('gibt Szenen nur ausdrücklich frei und leitet kein Skript weiter', async () => {
    const { commands, state } = commandFixture();

    expect(await commands.execute({ entityId: 'scene.apartment_evening', action: 'turn_on' })).toEqual({ ok: true });
    expect(await commands.execute({ entityId: 'script.open_gate', action: 'turn_on' }))
      .toEqual({ ok: false, status: 403, code: 'HOTEL_COMMAND_ENTITY_NOT_ALLOWED' });
    expect(state.calls.map((call: any) => call.entityId)).toEqual(['scene.apartment_evening']);
  });

  it('nimmt außerhalb eines Aufenthalts gar keinen Befehl an', async () => {
    const { commands, state } = commandFixture();
    state.now = Date.UTC(2026, 6, 13, 12, 0, 0);

    expect(await commands.execute({ entityId: 'light.living_ceiling', action: 'turn_on' }))
      .toEqual({ ok: false, status: 403, code: 'HOTEL_STAY_INACTIVE' });
    expect(state.calls).toEqual([]);
  });

  it('meldet einen fehlgeschlagenen Home-Assistant-Aufruf als Fehler', async () => {
    const { commands, state } = commandFixture({ failure: { ok: false, code: 'HOTEL_COMMAND_UNREACHABLE' } });

    expect(await commands.execute({ entityId: 'light.living_ceiling', action: 'turn_on' }))
      .toEqual({ ok: false, status: 502, code: 'HOTEL_COMMAND_UNREACHABLE' });
    expect(state.invalidated).toBe(0);
  });

  it('meldet fehlende Home-Assistant-Zugangsdaten, statt den Befehl zu schlucken', async () => {
    const { commands, stays } = commandFixture({ credentials: {} });
    stays.setOverride({ startsAt: NOW - 1000, endsAt: NOW + 3600_000 });

    expect(await commands.execute({ entityId: 'light.living_ceiling', action: 'turn_on' }))
      .toEqual({ ok: false, status: 503, code: 'HOTEL_HOME_ASSISTANT_NOT_CONFIGURED' });
  });

  it('bleibt ohne aktive Policy geschlossen', async () => {
    const { commands } = commandFixture({ policy: null });

    expect(await commands.execute({ entityId: 'light.living_ceiling', action: 'turn_on' }))
      .toEqual({ ok: false, status: 403, code: 'HOTEL_STAY_INACTIVE' });
  });
});

describe('Hotel-Mode-Befehlsclient', () => {
  function client(response: unknown, { throws = false } = {}) {
    const calls: any[] = [];
    const commands = createHotelCommandClient({
      baseUrl: 'http://ha.fixture',
      token: 'fixture-token',
      fetchImpl: async (url: URL, init: any) => {
        calls.push({ url: String(url), init });
        if (throws) throw new Error('offline');
        return response;
      },
    });
    return { calls, commands };
  }

  it('ruft genau einen Service mit dem serverseitigen Token auf', async () => {
    const { calls, commands } = client({ status: 200 });

    expect(await commands.call('light', 'turn_on', 'light.living_ceiling', { brightness_pct: 60 })).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://ha.fixture/api/services/light/turn_on');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.authorization).toBe('Bearer fixture-token');
    expect(JSON.parse(calls[0].init.body))
      .toEqual({ entity_id: 'light.living_ceiling', brightness_pct: 60 });
  });

  it('unterscheidet Auth-, HTTP- und Verbindungsfehler', async () => {
    expect(await client({ status: 401 }).commands.call('light', 'turn_on', 'light.a', {}))
      .toEqual({ ok: false, code: 'HOTEL_COMMAND_AUTH_FAILED' });
    expect(await client({ status: 500 }).commands.call('light', 'turn_on', 'light.a', {}))
      .toEqual({ ok: false, code: 'HOTEL_COMMAND_HTTP_ERROR' });
    expect(await client(null, { throws: true }).commands.call('light', 'turn_on', 'light.a', {}))
      .toEqual({ ok: false, code: 'HOTEL_COMMAND_UNREACHABLE' });
  });
});

describe('POST /api/hotel-mode/command', () => {
  async function post(base: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/hotel-mode/command`, {
      method: 'POST',
      headers: { origin: 'http://client.fixture', 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('führt einen freigegebenen Befehl ohne Adminsitzung aus', async () => {
    const calls: any[] = [];
    const base = await start(apartmentHousehold(), {
      hotelCommandClientFactory: () => ({
        call: async (domain: string, service: string, entityId: string, data: unknown) => {
          calls.push({ domain, service, entityId, data });
          return { ok: true };
        },
      }),
    });

    const response = await post(base, { entityId: 'light.living_ceiling', action: 'turn_off' });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ domain: 'light', service: 'turn_off', entityId: 'light.living_ceiling', data: {} }]);
  });

  it('lehnt einen manipulierten Befehl ab, ohne Home Assistant zu erreichen', async () => {
    const calls: any[] = [];
    const base = await start(apartmentHousehold(), {
      hotelCommandClientFactory: () => ({ call: async () => { calls.push(1); return { ok: true }; } }),
    });

    const response = await post(base, { entityId: 'lock.front_door', action: 'turn_on' });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('HOTEL_COMMAND_ENTITY_NOT_ALLOWED');
    expect(calls).toEqual([]);
  });

  it('bleibt bei deaktiviertem Hotel Mode vollständig geschlossen', async () => {
    const base = await start(neutralSmall);

    const response = await post(base, { entityId: 'light.living_ceiling', action: 'turn_on' });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('HOTEL_STAY_INACTIVE');
  });

  it('gibt die Route ohne erlaubte Herkunft nicht frei', async () => {
    const base = await start(apartmentHousehold());

    const response = await post(base, { entityId: 'light.living_ceiling', action: 'turn_on' }, { origin: 'http://evil.fixture' });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('HOTEL_ROUTE_FORBIDDEN');
  });
});
