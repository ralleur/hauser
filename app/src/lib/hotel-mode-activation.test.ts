import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import neutralApartment from '../../config/examples/neutral-apartment.json';
// @ts-expect-error Für die .mjs-Laufzeitdatei existiert keine separate Declaration.
import { createHmiServer, createHotelActivationPreflight } from '../../server.mjs';
import { parseHouseholdConfig } from './config/household-config.ts';
import {
  HOTEL_SENSITIVE_CREDENTIAL_KEYS,
  HOTEL_SENSITIVE_LOCAL_KEYS,
  hotelSurfaceNeedsPurge,
  parseHotelActivationReport,
  purgeHotelSensitiveValues,
} from './hotel-mode-activation.ts';

/* Zwei Grenzen: Hotel Mode wird nie halb aktiviert, und ein Gasttablett trägt
   keine Zugangsdaten mehr — ohne dass das Deaktivieren den Admin aussperrt. */

const servers: any[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

function hotelMode(overrides: Record<string, unknown> = {}) {
  const parsed = parseHouseholdConfig(JSON.parse(JSON.stringify(neutralApartment)));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { ...parsed.value.hotelMode!, kioskAcknowledged: true, ...overrides };
}

function preflight({
  credentials = { 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'fixture-token' } as Record<string, string>,
  pinConfigured = true,
  stateResult = { ok: true, entity: { state: 'on', attributes: {} } } as any,
  calendarResult = { ok: true, events: [] } as any,
} = {}) {
  const asked = { states: [] as string[], calendars: [] as string[] };
  const service = createHotelActivationPreflight({
    configStore: { read: () => credentials },
    access: { configured: () => pinConfigured },
    now: () => NOW,
    statesClientFactory: () => ({
      state: async (entityId: string) => { asked.states.push(entityId); return stateResult; },
    }),
    calendarClientFactory: () => ({
      events: async (entityId: string) => { asked.calendars.push(entityId); return calendarResult; },
    }),
  });
  return { asked, service };
}

function codes(report: any): Record<string, string | null> {
  return Object.fromEntries(report.checks.map((check: any) => [check.id, check.code]));
}

describe('Aktivierungs-Preflight', () => {
  it('besteht mit vollständiger Einrichtung und prüft dabei wirklich ab', async () => {
    const { asked, service } = preflight();

    const report = await service.inspect(hotelMode());

    expect(report.ok).toBe(true);
    expect(report.checks.map((check: any) => check.id))
      .toEqual(['kiosk', 'pin', 'policy', 'proxy', 'calendar']);
    // Nicht nur Konfiguration lesen: Gerätepfad und Kalender werden abgerufen.
    expect(asked.states).toEqual(['climate.living']);
    expect(asked.calendars).toEqual(['calendar.apartment_stays']);
  });

  it('meldet eine fehlende Kioskbestätigung und eine fehlende PIN einzeln', async () => {
    const withoutKiosk = await preflight().service.inspect(hotelMode({ kioskAcknowledged: false }));
    expect(withoutKiosk.ok).toBe(false);
    expect(codes(withoutKiosk).kiosk).toBe('HOTEL_KIOSK_UNCONFIRMED');

    const withoutPin = await preflight({ pinConfigured: false }).service.inspect(hotelMode());
    expect(withoutPin.ok).toBe(false);
    expect(codes(withoutPin).pin).toBe('HOTEL_PIN_NOT_CONFIGURED');
  });

  it('lehnt eine leere Gastfreigabe ab und fragt dann kein Gerät ab', async () => {
    const { asked, service } = preflight();

    const report = await service.inspect(hotelMode({ guestAccess: { rooms: [], scenes: [], scripts: [] } }));

    expect(codes(report).policy).toBe('HOTEL_GUEST_ACCESS_EMPTY');
    expect(codes(report).proxy).toBe('HOTEL_GUEST_ACCESS_EMPTY');
    expect(asked.states).toEqual([]);
  });

  it('wertet die Freigabe auch bei noch deaktiviertem Schalter aus', async () => {
    // Der Entwurf steht zur Prüfung, nicht der gespeicherte Schalterzustand.
    const report = await preflight().service.inspect(hotelMode({ enabled: false }));

    expect(codes(report).policy).toBeNull();
    expect(report.ok).toBe(true);
  });

  it('meldet fehlende Home-Assistant-Zugangsdaten für Gerätepfad und Kalender', async () => {
    const { asked, service } = preflight({ credentials: {} });

    const report = await service.inspect(hotelMode());

    expect(codes(report).proxy).toBe('HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');
    expect(codes(report).calendar).toBe('HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');
    expect(asked.states).toEqual([]);
    expect(asked.calendars).toEqual([]);
  });

  it('reicht den konkreten Fehler von Gerätepfad und Kalender durch', async () => {
    const proxyBroken = await preflight({
      stateResult: { ok: false, code: 'HOTEL_STATES_AUTH_FAILED' },
    }).service.inspect(hotelMode());
    expect(codes(proxyBroken).proxy).toBe('HOTEL_STATES_AUTH_FAILED');

    const calendarBroken = await preflight({
      calendarResult: { ok: false, code: 'HOTEL_CALENDAR_UNREACHABLE' },
    }).service.inspect(hotelMode());
    expect(codes(calendarBroken).calendar).toBe('HOTEL_CALENDAR_UNREACHABLE');
  });

  it('verlangt einen konfigurierten Kalender', async () => {
    const report = await preflight().service.inspect(hotelMode({
      calendar: { ...hotelMode().calendar, entityId: '' },
    }));

    expect(codes(report).calendar).toBe('HOTEL_CALENDAR_NOT_CONFIGURED');
  });

  it('bleibt ohne Policy vollständig geschlossen', async () => {
    const report = await preflight().service.inspect(undefined);

    expect(report.ok).toBe(false);
    // Die PIN hängt nicht an der Policy; alles Policy-Abhängige fällt aus.
    expect(codes(report)).toMatchObject({
      kiosk: 'HOTEL_KIOSK_UNCONFIRMED',
      policy: 'HOTEL_GUEST_ACCESS_EMPTY',
      proxy: 'HOTEL_GUEST_ACCESS_EMPTY',
      calendar: 'HOTEL_CALENDAR_NOT_CONFIGURED',
    });
  });
});

describe('Bericht im Client', () => {
  it('liest einen vollständigen Bericht', () => {
    expect(parseHotelActivationReport({ ok: true, checks: [{ id: 'pin', ok: true, code: null }] }))
      .toEqual({ ok: true, checks: [{ id: 'pin', ok: true, code: null }] });
  });

  it('gilt fail-closed als offen, wenn irgendetwas nicht stimmt', () => {
    for (const payload of [null, 'nope', [], {}, { ok: true }, { ok: true, checks: [] }]) {
      expect(parseHotelActivationReport(payload).ok).toBe(false);
    }
    // Ein `ok: true` ohne durchweg bestandene Prüfungen zählt nicht.
    expect(parseHotelActivationReport({
      ok: true, checks: [{ id: 'pin', ok: true }, { id: 'proxy', ok: false, code: 'X' }],
    }).ok).toBe(false);
  });
});

describe('Credential-Cutover auf dem Gastclient', () => {
  function storage(values: Record<string, string>) {
    const removed: string[] = [];
    return {
      removed,
      values,
      getItem: (key: string) => values[key] ?? null,
      removeItem: (key: string) => { removed.push(key); delete values[key]; },
    };
  }

  it('bereinigt genau die Gastoberflächen', () => {
    expect(hotelSurfaceNeedsPurge('inactive')).toBe(true);
    expect(hotelSurfaceNeedsPurge('active')).toBe(true);
    expect(hotelSurfaceNeedsPurge('admin')).toBe(false);
    expect(hotelSurfaceNeedsPurge('disabled')).toBe(false);
  });

  it('entfernt Zugangsdaten und persönliche Zwischenspeicher', () => {
    const store = storage({
      'hmi:ha-token': 'secret',
      'hmi:jf-token': 'secret',
      'hmi:ai-hermes-key': 'secret',
      'hmi:ha-cache': '{}',
      'hmi:calendar-familie-cache': '[]',
    });

    const removed = purgeHotelSensitiveValues(store);

    expect(removed.sort()).toEqual([
      'hmi:ai-hermes-key', 'hmi:calendar-familie-cache', 'hmi:ha-cache', 'hmi:ha-token', 'hmi:jf-token',
    ]);
    expect(store.values).toEqual({});
  });

  it('lässt Einstellungen und Layout unangetastet', () => {
    const store = storage({
      'hmi:ha-url': 'http://ha.local',
      'hmi:home-layout:v1': '{}',
      'hmi:appearance-mode': 'dark',
      'hmi:household-config-cache:v1': '{}',
    });

    expect(purgeHotelSensitiveValues(store)).toEqual([]);
    expect(Object.keys(store.values).sort())
      .toEqual(['hmi:appearance-mode', 'hmi:ha-url', 'hmi:home-layout:v1', 'hmi:household-config-cache:v1']);
  });

  it('bleibt ohne Speicher und bei gesperrtem Speicher ruhig', () => {
    expect(purgeHotelSensitiveValues(null)).toEqual([]);
    expect(purgeHotelSensitiveValues({
      getItem: () => 'x',
      removeItem: () => { throw new Error('blocked'); },
    })).toEqual([]);
  });

  it('nennt jeden sensiblen Schlüssel genau einmal', () => {
    expect(new Set(HOTEL_SENSITIVE_LOCAL_KEYS).size).toBe(HOTEL_SENSITIVE_LOCAL_KEYS.length);
    for (const key of HOTEL_SENSITIVE_CREDENTIAL_KEYS) {
      expect(HOTEL_SENSITIVE_LOCAL_KEYS).toContain(key);
    }
  });
});

describe('GET /api/hotel-mode/activation', () => {
  async function start(household: unknown) {
    const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-activation-'));
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
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  it('verlangt eine Adminsitzung', async () => {
    const base = await start(neutralApartment);

    const response = await fetch(`${base}/api/hotel-mode/activation`, {
      headers: { origin: 'http://client.fixture' },
    });

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('HOTEL_ADMIN_REQUIRED');
  });
});
