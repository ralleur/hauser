import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
// @ts-expect-error The production server intentionally remains native Node ESM.
import { createHmiServer } from '../../server.mjs';

const roots: string[] = [];
const servers: Array<{ close: (callback: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function validConfig() {
  return {
    schemaVersion: 4,
    rooms: [{
      id: 'living',
      name: 'Living room',
      visibleEntities: [{ id: 'ceiling', name: 'Ceiling', entityId: 'light.living_ceiling', role: 'light' }],
      hero: null,
    }],
    navigation: [
      { id: 'home', name: 'Home', order: 0, target: { type: 'module', id: 'home' } },
      { id: 'calendar', name: 'Calendar', order: 1, target: { type: 'module', id: 'calendar' } },
      { id: 'notes', name: 'Notes', order: 2, target: { type: 'module', id: 'notes' } },
      { id: 'system', name: 'System', order: 3, target: { type: 'module', id: 'system' } },
    ],
    enabledModules: ['home', 'calendar', 'notes', 'system'],
    energy: null,
    mediaTargets: [],
    globalEntities: {
      sun: 'sun.sun',
      vacationMode: 'switch.vacation_mode',
      homeOffScript: 'script.home_off',
      laundry: {
        washer: {
          type: 'entity',
          entityId: 'input_boolean.washer_done',
          runningStates: ['on'],
          doneStates: ['off'],
          doneOnInitial: false,
        },
        dryer: {
          type: 'entity',
          entityId: 'input_boolean.dryer_done',
          runningStates: ['on'],
          doneStates: ['off'],
          doneOnInitial: false,
        },
      },
    },
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hauser-supervisor-setup-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  const configDir = join(root, 'config');
  const dataDir = join(root, 'data');
  mkdirSync(staticRoot);
  mkdirSync(configDir);
  mkdirSync(dataDir);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Hauser</title>');
  return {
    staticRoot,
    householdConfigPath: join(configDir, 'household.json'),
    configPath: join(dataDir, 'config.json'),
  };
}

const SNAPSHOT = {
  states: [{ entity_id: 'light.living_ceiling', attributes: { friendly_name: 'Ceiling' } }],
  areas: [{ area_id: 'living', name: 'Living room' }],
  devices: [{ id: 'device-1', area_id: 'living' }],
  entities: [{ entity_id: 'light.living_ceiling', area_id: 'living', device_id: 'device-1' }],
};

function fakeSupervisorClient({ available = true, fail = null as string | null } = {}) {
  const closed: boolean[] = [];
  const factory = () => ({
    available,
    close: () => closed.push(true),
    rest: async (_method: string, path: string) => {
      if (fail) throw Object.assign(new Error('internal access rejected'), { code: fail, status: 502 });
      if (path === '/api/states') return { status: 200, body: SNAPSHOT.states };
      return { status: 200, body: { version: '2026.8.0' } };
    },
    ws: async (type: string) => {
      if (fail) throw Object.assign(new Error('internal access rejected'), { code: fail, status: 502 });
      if (type === 'config/area_registry/list') return SNAPSHOT.areas;
      if (type === 'config/device_registry/list') return SNAPSHOT.devices;
      return SNAPSHOT.entities;
    },
  });
  return Object.assign(factory, { closed });
}

async function serve(overrides: Record<string, unknown> = {}) {
  const files = fixture();
  const server = createHmiServer('', {
    staticRoot: files.staticRoot,
    householdConfigPath: files.householdConfigPath,
    householdConfigMode: 'active',
    configPath: files.configPath,
    paperlessPin: '',
    paperlessToken: '',
    setupJellyfinVerifier: async () => ({ ok: true }),
    ...overrides,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { ...files, base: `http://127.0.0.1:${port}` };
}

describe('Setup-Auskunft über die Betriebsart', () => {
  it('verlangt im direkten Modus weiterhin Credentials', async () => {
    const { base } = await serve({ haConnectionMode: 'direct' });
    const response = await fetch(`${base}/api/ha/connection`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, mode: 'direct', credentialsRequired: true, available: true, gatewayPath: null,
    });
  });

  it('meldet im App-Modus, dass keine Credentials erfragt werden', async () => {
    const { base } = await serve({
      haConnectionMode: 'supervisor',
      haSupervisorClientFactory: fakeSupervisorClient(),
    });
    expect(await (await fetch(`${base}/api/ha/connection`)).json()).toEqual({
      ok: true,
      mode: 'supervisor',
      credentialsRequired: false,
      available: true,
      gatewayPath: '/api/websocket',
    });
  });

  it('meldet einen fehlenden internen Zugang statt still auf Credentials zurückzufallen', async () => {
    const { base } = await serve({
      haConnectionMode: 'supervisor',
      haSupervisorClientFactory: fakeSupervisorClient({ available: false }),
    });
    expect(await (await fetch(`${base}/api/ha/connection`)).json()).toMatchObject({
      mode: 'supervisor', credentialsRequired: false, available: false,
    });
  });
});

describe('tokenlose Entdeckung', () => {
  it('liefert Areas, Geräte, Entitäten und States über den internen Zugang', async () => {
    const factory = fakeSupervisorClient();
    const { base } = await serve({ haConnectionMode: 'supervisor', haSupervisorClientFactory: factory });
    const response = await fetch(`${base}/api/setup/discovery`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, ...SNAPSHOT });
    expect(factory.closed).toHaveLength(1);
  });

  it('gibt es im direkten Modus nicht', async () => {
    const { base } = await serve({ haConnectionMode: 'direct' });
    const response = await fetch(`${base}/api/setup/discovery`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'SETUP_DISCOVERY_NOT_AVAILABLE' });
  });

  it('reicht den konkreten Fehler des internen Zugangs durch', async () => {
    const { base } = await serve({
      haConnectionMode: 'supervisor',
      haSupervisorClientFactory: fakeSupervisorClient({ fail: 'HA_SUPERVISOR_TOKEN_MISSING' }),
    });
    const response = await fetch(`${base}/api/setup/discovery`);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'HA_SUPERVISOR_TOKEN_MISSING' });
  });
});

describe('Aktivierung im App-Modus', () => {
  it('aktiviert ohne HA-Adresse und ohne Token und schreibt keine HA-Credentials', async () => {
    const factory = fakeSupervisorClient();
    const { base, householdConfigPath, configPath } = await serve({
      haConnectionMode: 'supervisor',
      haSupervisorClientFactory: factory,
    });
    const response = await fetch(`${base}/api/setup/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdConfig: validConfig(), jellyfin: { enabled: false } }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, status: 'activated', schemaVersion: 4 });
    expect(existsSync(householdConfigPath)).toBe(true);
    const shared = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(shared['hmi:backend']).toBe('ha');
    expect(shared['hmi:ha-url']).toBeUndefined();
    expect(shared['hmi:ha-token']).toBeUndefined();
    expect(JSON.stringify(shared)).not.toContain('ha-token');
  });

  it('lehnt mitgeschickte Credentials ab statt sie zu ignorieren', async () => {
    const { base } = await serve({
      haConnectionMode: 'supervisor',
      haSupervisorClientFactory: fakeSupervisorClient(),
    });
    for (const credentials of [
      { haUrl: 'http://homeassistant.local:8123' },
      { haToken: 'llat-secret' },
      { haUrl: 'http://homeassistant.local:8123', haToken: 'llat-secret' },
    ]) {
      const response = await fetch(`${base}/api/setup/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials, householdConfig: validConfig(), jellyfin: { enabled: false } }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'SETUP_CREDENTIALS_NOT_ALLOWED' });
    }
  });

  it('aktiviert nicht, wenn der interne Zugang die Prüfung ablehnt', async () => {
    const { base, householdConfigPath } = await serve({
      haConnectionMode: 'supervisor',
      haSupervisorClientFactory: fakeSupervisorClient({ fail: 'HA_SUPERVISOR_AUTH_FAILED' }),
    });
    const response = await fetch(`${base}/api/setup/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ householdConfig: validConfig(), jellyfin: { enabled: false } }),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'HA_SUPERVISOR_AUTH_FAILED' });
    expect(existsSync(householdConfigPath)).toBe(false);
  });
});
