import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
// @ts-expect-error Native Node ESM Servermodul.
import { createHmiServer, createRoomImageAuthConfig, createRoomImageUploadStore } from '../../server.mjs';

const ORIGIN = 'http://127.0.0.1:4173';
const IDENTITY_HEADER = 'x-hmi-user';
const sandboxes: string[] = [];
const servers: any[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

/* Das Haus startet auch dann, wenn der Jobspeicher des Raumbild-Assistenten
   beim Laden fail-closed abbricht (Produktion 2026-09-06: „Inkohärente
   Room-Image-Jobreferenzen“ hielt das ganze Add-on im Fehlerzustand). */
describe('Server ohne Raumbild-Jobspeicher', () => {
  it('startet, meldet den Grund in der Selbstprüfung und lässt nur den Assistenten aus', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'hauser-store-degraded-'));
    sandboxes.push(sandbox);
    const staticRoot = join(sandbox, 'dist');
    mkdirSync(staticRoot);
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
    const failure = Object.assign(
      new Error('Inkohärente Room-Image-Jobreferenzen: abc (variant_parent)'),
      { code: 'ROOM_IMAGE_STORE_INVALID' },
    );
    let attempts = 0;
    const server = createHmiServer('', {
      staticRoot,
      paperlessPin: '', paperlessToken: '',
      allowedOrigins: new Set([ORIGIN]),
      roomImageAuthConfig: createRoomImageAuthConfig({
        mode: 'trusted_proxy', trustedProxyCidrs: '127.0.0.1/32', identityHeader: IDENTITY_HEADER,
      }),
      roomImageUploadStore: createRoomImageUploadStore({ root: join(sandbox, 'uploads') }),
      roomImageJobRoot: join(sandbox, 'jobs'),
      roomImageJobStoreFactory: () => { attempts += 1; throw failure; },
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    expect(attempts).toBe(1);

    const health = await (await fetch(`${base}/api/health`)).json();
    expect(health.selfCheck.ok).toBe(false);
    expect(health.selfCheck.roomImageJobStore).toEqual({ ok: false, code: 'ROOM_IMAGE_STORE_INVALID' });
    expect(JSON.stringify(health)).not.toContain('variant_parent');

    const job = await fetch(`${base}/api/room-image-jobs/${'j'.repeat(43)}`, {
      headers: { [IDENTITY_HEADER]: 'fixture-user', origin: ORIGIN },
    });
    expect(job.status).toBe(503);
    expect((await job.json()).code).toBe('ROOM_IMAGE_STORE_INVALID');

    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
  });
});
