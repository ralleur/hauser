import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import neutralApartment from '../../config/examples/neutral-apartment.json';
import neutralSmall from '../../config/examples/neutral-small.json';
// @ts-expect-error native .mjs runtime contract
import { createHmiServer, createHotelModeAdminAccess, createHotelModeStore, normalizeHotelModeDocument, resolveHotelModeDataPath } from '../../server.mjs';

const servers: any[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PIN = '246810';
const OTHER_PIN = '135791';

function fixture(household: unknown = neutralSmall) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-mode-'));
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

function clock(start = 1_800_000_000_000) {
  let value = start;
  return { now: () => value, advance: (ms: number) => { value += ms; } };
}

function accessFixture(sessionMs = 15 * 60 * 1000) {
  const paths = fixture();
  const time = clock();
  const store = createHotelModeStore(resolveHotelModeDataPath(paths.configPath));
  const access = createHotelModeAdminAccess(store, { now: time.now, sessionMs });
  return { ...paths, access, store, time };
}

function cookieRequest(token: string) {
  return { headers: { cookie: `hmi_hotel_admin=${token}` }, socket: {} };
}

async function start(options: Record<string, unknown> = {}, household: unknown = neutralSmall) {
  const paths = fixture(household);
  const server = createHmiServer('', {
    ...paths,
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    allowedOrigins: new Set(['http://client.fixture']),
    paperlessPin: '',
    paperlessToken: '',
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { ...paths, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

function post(base: string, path: string, body: unknown, cookie = '') {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://client.fixture', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function get(base: string, path: string, cookie = '') {
  return fetch(`${base}${path}`, {
    headers: { origin: 'http://client.fixture', ...(cookie ? { cookie } : {}) },
  });
}

function sessionCookie(response: Response) {
  return (response.headers.get('set-cookie') || '').split(';')[0];
}

describe('Hotel-Mode-Privatstore', () => {
  it('legt das Dokument neben der Shared Config an und schreibt es nur privat lesbar', () => {
    const { access, configPath, store } = accessFixture();
    expect(store.path).toBe(join(configPath.replace(/config\.json$/, ''), 'hotel-mode.json'));
    expect(access.configured()).toBe(false);

    expect(access.setPin({ pin: PIN })).toEqual({ ok: true });

    const raw = readFileSync(store.path, 'utf8');
    expect(raw).not.toContain(PIN);
    expect(statSync(store.path).mode & 0o777).toBe(0o600);
    const document = JSON.parse(raw);
    expect(document.version).toBe(1);
    expect(document.adminPin.algorithm).toBe('scrypt');
    expect(document.adminPin).not.toHaveProperty('pin');
    expect(document).toEqual({
      version: 1,
      adminPin: document.adminPin,
      manualOverride: null,
      checkout: null,
      calendarCache: null,
    });
  });

  it('verwirft fremde und ungültige Felder statt sie zu übernehmen', () => {
    expect(normalizeHotelModeDocument({
      version: 1,
      adminPin: { algorithm: 'plain', pin: '123456' },
      manualOverride: { id: 'o1', startsAt: 5, endsAt: 5, createdAt: 1 },
      checkout: { stayId: 'stay-1', checkedOutAt: 12 },
      calendarCache: { fetchedAt: 1, validUntil: 2, stays: [{ uid: 'a', checkIn: 9, checkOut: 8 }] },
      guestHistory: [{ name: 'Gast' }],
    })).toEqual({
      version: 1,
      adminPin: null,
      manualOverride: null,
      checkout: { stayId: 'stay-1', checkedOutAt: 12 },
      calendarCache: { fetchedAt: 1, validUntil: 2, stays: [] },
    });
    expect(normalizeHotelModeDocument({ version: 99, adminPin: { algorithm: 'scrypt' } }).adminPin).toBeNull();
  });

  it('behandelt einen beschädigten Store als leer, statt den Server zu stoppen', () => {
    const { configPath } = fixture();
    const path = resolveHotelModeDataPath(configPath);
    writeFileSync(path, '{ "version": 1, "adminPin": ');
    const store = createHotelModeStore(path);
    const access = createHotelModeAdminAccess(store);
    expect(store.read()).toEqual({
      version: 1, adminPin: null, manualOverride: null, checkout: null, calendarCache: null,
    });
    expect(access.configured()).toBe(false);
    expect(access.unlock(PIN, '127.0.0.1')).toEqual({ ok: false, configured: false });
  });

  it('überlebt einen Neustart mit dem PIN-Verifier, aber ohne offene Sitzung', () => {
    const { access, store } = accessFixture();
    access.setPin({ pin: PIN });
    const unlocked = access.unlock(PIN, '127.0.0.1');
    expect(unlocked.ok).toBe(true);

    const restarted = createHotelModeAdminAccess(createHotelModeStore(store.path));
    expect(restarted.configured()).toBe(true);
    expect(restarted.inspect(cookieRequest(unlocked.session))).toBe(false);
    expect(restarted.unlock(PIN, '127.0.0.1').ok).toBe(true);
  });
});

describe('Hotel-Mode-Admin-PIN', () => {
  it('lehnt zu kurze und nicht numerische PINs ab', () => {
    const { access } = accessFixture();
    expect(access.setPin({ pin: '12345' })).toEqual({ ok: false, code: 'HOTEL_PIN_INVALID' });
    expect(access.setPin({ pin: 'geheim1' })).toEqual({ ok: false, code: 'HOTEL_PIN_INVALID' });
    expect(access.setPin({ pin: 246810 as unknown as string })).toEqual({ ok: false, code: 'HOTEL_PIN_INVALID' });
    expect(access.configured()).toBe(false);
  });

  it('verlangt für den Wechsel immer die bisherige PIN', () => {
    const { access } = accessFixture();
    access.setPin({ pin: PIN });
    expect(access.setPin({ pin: OTHER_PIN })).toEqual({ ok: false, code: 'HOTEL_PIN_CURRENT_MISMATCH' });
    expect(access.setPin({ pin: OTHER_PIN, currentPin: '999999' })).toEqual({ ok: false, code: 'HOTEL_PIN_CURRENT_MISMATCH' });
    expect(access.setPin({ pin: OTHER_PIN, currentPin: PIN })).toEqual({ ok: true });
    expect(access.unlock(PIN, '127.0.0.1').ok).toBe(false);
    expect(access.unlock(OTHER_PIN, '127.0.0.1').ok).toBe(true);
  });

  it('beendet bestehende Sitzungen beim PIN-Wechsel', () => {
    const { access } = accessFixture();
    access.setPin({ pin: PIN });
    const unlocked = access.unlock(PIN, '127.0.0.1');
    expect(access.inspect(cookieRequest(unlocked.session))).toBe(true);
    access.setPin({ pin: OTHER_PIN, currentPin: PIN });
    expect(access.inspect(cookieRequest(unlocked.session))).toBe(false);
  });

  it('sperrt nach fünf Fehlversuchen und verlängert die Sperre progressiv', () => {
    const { access, time } = accessFixture();
    access.setPin({ pin: PIN });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(access.unlock('000000', '10.0.0.5')).toMatchObject({ ok: false, limited: false });
    }
    const blocked = access.unlock('000000', '10.0.0.5');
    expect(blocked).toMatchObject({ ok: false, limited: true });
    expect(blocked.retryAfterMs).toBe(60_000);
    // Die richtige PIN hilft während der Sperre nicht.
    expect(access.unlock(PIN, '10.0.0.5')).toMatchObject({ ok: false, limited: true });
    // Eine andere Adresse bleibt unberührt.
    expect(access.unlock(PIN, '10.0.0.6').ok).toBe(true);

    time.advance(60_000);
    for (let attempt = 0; attempt < 5; attempt += 1) access.unlock('000000', '10.0.0.5');
    expect(access.unlock('000000', '10.0.0.5').retryAfterMs).toBe(120_000);

    time.advance(120_000);
    expect(access.unlock(PIN, '10.0.0.5').ok).toBe(true);
    // Erfolg löscht den Backoff-Zustand.
    expect(access.unlock('000000', '10.0.0.5')).toMatchObject({ limited: false });
  });
});

describe('Hotel-Mode-Adminsitzung', () => {
  it('läuft nach 15 Minuten Inaktivität ab und wird nur durch echte Adminaktionen verlängert', () => {
    const { access, time } = accessFixture();
    access.setPin({ pin: PIN });
    const request = cookieRequest(access.unlock(PIN, '127.0.0.1').session);

    time.advance(14 * 60 * 1000);
    // Statusabfragen sind Polling und verlängern nichts.
    expect(access.status(request).unlocked).toBe(true);
    time.advance(60 * 1000 + 1);
    expect(access.status(request)).toMatchObject({ configured: true, unlocked: false, expiresAt: null });
    expect(access.authorize(request)).toBe(false);

    const second = cookieRequest(access.unlock(PIN, '127.0.0.1').session);
    time.advance(14 * 60 * 1000);
    expect(access.touch(second)).toBe(true);
    time.advance(14 * 60 * 1000);
    expect(access.inspect(second)).toBe(true);
  });

  it('macht ein Lock sofort wirksam und kennt keine geratenen Tokens', () => {
    const { access } = accessFixture();
    access.setPin({ pin: PIN });
    const request = cookieRequest(access.unlock(PIN, '127.0.0.1').session);
    expect(access.authorize(request)).toBe(true);
    access.lock(request);
    expect(access.inspect(request)).toBe(false);
    expect(access.inspect(cookieRequest('a'.repeat(64)))).toBe(false);
    expect(access.inspect({ headers: {}, socket: {} })).toBe(false);
  });
});

describe('Hotel-Mode-Endpunkte', () => {
  it('setzt die PIN, entsperrt per HttpOnly-Cookie und sperrt wieder', async () => {
    const { base, configPath } = await start();

    expect((await get(base, '/api/hotel-mode/session')).status).toBe(200);
    expect(await (await get(base, '/api/hotel-mode/session')).json())
      .toEqual({ configured: false, unlocked: false, expiresAt: null });

    expect((await post(base, '/api/hotel-mode/unlock', { pin: PIN })).status).toBe(503);
    expect((await post(base, '/api/hotel-mode/pin', { pin: '12345' })).status).toBe(400);

    const created = await post(base, '/api/hotel-mode/pin', { pin: PIN });
    expect(created.status).toBe(200);
    expect(readFileSync(resolveHotelModeDataPath(configPath), 'utf8')).not.toContain(PIN);

    const wrong = await post(base, '/api/hotel-mode/unlock', { pin: '999999' });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain(PIN);
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const unlocked = await post(base, '/api/hotel-mode/unlock', { pin: PIN });
    expect(unlocked.status).toBe(200);
    const setCookie = unlocked.headers.get('set-cookie') || '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toMatch(/hmi_hotel_admin=[0-9a-f]{64}/);
    expect(await unlocked.json()).toMatchObject({ configured: true, unlocked: true });

    const cookie = sessionCookie(unlocked);
    expect(await (await get(base, '/api/hotel-mode/session', cookie)).json()).toMatchObject({ unlocked: true });
    expect((await post(base, '/api/hotel-mode/touch', {}, cookie)).status).toBe(200);

    const locked = await post(base, '/api/hotel-mode/lock', {}, cookie);
    expect(locked.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await (await get(base, '/api/hotel-mode/session', cookie)).json()).toMatchObject({ unlocked: false });
    expect((await post(base, '/api/hotel-mode/touch', {}, cookie)).status).toBe(401);
  });

  it('lehnt fremde Origins, unbekannte Routen und zu große Anfragen ab', async () => {
    const { base } = await start();
    const foreign = await fetch(`${base}/api/hotel-mode/session`, { headers: { origin: 'https://evil.invalid' } });
    expect(foreign.status).toBe(403);
    // Methoden entscheidet die jeweilige Route; die Grenze davor prüft nur
    // Herkunft und grundsätzlich brauchbare Verben.
    expect((await fetch(`${base}/api/hotel-mode/session`, { method: 'DELETE', headers: { origin: 'http://client.fixture' } })).status).toBe(404);
    expect((await fetch(`${base}/api/hotel-mode/session`, { method: 'PATCH', headers: { origin: 'http://client.fixture' } })).status).toBe(403);
    expect((await get(base, '/api/hotel-mode/unknown')).status).toBe(404);
    expect((await post(base, '/api/hotel-mode/pin', { pin: PIN, filler: 'x'.repeat(2048) })).status).toBe(413);
  });

  it('meldet die Sperre mit 429 und Retry-After', async () => {
    const { base } = await start();
    await post(base, '/api/hotel-mode/pin', { pin: PIN });
    let response = await post(base, '/api/hotel-mode/unlock', { pin: '000000' });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await post(base, '/api/hotel-mode/unlock', { pin: '000000' });
    }
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await response.json()).toMatchObject({ code: 'HOTEL_PIN_RATE_LIMITED' });
  });

  it('schreibt die PIN weder in die Haushaltskonfiguration noch in die Shared Config', async () => {
    const { base, configPath, householdConfigPath } = await start();
    await post(base, '/api/hotel-mode/pin', { pin: PIN });
    await post(base, '/api/hotel-mode/unlock', { pin: PIN });
    expect(readFileSync(householdConfigPath, 'utf8')).not.toContain(PIN);
    expect(readFileSync(configPath, 'utf8')).not.toContain(PIN);
  });
});

const STAY_NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const STAY_DAY = 24 * 60 * 60 * 1000;
const STAY_EVENT = {
  uid: 'fixture-stay',
  summary: 'Familie Sommer',
  description: 'Willkommen im Apartment!',
  start: '2026-07-14T15:00:00+02:00',
  end: '2026-07-18T11:00:00+02:00',
};

function apartmentHousehold() {
  return { ...neutralApartment, hotelMode: { ...neutralApartment.hotelMode, enabled: true, kioskAcknowledged: true } };
}

async function startApartment(events: unknown[] = [STAY_EVENT]) {
  const time = clock(STAY_NOW);
  const started = await start(
    {
      hotelModeNow: time.now,
      hotelCalendarClientFactory: () => ({ events: async () => ({ ok: true, events }) }),
    },
    apartmentHousehold(),
  );
  return { ...started, time };
}

async function unlocked(base: string) {
  await post(base, '/api/hotel-mode/pin', { pin: PIN });
  return sessionCookie(await post(base, '/api/hotel-mode/unlock', { pin: PIN }));
}

describe('Hotel-Mode-Aufenthaltsendpunkte', () => {
  it('liefert Gästen den Aufenthalt ohne Namen und ohne nächsten Aufenthalt', async () => {
    const { base } = await startApartment();

    const response = await get(base, '/api/hotel-mode/status');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.status).toBe('active');
    expect(payload.stay.welcomeMessage).toBe('Willkommen im Apartment!');
    expect(JSON.stringify(payload)).not.toContain('Familie Sommer');
    expect(payload).not.toHaveProperty('nextStay');
    expect(payload).not.toHaveProperty('issues');
  });

  it('bleibt bei deaktiviertem Hotel Mode neutral', async () => {
    const { base } = await start();
    expect(await (await get(base, '/api/hotel-mode/status')).json())
      .toEqual({ enabled: false, status: 'inactive', checkoutEnabled: false, stay: null });
  });

  it('gibt Diagnose und nächsten Aufenthalt nur an eine Adminsitzung', async () => {
    const { base } = await startApartment([
      { ...STAY_EVENT, start: '2026-07-20T15:00:00+02:00', end: '2026-07-24T11:00:00+02:00' },
    ]);

    expect((await get(base, '/api/hotel-mode/stay')).status).toBe(401);

    const cookie = await unlocked(base);
    const payload = await (await get(base, '/api/hotel-mode/stay', cookie)).json();
    expect(payload.status).toBe('inactive');
    expect(payload.nextStay.guestName).toBe('Familie Sommer');
    expect(payload.calendar.entityId).toBe('calendar.apartment_stays');
  });

  it('setzt und löscht den manuellen Override nur mit Adminsitzung', async () => {
    const { base } = await startApartment([]);
    expect((await post(base, '/api/hotel-mode/override', { endsAt: STAY_NOW + STAY_DAY })).status).toBe(401);
    expect((await (await get(base, '/api/hotel-mode/status')).json()).status).toBe('inactive');

    const cookie = await unlocked(base);
    expect((await post(base, '/api/hotel-mode/override', { endsAt: STAY_NOW - 1 }, cookie)).status).toBe(400);

    const created = await post(base, '/api/hotel-mode/override', { endsAt: STAY_NOW + STAY_DAY }, cookie);
    expect(created.status).toBe(200);
    expect((await created.json()).override.endsAt).toBe(STAY_NOW + STAY_DAY);
    expect((await (await get(base, '/api/hotel-mode/status')).json()).status).toBe('active');

    expect((await post(base, '/api/hotel-mode/override', { clear: true }, cookie)).status).toBe(200);
    expect((await (await get(base, '/api/hotel-mode/status')).json()).status).toBe('inactive');
  });

  it('hält eine Adminsitzung nicht durch Statuspolling offen, wohl aber durch echte Adminaktionen', async () => {
    const { base, time } = await startApartment();
    const cookie = await unlocked(base);
    const expiresAt = async () => (await (await get(base, '/api/hotel-mode/session', cookie)).json()).expiresAt;
    expect(await expiresAt()).toBe(STAY_NOW + 15 * 60 * 1000);

    time.advance(5 * 60 * 1000);
    await get(base, '/api/hotel-mode/stay', cookie);
    await get(base, '/api/hotel-mode/status');
    expect(await expiresAt()).toBe(STAY_NOW + 15 * 60 * 1000);

    await post(base, '/api/hotel-mode/override', { endsAt: STAY_NOW + STAY_DAY }, cookie);
    expect(await expiresAt()).toBe(STAY_NOW + 20 * 60 * 1000);
  });
});
