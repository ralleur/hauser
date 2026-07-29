import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
// @ts-expect-error The production server intentionally remains native Node ESM.
import { assessHmiReadiness, createHmiServer, migrateHouseholdConfigFile, verifySetupHomeAssistant, verifySetupJellyfin } from '../../server.mjs';

const roots: string[] = [];
const servers: Array<{ close: (callback: () => void) => void }> = [];

function validConfig() {
  return {
    schemaVersion: 2,
    rooms: [{
      id: 'living',
      name: 'Living room',
      visibleEntities: [{ id: 'ceiling', name: 'Ceiling', entityId: 'light.living_ceiling', role: 'light' }],
    }],
    navigation: [
      { id: 'home', name: 'Home', order: 0, target: { type: 'module', id: 'home' } },
      { id: 'system', name: 'System', order: 1, target: { type: 'module', id: 'system' } },
    ],
    enabledModules: ['home', 'system'],
    energy: null,
    mediaTargets: [],
    globalEntities: {
      sun: 'sun.sun',
      vacationMode: 'switch.vacation_mode',
      homeOffScript: 'script.home_off',
      laundry: { washer: 'input_boolean.washer_done', dryer: 'input_boolean.dryer_done' },
    },
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hauser-readiness-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  const configDir = join(root, 'config');
  const dataDir = join(root, 'data');
  const assetsDir = join(root, 'assets');
  mkdirSync(staticRoot);
  mkdirSync(configDir);
  mkdirSync(dataDir);
  mkdirSync(assetsDir);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Hauser</title>');
  const householdConfigPath = join(configDir, 'household.json');
  writeFileSync(householdConfigPath, `${JSON.stringify(validConfig(), null, 2)}\n`);
  return { root, staticRoot, configDir, dataDir, assetsDir, householdConfigPath };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('household config file migration', () => {
  it('backs up the exact v1 bytes before atomically activating validated v2', () => {
    const files = fixture();
    const legacy = { ...validConfig(), schemaVersion: 1 };
    const original = JSON.stringify(legacy);
    writeFileSync(files.householdConfigPath, original, { mode: 0o640 });

    const result = migrateHouseholdConfigFile(files.householdConfigPath, {
      now: () => new Date('2026-07-29T09:45:00.000Z'),
    });

    expect(result).toEqual({
      ok: true,
      status: 'migrated',
      fromVersion: 1,
      toVersion: 2,
      backupPath: `${files.householdConfigPath}.backup-v1-20260729T094500000Z`,
    });
    expect(readFileSync(result.backupPath, 'utf8')).toBe(original);
    expect(statSync(result.backupPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(files.householdConfigPath, 'utf8'))).toEqual(validConfig());
    expect(statSync(files.householdConfigPath).mode & 0o777).toBe(0o600);

    expect(migrateHouseholdConfigFile(files.householdConfigPath)).toEqual({
      ok: true,
      status: 'current',
      version: 2,
    });
    expect(readdirSync(files.configDir).filter((name: string) => name.includes('.backup-'))).toHaveLength(1);
  });

  it('does not back up or replace a v1 document that fails current validation', () => {
    const files = fixture();
    const invalid = JSON.stringify({ ...validConfig(), schemaVersion: 1, globalEntities: null });
    writeFileSync(files.householdConfigPath, invalid);

    expect(migrateHouseholdConfigFile(files.householdConfigPath)).toMatchObject({
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_INVALID',
      issue: { code: 'TYPE_MISMATCH' },
    });
    expect(readFileSync(files.householdConfigPath, 'utf8')).toBe(invalid);
    expect(readdirSync(files.configDir).filter((name: string) => name.includes('.backup-'))).toEqual([]);
  });

  it('preserves the original when final activation fails after a successful backup', () => {
    const files = fixture();
    const original = JSON.stringify({ ...validConfig(), schemaVersion: 1 });
    writeFileSync(files.householdConfigPath, original);

    const result = migrateHouseholdConfigFile(files.householdConfigPath, {
      now: () => new Date('2026-07-29T09:46:00.000Z'),
      replaceConfig: () => { throw new Error('injected rename failure'); },
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_WRITE_FAILED',
      backupPath: `${files.householdConfigPath}.backup-v1-20260729T094600000Z`,
    });
    expect(readFileSync(files.householdConfigPath, 'utf8')).toBe(original);
    expect(readFileSync(result.backupPath, 'utf8')).toBe(original);
    expect(readdirSync(files.configDir).some((name: string) => name.endsWith('.migration.tmp'))).toBe(false);
  });
});

describe('container readiness contract', () => {
  it('requires the built app, a valid active household config and writable runtime directories', () => {
    const files = fixture();
    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [files.configDir, files.dataDir, files.assetsDir],
    })).toEqual({
      ok: true,
      status: 200,
      payload: {
        ok: true,
        status: 'ready',
        householdConfigMode: 'active',
        schemaVersion: 2,
      },
    });
  });

  it('migrates v1 once at active server startup and exposes ready only after v2 is active', async () => {
    const files = fixture();
    const original = JSON.stringify({ ...validConfig(), schemaVersion: 1 });
    writeFileSync(files.householdConfigPath, original);
    const server = createHmiServer('', {
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [files.configDir, files.dataDir, files.assetsDir],
      configPath: join(files.dataDir, 'config.json'),
      paperlessPin: '',
      paperlessToken: '',
    });
    servers.push(server);

    expect(JSON.parse(readFileSync(files.householdConfigPath, 'utf8'))).toEqual(validConfig());
    const backups = readdirSync(files.configDir).filter((name: string) => name.includes('.backup-v1-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(files.configDir, backups[0]), 'utf8')).toBe(original);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ready', schemaVersion: 2 });
  });

  it('keeps invalid migrated input byte-identical and exposes only a not-ready server', async () => {
    const files = fixture();
    const original = JSON.stringify({ ...validConfig(), schemaVersion: 1, globalEntities: null });
    writeFileSync(files.householdConfigPath, original);
    const server = createHmiServer('', {
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [files.configDir, files.dataDir, files.assetsDir],
      configPath: join(files.dataDir, 'config.json'),
      paperlessPin: '',
      paperlessToken: '',
    });
    servers.push(server);

    expect(readFileSync(files.householdConfigPath, 'utf8')).toBe(original);
    expect(readdirSync(files.configDir).filter((name: string) => name.includes('.backup-'))).toEqual([]);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({
      status: 'not_ready',
      code: 'HOUSEHOLD_CONFIG_MIGRATION_INVALID',
    });
    const config = await fetch(`http://127.0.0.1:${port}/api/config`);
    expect(config.status).toBe(503);
    expect(await config.json()).toMatchObject({ code: 'HOUSEHOLD_CONFIG_MIGRATION_INVALID' });
  });

  it('fails closed with a stable code for invalid JSON and invalid schema data', () => {
    const files = fixture();
    writeFileSync(files.householdConfigPath, '{not-json');
    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
    })).toMatchObject({
      ok: false,
      status: 503,
      payload: { code: 'HOUSEHOLD_CONFIG_INVALID_JSON' },
    });

    writeFileSync(files.householdConfigPath, '{"schemaVersion":2,"rooms":[]}');
    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
    })).toMatchObject({
      ok: false,
      status: 503,
      payload: {
        code: 'HOUSEHOLD_CONFIG_INVALID',
        issue: { path: '$.navigation', code: 'REQUIRED' },
      },
    });
  });

  it('rejects schema-valid data that the productive shell cannot project', () => {
    const files = fixture();
    const config = validConfig();
    config.navigation[1].order = 2;
    config.navigation.splice(1, 0, {
      id: 'living', name: 'Living room', order: 1, target: { type: 'room', id: 'living' },
    });
    writeFileSync(files.householdConfigPath, `${JSON.stringify(config)}\n`);

    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
    })).toMatchObject({
      ok: false,
      status: 503,
      payload: { code: 'HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION' },
    });
  });

  it('distinguishes missing bundle, missing config and unwritable runtime state', () => {
    const files = fixture();
    rmSync(join(files.staticRoot, 'index.html'));
    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
    })).toMatchObject({ payload: { code: 'APP_BUNDLE_NOT_FOUND' } });

    writeFileSync(join(files.staticRoot, 'index.html'), '<!doctype html>');
    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: join(files.configDir, 'missing.json'),
      householdConfigMode: 'active',
    })).toMatchObject({ payload: { status: 'setup_required', schemaVersion: null } });

    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [join(files.root, 'missing-data')],
    })).toMatchObject({ payload: { code: 'RUNTIME_DIRECTORY_NOT_WRITABLE' } });
  });

  it('starts a restricted setup runtime only when the configured active file is absent', async () => {
    const files = fixture();
    rmSync(files.householdConfigPath);
    const centralConfigPath = join(files.dataDir, 'config.json');
    const options = {
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [files.configDir, files.dataDir, files.assetsDir],
    };

    expect(assessHmiReadiness(options)).toEqual({
      ok: true,
      status: 200,
      payload: {
        ok: true,
        status: 'setup_required',
        householdConfigMode: 'active',
        schemaVersion: null,
      },
    });

    const server = createHmiServer('', {
      ...options,
      configPath: centralConfigPath,
      paperlessPin: '',
      paperlessToken: '',
      setupConnectionVerifier: async () => ({ ok: true }),
      setupJellyfinVerifier: async () => ({ ok: true }),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const blocked = await fetch(`http://127.0.0.1:${port}/api/config`);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ code: 'SETUP_REQUIRED' });

    const invalid = await fetch(`http://127.0.0.1:${port}/api/setup/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ haUrl: 'file:///tmp/ha', haToken: 'secret', householdConfig: {} }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'SETUP_INVALID_HOME_ASSISTANT_URL' });

    const activated = await fetch(`http://127.0.0.1:${port}/api/setup/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        haUrl: 'http://homeassistant.local:8123/',
        haToken: 'setup-token',
        householdConfig: validConfig(),
        jellyfin: {
          enabled: true,
          url: 'http://jellyfin.local:8096/',
          accessToken: 'jellyfin-token',
          userId: 'jellyfin-user',
        },
      }),
    });
    expect(activated.status).toBe(201);
    expect(await activated.json()).toEqual({ ok: true, status: 'activated', schemaVersion: 2 });
    expect(JSON.parse(readFileSync(files.householdConfigPath, 'utf8'))).toEqual(validConfig());
    expect(statSync(files.householdConfigPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(centralConfigPath, 'utf8'))).toMatchObject({
      'hmi:backend': 'ha',
      'hmi:ha-url': 'http://homeassistant.local:8123',
      'hmi:ha-token': 'setup-token',
      'hmi:jf-url': 'http://jellyfin.local:8096',
      'hmi:jf-token': 'jellyfin-token',
      'hmi:jf-user': 'jellyfin-user',
      'hmi:library': 'live',
    });

    const ready = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await ready.json()).toMatchObject({ status: 'ready', schemaVersion: 2 });
  });

  it('reconfigures an active installation atomically without deleting the current setup', async () => {
    const files = fixture();
    const centralConfigPath = join(files.dataDir, 'config.json');
    writeFileSync(centralConfigPath, `${JSON.stringify({
      'hmi:backend': 'ha',
      'hmi:ha-url': 'http://old-home-assistant.local:8123',
      'hmi:ha-token': 'old-token',
      'hmi:jf-url': 'http://old-jellyfin.local:8096',
      'hmi:jf-token': 'old-jellyfin-token',
      'hmi:jf-user': 'old-jellyfin-user',
      'hmi:library': 'live',
    }, null, 2)}\n`, { mode: 0o600 });
    const verified: Array<{ haUrl: string; haToken: string }> = [];
    const server = createHmiServer('', {
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [files.configDir, files.dataDir, files.assetsDir],
      configPath: centralConfigPath,
      paperlessPin: '',
      paperlessToken: '',
      setupConnectionVerifier: async (haUrl: string, haToken: string) => {
        verified.push({ haUrl, haToken });
        return { ok: true };
      },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const invalid = await fetch(`http://127.0.0.1:${port}/api/setup/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ haUrl: 'file:///tmp/ha', haToken: 'new-token', householdConfig: {} }),
    });
    expect(invalid.status).toBe(400);
    expect(JSON.parse(readFileSync(files.householdConfigPath, 'utf8'))).toEqual(validConfig());
    expect(JSON.parse(readFileSync(centralConfigPath, 'utf8'))['hmi:ha-token']).toBe('old-token');

    const replacement = validConfig();
    replacement.rooms[0].name = 'Updated living room';
    const activated = await fetch(`http://127.0.0.1:${port}/api/setup/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        haUrl: 'http://new-home-assistant.local:8123/',
        haToken: 'new-token',
        householdConfig: replacement,
        jellyfin: { enabled: false },
      }),
    });
    expect(activated.status).toBe(200);
    expect(await activated.json()).toEqual({ ok: true, status: 'reconfigured', schemaVersion: 2 });
    expect(verified).toEqual([{
      haUrl: 'http://new-home-assistant.local:8123',
      haToken: 'new-token',
    }]);
    expect(JSON.parse(readFileSync(files.householdConfigPath, 'utf8'))).toEqual(replacement);
    expect(JSON.parse(readFileSync(centralConfigPath, 'utf8'))).toMatchObject({
      'hmi:backend': 'ha',
      'hmi:ha-url': 'http://new-home-assistant.local:8123',
      'hmi:ha-token': 'new-token',
      'hmi:library': 'fake',
    });
    const reconfiguredValues = JSON.parse(readFileSync(centralConfigPath, 'utf8'));
    expect(reconfiguredValues['hmi:jf-url']).toBeUndefined();
    expect(reconfiguredValues['hmi:jf-token']).toBeUndefined();
    expect(reconfiguredValues['hmi:jf-user']).toBeUndefined();
  });

  it('requires the Hauser server itself to reach and authenticate with Home Assistant', async () => {
    const requested: Array<{ url: string; authorization: string | null }> = [];
    const rejected = await verifySetupHomeAssistant(
      'http://homeassistant.local:8123',
      'setup-token',
      async (url: string, init: RequestInit) => {
        requested.push({
          url,
          authorization: new Headers(init.headers).get('authorization'),
        });
        return new Response(null, { status: 401 });
      },
    );

    expect(requested).toEqual([{
      url: 'http://homeassistant.local:8123/api/config',
      authorization: 'Bearer setup-token',
    }]);
    expect(rejected).toEqual({
      ok: false,
      code: 'SETUP_HOME_ASSISTANT_AUTH_FAILED',
      message: 'Home Assistant hat den Token abgelehnt.',
    });
  });

  it('requires the Hauser server itself to reach the authenticated Jellyfin user', async () => {
    const requested: Array<{ url: string; token: string | null }> = [];
    const accepted = await verifySetupJellyfin(
      'http://jellyfin.local:8096',
      'jellyfin-token',
      'jellyfin-user',
      async (url: string, init: RequestInit) => {
        requested.push({
          url,
          token: new Headers(init.headers).get('x-emby-token'),
        });
        return new Response('{}', { status: 200 });
      },
    );

    expect(requested).toEqual([{
      url: 'http://jellyfin.local:8096/Users/jellyfin-user',
      token: 'jellyfin-token',
    }]);
    expect(accepted).toEqual({ ok: true });
  });

  it('does not require household config in explicit shadow mode', () => {
    const files = fixture();
    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: null,
      householdConfigMode: 'shadow',
    })).toMatchObject({
      ok: true,
      payload: { status: 'ready', householdConfigMode: 'shadow', schemaVersion: null },
    });
  });

  it('exposes readiness over an origin-independent GET/HEAD endpoint', async () => {
    const files = fixture();
    const server = createHmiServer('', {
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [files.configDir, files.dataDir, files.assetsDir],
      paperlessPin: '',
      paperlessToken: '',
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { origin: 'https://untrusted.example' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: 'ready', schemaVersion: 2 });

    const head = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const post = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'POST' });
    expect(post.status).toBe(405);
  });
});
