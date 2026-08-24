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
import { createHmiServer } from '../../server.mjs';

/* Der zusammenhängende Ferienapartment-Flow über echte HTTP-Requests:
   inactive → active → Bedienung → Checkout → inactive, dazu Admin-Unlock bis
   zum Ablauf durch Inaktivität. Geprüft wird die Grenze, nicht die Optik. */

const servers: any[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ORIGIN = 'http://client.fixture';
const PIN = '246813';

/** Aufenthalt vom 2026-07-14 15:00 bis 2026-07-18 11:00 (Europe/Berlin). */
const STAY = {
  uid: 'stay-a',
  summary: 'Familie Sommer',
  description: 'Willkommen im Apartment!',
  start: '2026-07-14T15:00:00+02:00',
  end: '2026-07-18T11:00:00+02:00',
};

const BEFORE_CHECK_IN = Date.UTC(2026, 6, 13, 12, 0, 0);
const DURING_STAY = Date.UTC(2026, 6, 15, 12, 0, 0);

const HA_STATES: Record<string, { state: string; attributes: Record<string, unknown> }> = {
  'light.living_ceiling': { state: 'off', attributes: { friendly_name: 'Deckenlicht', supported_features: 44 } },
  'climate.living': { state: 'heat', attributes: { temperature: 21, current_temperature: 20.5 } },
  'light.bath_mirror': { state: 'off', attributes: {} },
};

function apartment(overrides: Record<string, unknown> = {}) {
  return {
    ...neutralApartment,
    hotelMode: { ...neutralApartment.hotelMode, enabled: true, kioskAcknowledged: true, ...overrides },
  };
}

async function start(household: unknown = apartment()) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-flow-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>fixture</title>');
  const configPath = join(root, 'config.json');
  const householdConfigPath = join(root, 'household.json');
  writeFileSync(configPath, JSON.stringify({ 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'server-token' }));
  writeFileSync(householdConfigPath, JSON.stringify(household));

  const clock = { now: DURING_STAY };
  const sent: any[] = [];
  const events: any[] = [];
  const server = createHmiServer('', {
    staticRoot,
    configPath,
    householdConfigPath,
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    allowedOrigins: new Set([ORIGIN]),
    paperlessPin: '',
    paperlessToken: '',
    hotelModeNow: () => clock.now,
    hotelModeSessionMs: 15 * 60 * 1000,
    hotelCalendarClientFactory: () => ({ events: async () => ({ ok: true, events: [STAY] }) }),
    hotelStatesClientFactory: () => ({
      state: async (entityId: string) => ({ ok: true, entity: HA_STATES[entityId] ?? null }),
    }),
    hotelCommandClientFactory: () => ({
      call: async (domain: string, service: string, entityId: string, data: unknown) => {
        sent.push({ domain, service, entityId, data });
        return { ok: true };
      },
    }),
    hotelEventClientFactory: () => ({
      fire: async (eventType: string, data: unknown) => { events.push({ eventType, data }); return { ok: true }; },
    }),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { origin: ORIGIN, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    });
    let payload: any = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, payload, headers: response.headers };
  };

  return { base, call, clock, events, sent };
}

function cookieFrom(headers: Headers): string {
  return (headers.get('set-cookie') ?? '').split(';')[0]!;
}

describe('Ferienapartment-Flow', () => {
  it('führt inactive → active → Bedienung → Checkout → inactive durch', async () => {
    const { call, clock, events, sent } = await start();

    // ── inactive: keine Aufenthaltsdaten, keine Geräte, keine Bedienung ──
    clock.now = BEFORE_CHECK_IN;
    const neutral = await call('/api/hotel-mode/status');
    expect(neutral.payload).toMatchObject({ enabled: true, status: 'inactive', stay: null });
    const neutralEntities = await call('/api/hotel-mode/entities');
    expect(neutralEntities.payload.rooms).toEqual([]);
    expect(neutralEntities.payload.entities).toEqual([]);
    const tooEarly = await call('/api/hotel-mode/command', {
      method: 'POST',
      body: JSON.stringify({ entityId: 'light.living_ceiling', action: 'turn_on' }),
    });
    expect(tooEarly.status).toBe(403);
    expect(tooEarly.payload.code).toBe('HOTEL_STAY_INACTIVE');
    expect(sent).toEqual([]);

    // ── active: der Aufenthalt läuft ──
    clock.now = DURING_STAY;
    const active = await call('/api/hotel-mode/status');
    expect(active.payload.status).toBe('active');
    expect(active.payload.stay.welcomeMessage).toBe('Willkommen im Apartment!');
    // Der Gastname bleibt auf dem Server.
    expect(JSON.stringify(active.payload)).not.toContain('Familie Sommer');

    const entities = await call('/api/hotel-mode/entities');
    expect(entities.payload.entities.map((entity: any) => entity.entityId).sort())
      .toEqual(['climate.living', 'light.bath_mirror', 'light.living_ceiling']);
    expect(JSON.stringify(entities.payload)).not.toContain('friendly_name');

    // ── Bedienung: erlaubt durch, manipuliert abgelehnt ──
    const allowed = await call('/api/hotel-mode/command', {
      method: 'POST',
      body: JSON.stringify({ entityId: 'light.living_ceiling', action: 'turn_on', data: { brightness_pct: 40 } }),
    });
    expect(allowed.status).toBe(200);
    expect(sent).toEqual([{
      domain: 'light', service: 'turn_on', entityId: 'light.living_ceiling', data: { brightness_pct: 40 },
    }]);

    const tampered = await call('/api/hotel-mode/command', {
      method: 'POST',
      body: JSON.stringify({ entityId: 'lock.front_door', action: 'turn_on', domain: 'light' }),
    });
    expect(tampered.status).toBe(403);
    expect(sent.length).toBe(1);

    // ── Checkout: Markierung, Ereignis, danach sofort neutral ──
    const checkout = await call('/api/hotel-mode/checkout', { method: 'POST', body: '{}' });
    expect(checkout.status).toBe(200);
    expect(events).toEqual([{
      eventType: 'hauser_guest_checkout',
      data: { stay_id: 'stay-a', checked_out_at: new Date(DURING_STAY).toISOString() },
    }]);

    // Die konfigurierte Checkout-Szene läuft best-effort nach der Markierung.
    expect(sent[1]).toEqual({
      domain: 'scene', service: 'turn_on', entityId: 'scene.apartment_after_checkout', data: {},
    });

    clock.now = DURING_STAY + 1000;
    const afterCheckout = await call('/api/hotel-mode/status');
    expect(afterCheckout.payload).toMatchObject({ status: 'inactive', stay: null });
    expect((await call('/api/hotel-mode/entities')).payload.entities).toEqual([]);
    const afterCommand = await call('/api/hotel-mode/command', {
      method: 'POST',
      body: JSON.stringify({ entityId: 'light.living_ceiling', action: 'turn_off' }),
    });
    expect(afterCommand.status).toBe(403);
    expect(sent.length).toBe(2);

    // Ein zweiter Checkout verdoppelt weder Ereignis noch Szene.
    expect((await call('/api/hotel-mode/checkout', { method: 'POST', body: '{}' })).status).toBe(200);
    expect(events.length).toBe(1);
    expect(sent.length).toBe(2);
  });

  it('führt Admin-Unlock bis zum Ablauf durch Inaktivität durch', async () => {
    const { call, clock } = await start();

    expect((await call('/api/hotel-mode/session')).payload)
      .toEqual({ configured: false, unlocked: false, expiresAt: null });
    // Ohne Adminsitzung bleibt der Aufenthaltsstatus verschlossen.
    expect((await call('/api/hotel-mode/stay')).status).toBe(401);
    expect((await call('/api/config')).status).toBe(401);

    expect((await call('/api/hotel-mode/pin', { method: 'POST', body: JSON.stringify({ pin: PIN }) })).status).toBe(200);
    expect((await call('/api/hotel-mode/unlock', { method: 'POST', body: JSON.stringify({ pin: '000000' }) })).status)
      .toBe(401);

    const unlocked = await call('/api/hotel-mode/unlock', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    expect(unlocked.status).toBe(200);
    const cookie = cookieFrom(unlocked.headers);
    const asAdmin = { headers: { cookie } };

    // Der Admin sieht Diagnose und Gastnamen, der Gast weiterhin nicht.
    const stay = await call('/api/hotel-mode/stay', asAdmin);
    expect(stay.status).toBe(200);
    expect(stay.payload.stay.guestName).toBe('Familie Sommer');
    expect((await call('/api/config', asAdmin)).status).toBe(200);

    // Statuspolling verlängert die Sitzung ausdrücklich nicht.
    clock.now = DURING_STAY + 14 * 60 * 1000;
    await call('/api/hotel-mode/stay', asAdmin);
    clock.now = DURING_STAY + 16 * 60 * 1000;
    expect((await call('/api/hotel-mode/session', asAdmin)).payload.unlocked).toBe(false);
    expect((await call('/api/hotel-mode/stay', asAdmin)).status).toBe(401);
    expect((await call('/api/config', asAdmin)).status).toBe(401);

    // Echte Interaktion hält sie dagegen offen.
    const again = await call('/api/hotel-mode/unlock', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    const freshCookie = cookieFrom(again.headers);
    clock.now = DURING_STAY + 26 * 60 * 1000;
    expect((await call('/api/hotel-mode/touch', { method: 'POST', body: '{}', headers: { cookie: freshCookie } })).status)
      .toBe(200);
    clock.now = DURING_STAY + 36 * 60 * 1000;
    expect((await call('/api/hotel-mode/session', { headers: { cookie: freshCookie } })).payload.unlocked).toBe(true);

    // Explizites Sperren fällt sofort in den Gastzustand zurück.
    expect((await call('/api/hotel-mode/lock', { method: 'POST', body: '{}', headers: { cookie: freshCookie } })).status)
      .toBe(200);
    expect((await call('/api/hotel-mode/stay', { headers: { cookie: freshCookie } })).status).toBe(401);
    expect((await call('/api/hotel-mode/status')).payload.status).toBe('active');
  });

  it('lässt der Admin die Checkout-Markierung zurücknehmen', async () => {
    const { call, clock } = await start();
    await call('/api/hotel-mode/checkout', { method: 'POST', body: '{}' });
    clock.now = DURING_STAY + 1000;
    expect((await call('/api/hotel-mode/status')).payload.status).toBe('inactive');

    await call('/api/hotel-mode/pin', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    const unlocked = await call('/api/hotel-mode/unlock', { method: 'POST', body: JSON.stringify({ pin: PIN }) });
    const cookie = cookieFrom(unlocked.headers);

    expect((await call('/api/hotel-mode/checkout', { method: 'DELETE', headers: { cookie } })).status).toBe(200);
    clock.now = DURING_STAY + 2000;
    expect((await call('/api/hotel-mode/status')).payload.status).toBe('active');
  });

  it('lässt eine migrierte v3-Installation ohne Hotel Mode unverändert laufen', async () => {
    const { call, sent } = await start(neutralSmall);

    expect((await call('/api/hotel-mode/status')).payload)
      .toEqual({ enabled: false, status: 'inactive', checkoutEnabled: false, stay: null });
    expect((await call('/api/hotel-mode/entities')).payload).toEqual({
      enabled: false, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null,
    });
    // Ohne Hotel Mode bleibt der bisherige Adminbetrieb vollständig offen.
    expect((await call('/api/config')).status).toBe(200);
    expect((await call('/api/household-config')).status).toBe(200);
    expect(sent).toEqual([]);
  });
});
