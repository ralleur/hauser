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

/* Raum umbenennen (wie die iOS-App): der Server schreibt den Namen in den
   Haushalt, ETag-gesichert. Stolperfallen: leer, nur Leerzeichen, zu lang,
   unbekannter Raum, veralteter Stand, fremde Herkunft. */

const servers: any[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const ORIGIN = 'http://client.fixture';

async function start() {
  const root = mkdtempSync(join(tmpdir(), 'hauser-room-name-'));
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

function putName(base: string, etag: string, body: unknown, origin = ORIGIN) {
  return fetch(`${base}/api/household-room-name`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': etag, origin },
    body: JSON.stringify(body),
  });
}

describe('Raum umbenennen', () => {
  it('schreibt den Namen getrimmt in den Haushalt', async () => {
    const { base, householdConfigPath } = await start();
    const response = await putName(base, await etagOf(base), { roomId: 'den', name: '  Wohn   zimmer ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, roomId: 'den', name: 'Wohn zimmer' });
    const household = JSON.parse(readFileSync(householdConfigPath, 'utf8'));
    expect(household.rooms.find((room: { id: string }) => room.id === 'den').name).toBe('Wohn zimmer');
  });

  it('weist leere, zu lange und fremde Eingaben ab', async () => {
    const { base } = await start();
    const etag = await etagOf(base);
    for (const body of [{ roomId: 'den', name: '   ' }, { roomId: 'den', name: 'x'.repeat(61) }, { roomId: 'den' }, { name: 'Flur' }, ['den', 'Flur']]) {
      expect((await putName(base, etag, body)).status).toBe(400);
    }
    expect((await putName(base, etag, { roomId: 'gibts-nicht', name: 'Flur' })).status).toBe(404);
    expect((await putName(base, '"veraltet"', { roomId: 'den', name: 'Flur' })).status).toBe(412);
    expect((await putName(base, etag, { roomId: 'den', name: 'Flur' }, 'http://fremd.example')).status).toBe(403);
  });
});
