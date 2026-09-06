import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
// @ts-expect-error Native Node ESM Servermodul.
import { createHmiServer } from '../../server.mjs';

const sandboxes: string[] = [];
const servers: any[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

/* Rollup benennt geteilte Chunks nach ihrem Modulordner: `room-images-<hash>.js`
   liegt neben den Raumbild-Assets unter `/assets/`. Die Assetroute darf nur
   den Ordner `/assets/room-images/` beanspruchen (Produktion 0.8.1: das
   Raum-Overlay lud nicht, weil sein Chunk mit 404 beantwortet wurde). */
describe('Bundle-Chunks neben der Raumbild-Assetroute', () => {
  it('liefert room-images-<hash>-Chunks statisch aus und hält die Assetroute auf den Ordner', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'hauser-assets-prefix-'));
    sandboxes.push(sandbox);
    const staticRoot = join(sandbox, 'dist');
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html>');
    writeFileSync(join(staticRoot, 'assets', 'room-images-B0AOxNw-.js'), 'export const chunk = 1;');
    writeFileSync(join(staticRoot, 'assets', 'room-images-CKzqIumf.css'), '.re{color:red}');
    const server = createHmiServer('', { staticRoot, paperlessPin: '', paperlessToken: '' });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const script = await fetch(`${base}/assets/room-images-B0AOxNw-.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain('chunk');
    expect((await fetch(`${base}/assets/room-images-CKzqIumf.css`)).status).toBe(200);
    const asset = await fetch(`${base}/assets/room-images/${'a'.repeat(43)}/light.avif`);
    expect(asset.status).toBe(404);
    expect((await asset.json()).code).toBe('ASSET_NOT_FOUND');
  });
});
