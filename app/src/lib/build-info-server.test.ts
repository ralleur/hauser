import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
// @ts-expect-error The production server intentionally remains native Node ESM.
import { createHmiServer, readBuildInfo } from '../../server.mjs';

const SHA = 'c'.repeat(40);
const roots: string[] = [];
const servers: Array<{ close: (callback: () => void) => void }> = [];

function householdConfig() {
  return {
    schemaVersion: 3,
    rooms: [{
      id: 'living',
      name: 'Living room',
      visibleEntities: [{ id: 'ceiling', name: 'Ceiling', entityId: 'light.living_ceiling', role: 'light' }],
      hero: null,
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
      laundry: {
        washer: { type: 'entity', entityId: 'input_boolean.washer_done', runningStates: ['on'], doneStates: ['off'], doneOnInitial: false },
        dryer: { type: 'entity', entityId: 'input_boolean.dryer_done', runningStates: ['on'], doneStates: ['off'], doneOnInitial: false },
      },
    },
  };
}

async function startServer(buildInfo: unknown): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), 'hauser-build-info-'));
  roots.push(root);
  const configDir = join(root, 'config');
  const dataDir = join(root, 'data');
  const staticRoot = join(root, 'dist');
  for (const dir of [configDir, dataDir, staticRoot]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
  const householdConfigPath = join(configDir, 'household.json');
  writeFileSync(householdConfigPath, `${JSON.stringify(householdConfig(), null, 2)}\n`);

  const server = createHmiServer('', {
    staticRoot,
    householdConfigPath,
    householdConfigMode: 'active',
    requiredWritableDirs: [configDir, dataDir],
    configPath: join(dataDir, 'config.json'),
    paperlessPin: '',
    paperlessToken: '',
    buildInfo,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('readBuildInfo', () => {
  it('projects the deployment environment onto the public contract', () => {
    expect(readBuildInfo({ version: '0.4.0-beta.6', revision: SHA, sourceUrl: 'https://fork.example/tree/x' }))
      .toEqual({
        version: '0.4.0-beta.6',
        revision: SHA,
        license: 'AGPL-3.0-or-later',
        sourceUrl: 'https://fork.example/tree/x',
      });
  });

  it('never invents a source url from an unusable configuration', () => {
    expect(readBuildInfo({ version: '0.4.0-beta.6', revision: '', sourceUrl: 'ftp://example.com/src' }))
      .toEqual({ version: '0.4.0-beta.6', revision: null, license: 'AGPL-3.0-or-later', sourceUrl: null });
  });

  it('reads the shipped package version by default', () => {
    expect(readBuildInfo({ revision: '', sourceUrl: '' }).version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('GET /api/build-info', () => {
  it('serves license, version, revision and source url without authentication', async () => {
    const port = await startServer(readBuildInfo({
      version: '0.4.0-beta.6',
      revision: SHA,
      sourceUrl: 'https://github.com/example/hauser/tree/' + SHA,
    }));
    const response = await fetch(`http://127.0.0.1:${port}/api/build-info`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: '0.4.0-beta.6',
      revision: SHA,
      license: 'AGPL-3.0-or-later',
      sourceUrl: `https://github.com/example/hauser/tree/${SHA}`,
    });
  });

  it('reports null instead of a fabricated upstream when nothing is configured', async () => {
    const port = await startServer(readBuildInfo({ version: '0.4.0-beta.6', revision: '', sourceUrl: '' }));
    const payload = await (await fetch(`http://127.0.0.1:${port}/api/build-info`)).json();
    expect(payload).toEqual({
      version: '0.4.0-beta.6',
      revision: null,
      license: 'AGPL-3.0-or-later',
      sourceUrl: null,
    });
  });

  it('is read-only', async () => {
    const port = await startServer(readBuildInfo({ version: '0.4.0-beta.6', revision: SHA, sourceUrl: '' }));
    const response = await fetch(`http://127.0.0.1:${port}/api/build-info`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
