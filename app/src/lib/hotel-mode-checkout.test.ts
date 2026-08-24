import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import neutralApartment from '../../config/examples/neutral-apartment.json';
import neutralSmall from '../../config/examples/neutral-small.json';
// @ts-expect-error Für die .mjs-Laufzeitdatei existiert keine separate Declaration.
import { createHmiServer, createHotelCheckoutService, createHotelEventClient, createHotelModeStayService, createHotelModeStore } from '../../server.mjs';

/* Geprüft wird die Reihenfolge der Zusage: erst die Markierung, dann alles
   andere — und dass ein wiederholter Request nichts verdoppelt. */

const servers: any[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Mittwoch, 2026-07-15, 12:00 UTC — innerhalb des Fixture-Aufenthalts. */
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

const TIMED_EVENT = {
  uid: 'stay-a',
  summary: 'Familie Sommer',
  description: 'Willkommen im Apartment!',
  start: '2026-07-14T15:00:00+02:00',
  end: '2026-07-18T11:00:00+02:00',
};

function policyFixture(overrides: Record<string, unknown> = {}) {
  return { ...neutralApartment.hotelMode, enabled: true, kioskAcknowledged: true, ...overrides };
}

function fixture({
  policy = policyFixture() as any,
  credentials = { 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'fixture-token' } as Record<string, string>,
  eventResult = { ok: true } as any,
  sceneResult = { ok: true } as any,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-checkout-'));
  roots.push(root);
  const store = createHotelModeStore(join(root, 'hotel-mode.json'));
  const state = { now: NOW, events: [] as any[], scenes: [] as any[], invalidated: 0 };
  const stays = createHotelModeStayService({
    store,
    configStore: { read: () => credentials },
    now: () => state.now,
    policyReader: () => policy,
    calendarClientFactory: () => ({ events: async () => ({ ok: true, events: [TIMED_EVENT] }) }),
  });
  const checkouts = createHotelCheckoutService({
    stays,
    store,
    guests: { invalidate: () => { state.invalidated += 1; } },
    configStore: { read: () => credentials },
    now: () => state.now,
    policyReader: () => policy,
    eventClientFactory: () => ({
      fire: async (eventType: string, data: unknown) => {
        state.events.push({ eventType, data });
        return eventResult;
      },
    }),
    commandClientFactory: () => ({
      call: async (domain: string, service: string, entityId: string) => {
        state.scenes.push({ domain, service, entityId });
        return sceneResult;
      },
    }),
  });
  return { checkouts, state, stays, store };
}

describe('Gast-Checkout', () => {
  it('persistiert die Markierung und meldet den Aufenthalt an Home Assistant', async () => {
    const { checkouts, state, store } = fixture();

    expect(await checkouts.checkout()).toEqual({ ok: true, status: 200, repeated: false });
    expect(store.read().checkout).toMatchObject({ stayId: 'stay-a', checkedOutAt: NOW });
    expect(state.events).toEqual([{
      eventType: 'hauser_guest_checkout',
      data: { stay_id: 'stay-a', checked_out_at: new Date(NOW).toISOString() },
    }]);
    // Der Sammelcache darf keine Steuerdaten mehr ausliefern.
    expect(state.invalidated).toBe(1);
  });

  it('sendet keine Gastdaten über den Namen hinaus mit', async () => {
    const { checkouts, state } = fixture();
    await checkouts.checkout();

    const payload = JSON.stringify(state.events[0].data);
    expect(payload).not.toContain('Familie Sommer');
    expect(payload).not.toContain('Willkommen im Apartment');
    expect(Object.keys(state.events[0].data).sort()).toEqual(['checked_out_at', 'stay_id']);
  });

  it('neutralisiert den Aufenthalt sofort', async () => {
    const { checkouts, stays, state } = fixture();
    expect((await stays.resolve()).status).toBe('active');

    await checkouts.checkout();
    state.now = NOW + 1000;

    const after = await stays.resolve();
    expect(after.status).toBe('inactive');
    expect(after.stay).toBeNull();
    expect(after.source).toBe('checkout');
  });

  it('verdoppelt bei einem wiederholten Request nichts', async () => {
    const { checkouts, state } = fixture();

    await checkouts.checkout();
    state.now = NOW + 1000;
    expect(await checkouts.checkout()).toEqual({ ok: true, status: 200, repeated: true });
    expect(await checkouts.checkout()).toEqual({ ok: true, status: 200, repeated: true });

    expect(state.events.length).toBe(1);
    expect(state.scenes.length).toBe(1);
  });

  it('führt die konfigurierte Szene erst nach der Markierung aus', async () => {
    const { checkouts, state } = fixture();
    await checkouts.checkout();

    expect(state.scenes).toEqual([
      { domain: 'scene', service: 'turn_on', entityId: 'scene.apartment_after_checkout' },
    ]);
  });

  it('verändert ohne konfigurierte Szene kein Gerät', async () => {
    const { checkouts, state } = fixture({
      policy: policyFixture({ checkout: { enabled: true, sceneEntityId: null } }),
    });

    await checkouts.checkout();
    expect(state.scenes).toEqual([]);
    expect(state.events.length).toBe(1);
  });

  it('nimmt ohne freigegebenen Checkout keinen Request an', async () => {
    const { checkouts, state, store } = fixture({
      policy: policyFixture({ checkout: { enabled: false, sceneEntityId: null } }),
    });

    expect(await checkouts.checkout())
      .toEqual({ ok: false, status: 403, code: 'HOTEL_CHECKOUT_DISABLED' });
    expect(store.read().checkout).toBeNull();
    expect(state.events).toEqual([]);
  });

  it('nimmt außerhalb eines Aufenthalts keinen Request an', async () => {
    const { checkouts, state, store } = fixture();
    state.now = Date.UTC(2026, 6, 13, 12, 0, 0);

    expect(await checkouts.checkout()).toEqual({ ok: false, status: 403, code: 'HOTEL_STAY_INACTIVE' });
    expect(store.read().checkout).toBeNull();
  });

  it('bleibt beendet, auch wenn Ereignis und Szene scheitern', async () => {
    const { checkouts, stays, store, state } = fixture({
      eventResult: { ok: false, code: 'HOTEL_EVENT_UNREACHABLE' },
      sceneResult: { ok: false, code: 'HOTEL_COMMAND_UNREACHABLE' },
    });

    expect(await checkouts.checkout()).toMatchObject({ ok: true });
    expect(store.read().checkout).toMatchObject({
      stayId: 'stay-a',
      notice: { event: 'HOTEL_EVENT_UNREACHABLE', scene: 'HOTEL_COMMAND_UNREACHABLE' },
    });

    state.now = NOW + 1000;
    expect((await stays.resolve()).status).toBe('inactive');
  });

  it('zeigt den Fehler nur im Adminstatus, nie im Gaststatus', async () => {
    const { checkouts, stays, state } = fixture({ eventResult: { ok: false, code: 'HOTEL_EVENT_HTTP_ERROR' } });
    await checkouts.checkout();
    state.now = NOW + 1000;

    const resolved = await stays.resolve();
    expect(stays.adminStatus(resolved).checkout.notice.event).toBe('HOTEL_EVENT_HTTP_ERROR');
    expect(JSON.stringify(stays.publicStatus(resolved))).not.toContain('HOTEL_EVENT_HTTP_ERROR');
  });

  it('meldet fehlende Home-Assistant-Zugangsdaten, ohne den Checkout zu blockieren', async () => {
    const { checkouts, state, store } = fixture({ credentials: {} });
    // Ein manueller Aufenthalt hält den Aufenthalt auch ohne Kalenderzugang aktiv.
    fixtureOverride(store, state.now);

    expect(await checkouts.checkout()).toMatchObject({ ok: true });
    expect(store.read().checkout.notice.event).toBe('HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');
    expect(state.events).toEqual([]);
  });

  it('lässt nur den Admin die Markierung zurücknehmen', async () => {
    const { checkouts, stays, store, state } = fixture();
    await checkouts.checkout();
    state.now = NOW + 1000;
    expect((await stays.resolve()).status).toBe('inactive');

    expect(checkouts.reset()).toEqual({ ok: true, status: 200 });
    expect(store.read().checkout).toBeNull();
    state.now = NOW + 2000;
    expect((await stays.resolve()).status).toBe('active');
  });
});

function fixtureOverride(store: any, nowMs: number): void {
  store.update(() => ({
    manualOverride: {
      id: 'override-manual',
      startsAt: nowMs - 1000,
      endsAt: nowMs + 3_600_000,
      createdAt: nowMs - 1000,
    },
  }));
}

describe('Hotel-Mode-Ereignisclient', () => {
  function client(response: unknown, { throws = false } = {}) {
    const calls: any[] = [];
    const events = createHotelEventClient({
      baseUrl: 'http://ha.fixture',
      token: 'fixture-token',
      fetchImpl: async (url: URL, init: any) => {
        calls.push({ url: String(url), init });
        if (throws) throw new Error('offline');
        return response;
      },
    });
    return { calls, events };
  }

  it('feuert genau ein Ereignis mit dem serverseitigen Token', async () => {
    const { calls, events } = client({ status: 200 });

    expect(await events.fire('hauser_guest_checkout', { stay_id: 'a' })).toEqual({ ok: true });
    expect(calls[0].url).toBe('http://ha.fixture/api/events/hauser_guest_checkout');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.authorization).toBe('Bearer fixture-token');
    expect(JSON.parse(calls[0].init.body)).toEqual({ stay_id: 'a' });
  });

  it('unterscheidet Auth-, HTTP- und Verbindungsfehler', async () => {
    expect(await client({ status: 401 }).events.fire('e', {}))
      .toEqual({ ok: false, code: 'HOTEL_EVENT_AUTH_FAILED' });
    expect(await client({ status: 500 }).events.fire('e', {}))
      .toEqual({ ok: false, code: 'HOTEL_EVENT_HTTP_ERROR' });
    expect(await client(null, { throws: true }).events.fire('e', {}))
      .toEqual({ ok: false, code: 'HOTEL_EVENT_UNREACHABLE' });
  });
});

describe('/api/hotel-mode/checkout', () => {
  async function start(household: unknown, options: Record<string, unknown> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-checkout-http-'));
    roots.push(root);
    const staticRoot = join(root, 'dist');
    mkdirSync(staticRoot);
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>fixture</title>');
    const configPath = join(root, 'config.json');
    const householdConfigPath = join(root, 'household.json');
    writeFileSync(configPath, JSON.stringify({ 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'fixture-token' }));
    writeFileSync(householdConfigPath, JSON.stringify(household));
    const server = createHmiServer('', {
      staticRoot,
      configPath,
      householdConfigPath,
      householdConfigMode: 'active',
      householdConfigMigrationResult: { ok: true, status: 'current' },
      allowedOrigins: new Set(['http://client.fixture']),
      paperlessPin: '',
      paperlessToken: '',
      hotelModeNow: () => NOW,
      hotelCalendarClientFactory: () => ({ events: async () => ({ ok: true, events: [TIMED_EVENT] }) }),
      hotelStatesClientFactory: () => ({ state: async () => ({ ok: true, entity: null }) }),
      hotelEventClientFactory: () => ({ fire: async () => ({ ok: true }) }),
      hotelCommandClientFactory: () => ({ call: async () => ({ ok: true }) }),
      ...options,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  it('beantwortet den Gastpfad ohne Adminsitzung und ohne Aufenthaltsdaten', async () => {
    const base = await start({ ...neutralApartment, hotelMode: policyFixture() });

    const response = await fetch(`${base}/api/hotel-mode/checkout`, {
      method: 'POST',
      headers: { origin: 'http://client.fixture', 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
  });

  it('bleibt bei deaktiviertem Hotel Mode geschlossen', async () => {
    const base = await start(neutralSmall);

    const response = await fetch(`${base}/api/hotel-mode/checkout`, {
      method: 'POST',
      headers: { origin: 'http://client.fixture', 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('HOTEL_STAY_INACTIVE');
  });

  it('lässt das Zurücknehmen nur mit Adminsitzung zu', async () => {
    const base = await start({ ...neutralApartment, hotelMode: policyFixture() });

    const response = await fetch(`${base}/api/hotel-mode/checkout`, {
      method: 'DELETE',
      headers: { origin: 'http://client.fixture' },
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('HOTEL_ADMIN_REQUIRED');
  });
});
