import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
import sharp from 'sharp';
// @ts-expect-error Native Node ESM server contract.
import { createRoomImageAssetStore } from '../../../server.mjs';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { deriveOvercastVariant } from '../../../server/room-image-overcast-service.mjs';

/* Paket 13: Die ganze Kette der trüben Variante mit echten Bildern — nur der
   Modellaufruf ist ersetzt. Genau hier wäre der erste Live-Versuch aufgelaufen:
   die Eingabe für den Anbieter entsteht aus dem fertigen AVIF des Bildsets,
   nicht aus einem Quell-PNG. */

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): { assetRoot: string; setsRoot: string; catalogPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'hmi-overcast-chain-'));
  sandboxes.push(root);
  const assetRoot = join(root, 'assets');
  mkdirSync(join(assetRoot, 'room-images'), { recursive: true });
  mkdirSync(join(root, 'config', 'room-images'), { recursive: true });
  return {
    assetRoot,
    setsRoot: join(assetRoot, 'room-images'),
    catalogPath: join(root, 'config', 'room-images', 'assets.json'),
  };
}

/* Klein gehalten: die Politik prüft Format und Maße, nicht den Inhalt. */
async function avif(r: number, g: number, b: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width: 424, height: 300, channels: 3, background: { r, g, b } },
  }).avif({ quality: 50 }).toBuffer());
}

async function png(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width: 424, height: 300, channels: 3, background: { r: 150, g: 160, b: 170 } },
  }).png().toBuffer());
}

const FOCUS = { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } };

describe('Kette der trüben Variante mit echten Bildern', () => {
  it('führt Tagbild → Anbietereingabe → AVIF → Bildset durch', async () => {
    const { assetRoot, setsRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.publish('probe_set', FOCUS, {
      light: await avif(220, 210, 190),
      dark: await avif(40, 45, 60),
      darkOff: await avif(18, 20, 28),
      phoneLight: await avif(220, 210, 190),
      phoneDark: await avif(40, 45, 60),
      phoneDarkOff: await avif(20, 22, 30),
    });

    const seen: { phase: string; input: Uint8Array; prompt: string }[] = [];
    const provider = {
      available: true,
      async edit({ phase, input, prompt }: { phase: string; input: Uint8Array; prompt: string }) {
        seen.push({ phase, input, prompt });
        return { image: await png() };
      },
    };

    const result = await deriveOvercastVariant('probe_set', { assetStore: store, provider });
    expect(result).toMatchObject({ ok: true, status: 'written' });

    // Der Anbieter bekam ein JPEG in Zielgröße und den Overcast-Prompt.
    expect(seen).toHaveLength(1);
    // @ts-expect-error Native Node test without @types/node.
    const metadata = await sharp(Buffer.from(seen[0].input)).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(3392);
    expect(seen[0].prompt).toContain('overcast sky');

    // Das Ergebnis liegt als AVIF im Bildset und der Katalog bleibt gültig.
    const written = readdirSync(join(setsRoot, 'probe_set')).sort();
    expect(written).toContain('overcast.avif');
    expect(store.status('probe_set')).toBe('complete');
    const listed = store.list()[0];
    expect(listed.variants.overcast).toBe('/assets/room-images/probe_set/overcast.avif');

    const variant = await sharp(join(setsRoot, 'probe_set', 'overcast.avif')).metadata();
    expect(variant.mediaType).toBe('image/avif');
  });

  it('lässt das Bildset unverändert, wenn der Anbieter Unsinn liefert', async () => {
    const { assetRoot, setsRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.publish('probe_set', FOCUS, {
      light: await avif(220, 210, 190),
      dark: await avif(40, 45, 60),
      darkOff: await avif(18, 20, 28),
      phoneLight: await avif(220, 210, 190),
      phoneDark: await avif(40, 45, 60),
      phoneDarkOff: await avif(20, 22, 30),
    });

    const provider = { available: true, async edit() { return { image: new Uint8Array([1, 2, 3]) }; } };
    const result = await deriveOvercastVariant('probe_set', { assetStore: store, provider });

    expect(result.ok).toBe(false);
    expect(readdirSync(join(setsRoot, 'probe_set'))).not.toContain('overcast.avif');
    expect(store.status('probe_set')).toBe('complete');
  });
});
