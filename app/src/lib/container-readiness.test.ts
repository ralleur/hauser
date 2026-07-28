import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
// @ts-expect-error The production server intentionally remains native Node ESM.
import { assessHmiReadiness, createHmiServer } from '../../server.mjs';

const roots: string[] = [];
const servers: Array<{ close: (callback: () => void) => void }> = [];

function validConfig() {
  return {
    schemaVersion: 1,
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
        schemaVersion: 1,
      },
    });
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

    writeFileSync(files.householdConfigPath, '{"schemaVersion":1,"rooms":[]}');
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
    })).toMatchObject({ payload: { code: 'HOUSEHOLD_CONFIG_NOT_FOUND' } });

    expect(assessHmiReadiness({
      staticRoot: files.staticRoot,
      householdConfigPath: files.householdConfigPath,
      householdConfigMode: 'active',
      requiredWritableDirs: [join(files.root, 'missing-data')],
    })).toMatchObject({ payload: { code: 'RUNTIME_DIRECTORY_NOT_WRITABLE' } });
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
    expect(await response.json()).toMatchObject({ ok: true, status: 'ready', schemaVersion: 1 });

    const head = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    const post = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'POST' });
    expect(post.status).toBe(405);
  });
});
