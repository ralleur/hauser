import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import neutralSmall from '../../config/examples/neutral-small.json';
// @ts-expect-error native .mjs runtime contract
import { createHmiServer } from '../../server.mjs';

/* Energie-Auswahl eines gut vermessenen Hauses (simon42-Forum, Frank: 82
   Leistungssensoren). Die Oberfläche wählt ohne gespeicherten Stand alle
   gefundenen Sensoren vor — passte das nicht durch die Grenze des Servers,
   ließ sich die Seite nie einrichten. */

const servers: any[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ORIGIN = 'http://client.fixture';

async function start() {
  const root = mkdtempSync(join(tmpdir(), 'hauser-energy-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>fixture</title>');
  const configPath = join(root, 'config.json');
  const householdConfigPath = join(root, 'household.json');
  writeFileSync(configPath, JSON.stringify({}));
  writeFileSync(householdConfigPath, JSON.stringify(neutralSmall));

  const server = createHmiServer('', {
    staticRoot,
    configPath,
    householdConfigPath,
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    allowedOrigins: new Set([ORIGIN]),
    paperlessPin: '',
    paperlessToken: '',
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { base, householdConfigPath };
}

async function etagOf(base: string): Promise<string> {
  const response = await fetch(`${base}/api/household-config`, { headers: { accept: 'application/json' } });
  await response.text();
  const etag = response.headers.get('etag');
  expect(etag).toBeTruthy();
  return etag as string;
}

function loads(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    entityId: `sensor.load_${index + 1}`,
    name: `Verbraucher ${index + 1}`,
  }));
}

function putEnergy(base: string, etag: string, body: unknown) {
  return fetch(`${base}/api/household-energy`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': etag, origin: ORIGIN },
    body: JSON.stringify(body),
  });
}

describe('Energie-Auswahl', () => {
  it('speichert 82 Verbraucher — ein gut vermessenes Haus passt durch', async () => {
    const { base, householdConfigPath } = await start();
    const response = await putEnergy(base, await etagOf(base), {
      production: 'sensor.hausanschluss_leistung',
      consumption: loads(82),
    });
    expect(response.status).toBe(200);
    const stored = JSON.parse(readFileSync(householdConfigPath, 'utf8'));
    expect(stored.energy.sensors.consumptionPower).toHaveLength(82);
    expect(stored.energy.sensors.productionPower).toBe('sensor.hausanschluss_leistung');
  });

  it('nennt die Grenze, statt nur „ungültig" zu sagen', async () => {
    const { base } = await start();
    const response = await putEnergy(base, await etagOf(base), {
      production: null,
      consumption: loads(300),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'ENERGY_TOO_MANY_LOADS', max: 256 });
  });
});
