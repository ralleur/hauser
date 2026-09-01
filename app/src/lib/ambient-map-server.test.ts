import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { createHash } from 'node:crypto';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
import neutralApartment from '../../config/examples/neutral-apartment.json';
import neutralSmall from '../../config/examples/neutral-small.json';
// @ts-expect-error The production server intentionally remains native Node ESM without declarations.
import { createHmiServer, hotelAdminOnlyRoute } from '../../server.mjs';

const roots: string[] = [];
const servers: Array<{ close: (callback: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SVG = '<svg viewBox="0 0 1920 1200"><path d="M0 0 L10 10"/></svg>';
const SVG_BYTES = new TextEncoder().encode(SVG);
const SVG_ID: string = createHash('sha256').update(SVG_BYTES).digest('hex');

const HA_TOKEN = 'fixture-ha-token';
const HA_URL = 'http://ha.fixture';
const PIN = '246810';

/* Bewusst mit den echten Zusatzfeldern von `GET /api/config`: nur die drei
   Standortfelder dürfen den Server verlassen, alles andere wird verworfen. */
function haConfigBody(overrides: Record<string, unknown> = {}) {
  return {
    latitude: 49.6069,
    longitude: 6.5508,
    location_name: 'Saarburg',
    elevation: 148,
    time_zone: 'Europe/Berlin',
    internal_url: HA_URL,
    components: ['sun', 'light'],
    ...overrides,
  };
}

function haResponse(body: unknown, status = 200) {
  return { status, text: async () => JSON.stringify(body) };
}

type StartOptions = {
  household?: unknown;
  configValues?: Record<string, string> | null;
  withHousehold?: boolean;
  haBody?: () => unknown;
  haStatus?: number;
  haFetchImpl?: ((url: unknown, init: unknown) => Promise<unknown>) | null;
  overrides?: Record<string, unknown>;
};

async function start({
  household = neutralSmall,
  configValues = { 'hmi:ha-url': HA_URL, 'hmi:ha-token': HA_TOKEN },
  withHousehold = true,
  haBody = () => haConfigBody(),
  haStatus = 200,
  haFetchImpl = null,
  overrides = {},
}: StartOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-ambient-map-server-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>fixture</title>');
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'assets'));
  const configPath = join(root, 'config.json');
  writeFileSync(configPath, JSON.stringify(configValues ?? {}));
  const householdConfigPath = join(root, 'household.json');
  if (withHousehold) writeFileSync(householdConfigPath, JSON.stringify(household));

  const ambientMapConfigPath = join(root, 'data', 'ambient-map.json');
  const renders: unknown[] = [];
  const haCalls: Array<{ url: string; init: any }> = [];
  const server = createHmiServer('', {
    staticRoot,
    configPath,
    householdConfigPath,
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    allowedOrigins: new Set(['http://client.fixture']),
    paperlessPin: '',
    paperlessToken: '',
    ambientMapConfigPath,
    ambientMapAssetDirectory: join(root, 'assets', 'ambient-maps'),
    ambientMapJobRunner: async (location: unknown) => {
      renders.push(location);
      return { svgBytes: SVG_BYTES, radiusMetres: 2_000, wayCount: 3, algorithmVersion: 1 };
    },
    ambientMapHaFetchImpl: haFetchImpl ?? (async (url: unknown, init: unknown) => {
      haCalls.push({ url: String(url), init });
      return haResponse(haBody(), haStatus);
    }),
    ...overrides,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server,
    root,
    configPath,
    householdConfigPath,
    ambientMapConfigPath,
    renders,
    haCalls,
    base: `http://127.0.0.1:${port}`,
  };
}

function get(base: string, path: string, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { headers: { origin: 'http://client.fixture', ...headers } });
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://client.fixture', ...headers },
    body: JSON.stringify(body),
  });
}

async function waitForState(base: string, state: string, cookie = '') {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const payload = await (await get(base, '/api/admin/ambient-map', cookie ? { cookie } : {})).json();
    if (payload.state === state) return payload;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ambient map state ${state}`);
}

function persistedConfig(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('Ambient-Map-Verdrahtung im direkten Modus', () => {
  it('liest den Standort ausschließlich über GET /api/config und veröffentlicht das Asset', async () => {
    const { base, ambientMapConfigPath, renders, haCalls } = await start();

    const accepted = await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' });
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ state: 'queued' });

    const admin = await waitForState(base, 'ready');

    expect(haCalls).toHaveLength(1);
    expect(haCalls[0].url).toBe(`${HA_URL}/api/config`);
    expect(haCalls[0].init.method ?? 'GET').toBe('GET');
    expect(haCalls[0].init.headers.authorization).toBe(`Bearer ${HA_TOKEN}`);
    expect(renders).toEqual([{
      source: 'home_assistant', latitude: 49.6069, longitude: 6.5508, label: 'Saarburg',
    }]);

    const stored = persistedConfig(ambientMapConfigPath);
    expect(stored.location).toEqual({
      source: 'home_assistant', latitude: 49.6069, longitude: 6.5508, label: 'Saarburg',
    });
    expect(stored.asset.id).toBe(SVG_ID);

    expect(admin).toEqual({
      version: 1,
      state: 'ready',
      radiusMetres: 2_000,
      asset: {
        url: `/assets/ambient-maps/${SVG_ID}.svg`,
        etag: `"${SVG_ID}"`,
        byteLength: SVG_BYTES.byteLength,
      },
      source: 'home_assistant',
      label: 'Saarburg',
    });

    const asset = await get(base, `/assets/ambient-maps/${SVG_ID}.svg`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('etag')).toBe(`"${SVG_ID}"`);
    expect(await asset.text()).toBe(SVG);
  });

  it('hält den öffentlichen Lesepfad frei von Koordinaten und Ortslabel', async () => {
    const { base } = await start();
    await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' });
    await waitForState(base, 'ready');

    const response = await get(base, '/api/ambient-map');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      version: 1,
      state: 'ready',
      radiusMetres: 2_000,
      asset: {
        url: `/assets/ambient-maps/${SVG_ID}.svg`,
        etag: `"${SVG_ID}"`,
        byteLength: SVG_BYTES.byteLength,
      },
    });
    const text = JSON.stringify(payload);
    expect(text).not.toContain('49.6');
    expect(text).not.toContain('6.55');
    expect(text).not.toContain('Saarburg');
    expect(text).not.toContain('home_assistant');
  });

  it('übernimmt nur die drei Standortfelder und verwirft ein unbrauchbares Ortslabel', async () => {
    const { base, renders, ambientMapConfigPath } = await start({
      haBody: () => haConfigBody({ location_name: 'x'.repeat(200) }),
    });

    await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' });
    await waitForState(base, 'ready');

    expect(renders).toEqual([{ source: 'home_assistant', latitude: 49.6069, longitude: 6.5508 }]);
    const stored = persistedConfig(ambientMapConfigPath);
    expect(stored.location).toEqual({ source: 'home_assistant', latitude: 49.6069, longitude: 6.5508 });
    expect(Object.keys(stored.location)).not.toContain('elevation');
  });

  it('lehnt ungültige Koordinaten aus Home Assistant ab, ohne zu rendern', async () => {
    const { base, renders } = await start({ haBody: () => haConfigBody({ latitude: '49.6069' }) });

    expect((await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' })).status).toBe(202);
    const admin = await waitForState(base, 'error');

    expect(renders).toHaveLength(0);
    expect(admin).toEqual({ version: 1, state: 'error' });
  });

  it('antwortet ohne konfigurierten HA-Zugang mit 503 und wird nach der Einrichtung ohne Neustart frei', async () => {
    const { base, configPath, haCalls, renders } = await start({ configValues: {} });

    const refused = await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ code: 'HOME_ASSISTANT_UNAVAILABLE' });
    expect(haCalls).toHaveLength(0);
    expect(renders).toHaveLength(0);
    expect((await (await get(base, '/api/ambient-map')).json()).state).toBe('empty');

    // Die Ersteinrichtung schreibt den Zugang, ohne den Server neu zu starten.
    writeFileSync(configPath, JSON.stringify({ 'hmi:ha-url': HA_URL, 'hmi:ha-token': HA_TOKEN }));

    expect((await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' })).status).toBe(202);
    await waitForState(base, 'ready');
    expect(haCalls).toHaveLength(1);
  });

  it('rendert manuelle Koordinaten ohne jeden Home-Assistant-Aufruf', async () => {
    const { base, haCalls, renders } = await start();

    expect((await post(base, '/api/admin/ambient-map/location', {
      source: 'manual', latitude: 50.937531, longitude: 6.960279,
    })).status).toBe(202);
    await waitForState(base, 'ready');

    expect(haCalls).toHaveLength(0);
    expect(renders).toEqual([{ source: 'manual', latitude: 50.937531, longitude: 6.960279 }]);
    expect((await post(base, '/api/admin/ambient-map/regenerate', {})).status).toBe(202);
  });
});

describe('Ambient-Map-Verdrahtung im App-Modus', () => {
  function fakeSupervisorClient({ available = true, body = haConfigBody() as unknown, status = 200 } = {}) {
    const calls: Array<[string, string]> = [];
    const closed: boolean[] = [];
    const factory = () => ({
      available,
      close: () => closed.push(true),
      rest: async (method: string, path: string) => {
        calls.push([method, path]);
        return { status, body };
      },
      ws: async () => ({}),
    });
    return Object.assign(factory, { calls, closed });
  }

  it('liest den Standort über den internen Client und niemals über direktes REST', async () => {
    const supervisor = fakeSupervisorClient();
    const { base, haCalls, renders } = await start({
      overrides: { haConnectionMode: 'supervisor', haSupervisorClientFactory: supervisor },
    });

    expect((await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' })).status).toBe(202);
    await waitForState(base, 'ready');

    expect(supervisor.calls).toEqual([['GET', '/api/config']]);
    expect(supervisor.closed.length).toBeGreaterThanOrEqual(1);
    expect(haCalls).toHaveLength(0);
    expect(renders).toEqual([{
      source: 'home_assistant', latitude: 49.6069, longitude: 6.5508, label: 'Saarburg',
    }]);
  });

  it('meldet einen fehlenden internen Zugang als 503, ohne Home Assistant zu rufen', async () => {
    const supervisor = fakeSupervisorClient({ available: false });
    const { base, renders } = await start({
      overrides: { haConnectionMode: 'supervisor', haSupervisorClientFactory: supervisor },
    });

    const refused = await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ code: 'HOME_ASSISTANT_UNAVAILABLE' });
    expect(supervisor.calls).toHaveLength(0);
    expect(renders).toHaveLength(0);
  });

  it('macht aus einer abgelehnten internen Anfrage einen Jobfehler ohne Upstreamtext', async () => {
    const supervisor = fakeSupervisorClient({ status: 403, body: { message: 'supervisor token rejected' } });
    const { base } = await start({
      overrides: { haConnectionMode: 'supervisor', haSupervisorClientFactory: supervisor },
    });

    expect((await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' })).status).toBe(202);
    const admin = await waitForState(base, 'error');
    expect(JSON.stringify(admin)).not.toContain('supervisor token rejected');
  });
});

describe('Ambient-Map-Credential- und Datengrenze', () => {
  it('gibt Token, HA-Adresse und Koordinaten in keiner Antwort und in keinem Asset aus', async () => {
    const { base, ambientMapConfigPath } = await start();
    await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' });
    await waitForState(base, 'ready');

    const bodies = [
      await (await get(base, '/api/ambient-map')).text(),
      await (await get(base, '/api/admin/ambient-map')).text(),
      await (await get(base, `/assets/ambient-maps/${SVG_ID}.svg`)).text(),
    ];
    for (const body of bodies) {
      expect(body).not.toContain(HA_TOKEN);
      expect(body).not.toContain('ha.fixture');
    }
    expect(bodies[0]).not.toContain('Saarburg');
    expect(bodies[2]).not.toContain('49.6');

    // Die Koordinaten leben ausschließlich in der privaten Serverconfig.
    const stored = readFileSync(ambientMapConfigPath, 'utf8');
    expect(stored).toContain('49.6069');
    expect(stored).not.toContain(HA_TOKEN);
  });

  it('reicht einen fehlgeschlagenen HA-Abruf nicht im Wortlaut nach außen', async () => {
    const { base } = await start({
      haFetchImpl: async () => { throw new Error(`connect ECONNREFUSED ${HA_URL} token=${HA_TOKEN}`); },
    });

    expect((await post(base, '/api/admin/ambient-map/location', { source: 'home_assistant' })).status).toBe(202);
    const admin = await waitForState(base, 'error');
    const text = JSON.stringify(admin);
    expect(text).not.toContain(HA_TOKEN);
    expect(text).not.toContain('ECONNREFUSED');
  });
});

describe('Ambient-Map-Sicherheitsgrenzen', () => {
  it('listet nur den Adminpfad als hotel-adminpflichtig', () => {
    expect(hotelAdminOnlyRoute('/api/admin/ambient-map')).toBe(true);
    expect(hotelAdminOnlyRoute('/api/admin/ambient-map/location')).toBe(true);
    expect(hotelAdminOnlyRoute('/api/admin/ambient-map/regenerate')).toBe(true);
    expect(hotelAdminOnlyRoute('/api/ambient-map')).toBe(false);
    expect(hotelAdminOnlyRoute('/assets/ambient-maps/abc.svg')).toBe(false);
  });

  it('gibt dem Hotelgast Status und Asset, aber keinen Adminpfad', async () => {
    const household = {
      ...neutralApartment,
      hotelMode: { ...(neutralApartment as any).hotelMode, enabled: true, kioskAcknowledged: true },
    };
    const { base } = await start({ household });

    // Ohne Adminsitzung ist die Standortwahl gesperrt, der Ambient-Screen nicht.
    expect((await get(base, '/api/admin/ambient-map')).status).toBe(401);
    expect((await post(base, '/api/admin/ambient-map/location', { source: 'manual', latitude: 1, longitude: 2 })).status)
      .toBe(401);
    expect((await get(base, '/api/ambient-map')).status).toBe(200);
    expect((await (await get(base, '/api/ambient-map')).json()).state).toBe('empty');

    await post(base, '/api/hotel-mode/pin', { pin: PIN });
    const unlocked = await post(base, '/api/hotel-mode/unlock', { pin: PIN });
    const cookie = (unlocked.headers.get('set-cookie') || '').split(';')[0];

    expect((await get(base, '/api/admin/ambient-map', { cookie })).status).toBe(200);
    expect((await post(base, '/api/admin/ambient-map/location', {
      source: 'manual', latitude: 49.6069, longitude: 6.5508,
    }, { cookie })).status).toBe(202);
    await waitForState(base, 'ready', cookie);
    expect((await get(base, `/assets/ambient-maps/${SVG_ID}.svg`)).status).toBe(200);
  });

  it('weist fremde Origins auf allen Kartenrouten ab', async () => {
    const { base, renders } = await start();
    const evil = { origin: 'http://evil.fixture' };

    expect((await post(base, '/api/admin/ambient-map/location', { source: 'manual', latitude: 1, longitude: 2 }, evil)).status)
      .toBe(403);
    expect((await post(base, '/api/admin/ambient-map/regenerate', {}, evil)).status).toBe(403);
    expect((await get(base, '/api/ambient-map', evil)).status).toBe(403);
    expect((await get(base, `/assets/ambient-maps/${SVG_ID}.svg`, evil)).status).toBe(403);
    expect(renders).toHaveLength(0);
  });

  it('bleibt bei fehlender Ersteinrichtung fail-closed und fällt nie auf die SPA zurück', async () => {
    const { base } = await start({ withHousehold: false });

    const status = await get(base, '/api/ambient-map');
    expect(status.status).toBe(503);
    expect(await status.json()).toMatchObject({ code: 'SETUP_REQUIRED' });
    expect((await post(base, '/api/admin/ambient-map/location', { source: 'manual', latitude: 1, longitude: 2 })).status)
      .toBe(503);

    const asset = await get(base, `/assets/ambient-maps/${SVG_ID}.svg`);
    expect(asset.status).toBe(503);
    expect(String(asset.headers.get('content-type') ?? '')).not.toContain('text/html');
    expect(await asset.text()).toBe('');
  });

  it('bleibt bei gerissenem Recovery-Latch fail-closed', async () => {
    const { base } = await start({
      overrides: {
        setupConfigRecoveryResult: {
          ok: false,
          code: 'SETUP_CONFIG_RECOVERY_REQUIRED',
          message: 'Eine Setup-Konfigurationstransaktion konnte nicht sicher wiederhergestellt werden.',
        },
      },
    });

    const status = await get(base, '/api/ambient-map');
    expect(status.status).toBe(503);
    expect(await status.json()).toMatchObject({ code: 'SETUP_CONFIG_RECOVERY_REQUIRED' });
    expect((await post(base, '/api/admin/ambient-map/regenerate', {})).status).toBe(503);

    const asset = await get(base, `/assets/ambient-maps/${SVG_ID}.svg`);
    expect(asset.status).toBe(503);
    expect(await asset.text()).toBe('');
  });

  it('bedient ausschließlich die aktuelle Content-Hash-ID und niemals die SPA', async () => {
    const { base } = await start();
    await post(base, '/api/admin/ambient-map/location', { source: 'manual', latitude: 49.6069, longitude: 6.5508 });
    await waitForState(base, 'ready');

    for (const path of [
      `/assets/ambient-maps/${'b'.repeat(64)}.svg`,
      '/assets/ambient-maps/nicht-erlaubt.svg',
      '/assets/ambient-maps/',
      '/assets/ambient-maps',
      `/assets/ambient-maps/%2e%2e%2f${SVG_ID}.svg`,
      `/assets/ambient-maps/${SVG_ID.toUpperCase()}.svg`,
    ]) {
      const response = await get(base, path);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).toBe('');
    }

    expect((await post(base, `/assets/ambient-maps/${SVG_ID}.svg`, {})).status).toBe(405);
    expect((await post(base, '/api/ambient-map', {})).status).toBe(405);
    expect((await get(base, '/api/admin/ambient-map/unbekannt')).status).toBe(404);

    const cached = await get(base, `/assets/ambient-maps/${SVG_ID}.svg`, { 'if-none-match': `"${SVG_ID}"` });
    expect(cached.status).toBe(304);
  });

  it('beendet den Kartendienst beim Schließen des Servers', async () => {
    let closed = 0;
    const { server } = await start({
      overrides: {
        ambientMapService: {
          ready: Promise.resolve(),
          route: async () => false,
          close: async () => { closed += 1; },
        },
      },
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(1);
  });
});
