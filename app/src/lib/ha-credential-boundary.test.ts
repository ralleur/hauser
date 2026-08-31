import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { dirname, join } from 'node:path';
// @ts-expect-error Native Node test without @types/node.
import { fileURLToPath } from 'node:url';
// @ts-expect-error Native Node ESM server contract.
import { createHmiServer, createLaundryHomeAssistantClient, purgeHaCredentialsFromSharedConfig, createCentralConfigStore } from '../../server.mjs';

// @ts-expect-error Native Node test without @types/node.
const env: Record<string, string | undefined> = process.env;

const SUPERVISOR_TOKEN = 'supervisor-token-fixture';
const LEGACY_TOKEN = 'legacy-long-lived-token';

const roots: string[] = [];
const servers: Array<{ close: (cb: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete env.SUPERVISOR_TOKEN;
});

function fixture(withLegacyCredentials = true) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-credential-boundary-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  const dataDir = join(root, 'data');
  mkdirSync(staticRoot);
  mkdirSync(dataDir);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Hauser</title>');
  const configPath = join(dataDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(withLegacyCredentials ? {
    'hmi:backend': 'ha',
    'hmi:ha-url': 'http://homeassistant.local:8123',
    'hmi:ha-token': LEGACY_TOKEN,
    'hmi:library': 'fake',
  } : { 'hmi:backend': 'ha', 'hmi:library': 'fake' }, null, 2));
  return { root, staticRoot, dataDir, configPath, householdConfigPath: join(root, 'household.json') };
}

async function serve(files: ReturnType<typeof fixture>, mode: string) {
  const server = createHmiServer('', {
    staticRoot: files.staticRoot,
    householdConfigPath: files.householdConfigPath,
    householdConfigMode: 'shadow',
    configPath: files.configPath,
    paperlessPin: '',
    paperlessToken: '',
    haConnectionMode: mode,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

describe('Credential-Cutover in /data', () => {
  it('entfernt einen bestehenden Long-Lived Access Token beim ersten App-Start', async () => {
    env.SUPERVISOR_TOKEN = SUPERVISOR_TOKEN;
    const files = fixture();
    await serve(files, 'supervisor');
    const stored = JSON.parse(readFileSync(files.configPath, 'utf8'));
    expect(stored['hmi:ha-token']).toBeUndefined();
    expect(stored['hmi:ha-url']).toBeUndefined();
    /* Andere Werte bleiben unangetastet. */
    expect(stored['hmi:backend']).toBe('ha');
  });

  it('lässt keine Klartext-Sicherungsdatei mit dem alten Token zurück', async () => {
    env.SUPERVISOR_TOKEN = SUPERVISOR_TOKEN;
    const files = fixture();
    await serve(files, 'supervisor');
    for (const entry of readdirSync(files.dataDir)) {
      expect(readFileSync(join(files.dataDir, entry), 'utf8')).not.toContain(LEGACY_TOKEN);
    }
  });

  it('liefert /api/config im App-Modus ohne HA-Zugang aus', async () => {
    env.SUPERVISOR_TOKEN = SUPERVISOR_TOKEN;
    const files = fixture();
    const base = await serve(files, 'supervisor');
    const body = await (await fetch(`${base}/api/config`)).text();
    expect(body).not.toContain(LEGACY_TOKEN);
    expect(body).not.toContain('hmi:ha-token');
    expect(body).not.toContain('hmi:ha-url');
    expect(body).not.toContain(SUPERVISOR_TOKEN);
  });

  it('lässt eine direkte Installation unverändert', async () => {
    const files = fixture();
    const base = await serve(files, 'direct');
    expect(JSON.parse(readFileSync(files.configPath, 'utf8'))['hmi:ha-token']).toBe(LEGACY_TOKEN);
    const body = await (await fetch(`${base}/api/config`)).text();
    expect(body).toContain('hmi:ha-token');
  });

  it('ist idempotent, wenn nichts zu entfernen ist', () => {
    const files = fixture(false);
    const store = createCentralConfigStore(files.configPath);
    expect(purgeHaCredentialsFromSharedConfig(store)).toBe(false);
  });
});

describe('serverseitige Konsumenten im App-Modus', () => {
  it('spricht den internen Core-Präfix an, nicht eine HA-Adresse', async () => {
    const calls: string[] = [];
    const client = createLaundryHomeAssistantClient({
      baseUrl: 'http://supervisor/core/',
      token: SUPERVISOR_TOKEN,
      websocketUrl: 'ws://supervisor/core/websocket',
      fetchImpl: async (url: URL) => {
        calls.push(url.toString());
        return { status: 200, text: async () => '{}' };
      },
    });
    await client.rest('GET', '/api/states/light.kitchen');
    expect(calls).toEqual(['http://supervisor/core/api/states/light.kitchen']);
  });

  it('bleibt im direkten Modus bei der bisherigen Pfadauflösung', async () => {
    const calls: string[] = [];
    const client = createLaundryHomeAssistantClient({
      baseUrl: 'http://homeassistant.local:8123',
      token: 'llat',
      fetchImpl: async (url: URL) => {
        calls.push(url.toString());
        return { status: 200, text: async () => '{}' };
      },
    });
    await client.rest('GET', '/api/states/light.kitchen');
    expect(calls).toEqual(['http://homeassistant.local:8123/api/states/light.kitchen']);
  });
});

describe('Quelltextgrenze', () => {
  const serverSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server.mjs'),
    'utf8',
  );

  it('liest den gespeicherten HA-Zugang nur an einer einzigen Stelle', () => {
    const reads = serverSource.split('\n')
      .map((line: string, index: number) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }: { line: string }) => line.includes("values['hmi:ha-token']")
        || line.includes("values['hmi:ha-url']"));
    expect(reads.map(({ line }: { line: string }) => line)).toEqual([
      "const baseUrl = normalizeSetupHaUrl(values['hmi:ha-url']);",
      "const token = values['hmi:ha-token'];",
      "if (values['hmi:ha-url'] === undefined && values['hmi:ha-token'] === undefined) return false;",
    ]);
  });

  it('persistiert den Supervisor-Token nirgends', () => {
    expect(serverSource).not.toContain("'hmi:supervisor-token'");
    expect(serverSource.includes('SUPERVISOR_TOKEN')).toBe(false);
  });
});
