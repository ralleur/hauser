import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
// @ts-expect-error Native Node ESM server contract.
import { createRoomImageAssetStore } from '../../../server.mjs';

/* Paket 13: Die trübe Variante kommt NACH der Veröffentlichung dazu. Der
   Verzeichnistausch ist der heikle Teil — er darf weder ein halbes Set noch
   einen Katalog hinterlassen, der nicht mehr zu den Dateien passt. */

const sandboxes: string[] = [];
afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): { assetRoot: string; setsRoot: string; catalogPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'hmi-optional-variant-'));
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

const FOCUS = { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } };
const bytes = (seed: number) => new Uint8Array([seed, seed + 1, seed + 2]);
const VARIANTS = {
  light: bytes(1), dark: bytes(10), darkOff: bytes(20), phoneLight: bytes(30), phoneDark: bytes(40),
};

describe('Optionale Bildvariante nachtragen', () => {
  it('legt die Datei dazu und hält Katalog, Manifest und Verzeichnis beisammen', () => {
    const { assetRoot, setsRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.publish('probe_set', FOCUS, VARIANTS);

    expect(store.addOptionalVariant('probe_set', 'overcast', bytes(50))).toBe(true);

    // Das Verzeichnis trägt genau die Pflichtdateien plus die neue Variante.
    expect(readdirSync(join(setsRoot, 'probe_set')).sort()).toEqual([
      'dark-off.avif', 'dark.avif', 'light.avif', 'manifest.json',
      'overcast.avif', 'phone-dark.avif', 'phone-light.avif',
    ]);

    // Der Katalog bleibt gültig — sonst würde list() werfen.
    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].variants.overcast).toBe('/assets/room-images/probe_set/overcast.avif');
    expect(store.status('probe_set')).toBe('complete');

    // Manifest und Katalog kennen die Datei mit derselben Prüfsumme.
    const manifest = JSON.parse(readFileSync(join(setsRoot, 'probe_set', 'manifest.json'), 'utf8'));
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const entry = catalog.assets.find((candidate: { assetId: string }) => candidate.assetId === 'probe_set');
    expect(manifest.files.overcast.sha256).toBe(entry.files.overcast.sha256);
  });

  it('lässt ein zweites Öffnen des Stores das Set unverändert annehmen', () => {
    const { assetRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.publish('probe_set', FOCUS, VARIANTS);
    store.addOptionalVariant('probe_set', 'overcast', bytes(50));

    // Der Konstruktor prüft jedes aktive Asset; ein unbekannter Fremdkörper im
    // Verzeichnis würde hier werfen.
    const reopened = createRoomImageAssetStore({ catalogPath, assetRoot });
    expect(reopened.list()[0].variants.overcast).toBeTruthy();
  });

  it('bleibt beim alten Stand, wenn das Set gar nicht existiert', () => {
    const { assetRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    expect(store.addOptionalVariant('gibt_es_nicht', 'overcast', bytes(50))).toBe(false);
  });

  it('weist unbekannte Varianten und leere Bilder ab', () => {
    const { assetRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.publish('probe_set', FOCUS, VARIANTS);
    expect(() => store.addOptionalVariant('probe_set', 'sonnig', bytes(1))).toThrow();
    expect(() => store.addOptionalVariant('probe_set', 'overcast', new Uint8Array())).toThrow();
  });

  it('gibt die optionale Datei heraus — aber nur, wenn das Set sie hat', () => {
    const { assetRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.publish('probe_set', FOCUS, VARIANTS);
    store.publish('ohne_set', FOCUS, VARIANTS);
    store.addOptionalVariant('probe_set', 'overcast', bytes(50));

    /* Ohne diesen Weg liefert die Auslieferung 404 und die Bühne fällt still
       auf das Projektbild zurück — genau das ist beim ersten Live-Lauf
       passiert. */
    // Der Store gibt Buffer heraus; verglichen wird der Inhalt.
    expect([...store.variantBytes('probe_set', 'overcast')]).toEqual([...bytes(50)]);
    expect(store.variantBytes('ohne_set', 'overcast')).toBeNull();
    expect([...store.variantBytes('probe_set', 'light')]).toEqual([...VARIANTS.light]);
  });

  it('räumt das Staging nicht als verwaistes Set weg', () => {
    const { assetRoot, setsRoot, catalogPath } = sandbox();
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.publish('probe_set', FOCUS, VARIANTS);
    store.addOptionalVariant('probe_set', 'overcast', bytes(50));
    store.cleanupOrphans(new Set());
    expect(existsSync(join(setsRoot, 'probe_set', 'overcast.avif'))).toBe(true);
  });
});
