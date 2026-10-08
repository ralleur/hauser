import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { gzipSync } from 'node:zlib';
// @ts-expect-error Native Node ESM Servermodul.
import { createHmiServer } from '../../server.mjs';

const sandboxes: string[] = [];
const servers: any[] = [];
const SET_ID = 'a'.repeat(43);
const household = readFileSync(new URL('../../config/examples/neutral-apartment.json', import.meta.url), 'utf8');

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

/* Ein Haus auf eigenen Pfaden; `restarts` zählt, wie oft der Server nach dem
   Wiederherstellen neu starten wollte. */
async function house(seed: (root: string) => void = () => undefined) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-backup-'));
  sandboxes.push(root);
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html>');
  mkdirSync(join(root, 'assets'));
  seed(root);
  const restarts: number[] = [];
  const server = createHmiServer('', {
    staticRoot: join(root, 'dist'),
    configPath: join(root, 'config.json'),
    householdConfigPath: join(root, 'household.json'),
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    familyDataPath: join(root, 'family-data.json'),
    notificationRulesPath: join(root, 'notification-rules.json'),
    momentsStatePath: join(root, 'moments-state.json'),
    roomImageAssetRoot: join(root, 'assets'),
    roomImageAssetStore: { cleanupOrphans() {}, recoveryState() { return { type: 'none' }; } },
    allowedOrigins: new Set<string>(),
    paperlessPin: '',
    paperlessToken: '',
    requestRestart: () => restarts.push(Date.now()),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { root, restarts, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

describe('Sichern und Wiederherstellen', () => {
  it('nimmt Haushalt, Einstellungen, Familiendaten und Raumbilder mit, Zugangsdaten nicht, und setzt sie anderswo wieder ein', async () => {
    const source = await house((root) => {
      writeFileSync(join(root, 'household.json'), household);
      writeFileSync(join(root, 'config.json'), JSON.stringify({
        'hmi:ha-url': 'http://alt.fixture', 'hmi:ha-token': 'alt-geheim', 'hmi:scene-config:v1': '{"szene":1}',
      }));
      writeFileSync(join(root, 'family-data.json'), '{"version":1,"reminders":[],"shopping":[]}');
      mkdirSync(join(root, 'room-images'));
      writeFileSync(join(root, 'room-images', 'assets.json'), '{"version":1,"assets":[]}');
      mkdirSync(join(root, 'assets', 'room-images', SET_ID), { recursive: true });
      writeFileSync(join(root, 'assets', 'room-images', SET_ID, 'light.avif'), 'BILD');
    });

    const download = await fetch(`${source.base}/api/backup`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toMatch(/hauser-sicherung-\d{4}-\d{2}-\d{2}\.hauser/);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).not.toContain('alt-geheim');

    const target = await house((root) => {
      writeFileSync(join(root, 'household.json'), household);
      writeFileSync(join(root, 'config.json'), JSON.stringify({ 'hmi:ha-url': 'http://neu.fixture', 'hmi:ha-token': 'neu-geheim' }));
      writeFileSync(join(root, 'notification-rules.json'), '{"rules":[]}');
      mkdirSync(join(root, 'assets', 'room-images', 'b'.repeat(43)), { recursive: true });
    });
    const restore = await fetch(`${target.base}/api/backup/restore`, { method: 'POST', body: bytes });
    expect(restore.status).toBe(200);
    expect(await restore.json()).toMatchObject({ ok: true, restarting: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.restarts).toHaveLength(1);

    const config = JSON.parse(readFileSync(join(target.root, 'config.json'), 'utf8'));
    expect(config).toEqual({ 'hmi:scene-config:v1': '{"szene":1}', 'hmi:ha-url': 'http://neu.fixture', 'hmi:ha-token': 'neu-geheim' });
    expect(readFileSync(join(target.root, 'family-data.json'), 'utf8')).toContain('reminders');
    expect(existsSync(join(target.root, 'notification-rules.json'))).toBe(false);
    expect(readFileSync(join(target.root, 'assets', 'room-images', SET_ID, 'light.avif'), 'utf8')).toBe('BILD');
    expect(readdirSync(join(target.root, 'assets', 'room-images'))).toEqual([SET_ID]);
    expect(readFileSync(join(target.root, 'room-images', 'assets.json'), 'utf8')).toContain('assets');
    expect(readdirSync(join(target.root, 'backups')).some((name: string) => name.startsWith('vor-wiederherstellung-'))).toBe(true);
  });

  it('weist fremde und beschädigte Dateien ab, bevor etwas geschrieben wird', async () => {
    const target = await house((root) => writeFileSync(join(root, 'household.json'), household));
    const foreign = await fetch(`${target.base}/api/backup/restore`, { method: 'POST', body: new TextEncoder().encode('kein gzip') });
    expect(foreign.status).toBe(400);
    const broken = gzipSync(JSON.stringify({ format: 'hauser-backup', version: 1, household: '{"rooms":"kaputt"}' }));
    const response = await fetch(`${target.base}/api/backup/restore`, { method: 'POST', body: broken });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BACKUP_INVALID');
    const traversal = gzipSync(JSON.stringify({
      format: 'hauser-backup', version: 1, household, roomImages: { files: { '../../evil/light.avif': 'AA==' } },
    }));
    expect((await fetch(`${target.base}/api/backup/restore`, { method: 'POST', body: traversal })).status).toBe(400);
    expect(readFileSync(join(target.root, 'household.json'), 'utf8')).toBe(household);
    expect(existsSync(join(target.root, 'backups'))).toBe(false);
    expect(target.restarts).toHaveLength(0);
  });
});
