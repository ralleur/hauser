import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Buffer } from 'node:buffer';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { createHash } from 'node:crypto';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
// @ts-expect-error The production server intentionally remains native Node ESM without declarations.
import { backfillRoomImagePhoneVariants, createRoomImageAssetStore } from '../../../server.mjs';

const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Deterministische Ableitung: geprüft wird der Migrationsweg, nicht die Kodierung. */
const derive = async (finals: Record<string, Uint8Array>) => ({
  phoneLight: bytes(`phone:${new TextDecoder().decode(finals.light)}`),
  phoneDark: bytes(`phone:${new TextDecoder().decode(finals.dark)}`),
});

/** Ein Assetstore im Zustand vor B-27 D2: drei Finals, Manifest v1. */
function legacySandbox(assetId = 'legacy_asset') {
  const sandbox = mkdtempSync(join(tmpdir(), 'hauser-phone-backfill-'));
  sandboxes.push(sandbox);
  const assetRoot = join(sandbox, 'assets');
  const directory = join(assetRoot, 'room-images', assetId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const files: Record<string, { sha256: string; byteLength: number }> = {};
  const legacyFiles = { light: 'light.avif', dark: 'dark.avif', darkOff: 'dark-off.avif' };
  for (const [key, name] of Object.entries(legacyFiles)) {
    const content = Buffer.from(bytes(`${assetId}-${key}`));
    writeFileSync(join(directory, name), content, { mode: 0o600 });
    files[key] = {
      sha256: createHash('sha256').update(content).digest('hex'),
      byteLength: content.byteLength,
    };
  }
  const manifest = Buffer.from(`${JSON.stringify({ version: 1, assetId, files })}\n`);
  writeFileSync(join(directory, 'manifest.json'), manifest, { mode: 0o600 });

  const catalogPath = join(sandbox, 'config', 'room-images', 'assets.json');
  mkdirSync(join(sandbox, 'config', 'room-images'), { recursive: true, mode: 0o700 });
  writeFileSync(catalogPath, `${JSON.stringify({
    version: 1,
    assets: [{
      assetId,
      variants: legacyFiles,
      focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
      createdAt: new Date(1_700_000_000_000).toISOString(),
      status: 'active',
      files,
      manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    }],
  })}\n`, { mode: 0o600 });

  return { sandbox, assetRoot, catalogPath, directory, assetId };
}

describe('B-27 D3 room image phone variant backfill', () => {
  /* Ohne Migration gilt jedes heutige Asset als inkohärent: verifyEntryFiles
     vergleicht gegen ROOM_IMAGE_VARIANT_FILES und der Store wirft schon beim
     Konstruieren. Genau das ist der Grund, warum der Backfill zwingend ist. */
  it('makes a pre-derivation store loadable again and leaves it coherent', async () => {
    const { assetRoot, catalogPath, directory, assetId } = legacySandbox();

    expect(() => createRoomImageAssetStore({ catalogPath, assetRoot })).toThrow();

    const result = await backfillRoomImagePhoneVariants({ catalogPath, assetRoot, derive });

    expect(result).toMatchObject({ status: 'ok', migrated: [assetId], failed: [] });
    expect(readdirSync(directory).sort()).toEqual([
      'dark-off.avif', 'dark.avif', 'light.avif', 'manifest.json',
      'phone-dark.avif', 'phone-light.avif',
    ]);
    expect(readFileSync(join(directory, 'phone-light.avif'), 'utf8'))
      .toBe(`phone:${assetId}-light`);
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe(2);
    expect(Object.keys(manifest.files).sort())
      .toEqual(['dark', 'darkOff', 'light', 'phoneDark', 'phoneLight']);

    // Der Store akzeptiert den migrierten Katalog jetzt vollständig.
    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    expect(store.list().map((entry: { assetId: string }) => entry.assetId)).toEqual([assetId]);
    expect(store.variantBytes(assetId, 'phoneDark')).not.toBeNull();
  });

  it('is idempotent and leaves an already migrated store untouched', async () => {
    const { assetRoot, catalogPath, catalogPath: path } = legacySandbox();
    await backfillRoomImagePhoneVariants({ catalogPath, assetRoot, derive });
    const afterFirst = readFileSync(path, 'utf8');

    const second = await backfillRoomImagePhoneVariants({ catalogPath, assetRoot, derive });

    expect(second).toMatchObject({ status: 'ok', migrated: [], failed: [] });
    expect(readFileSync(path, 'utf8')).toBe(afterFirst);
  });

  /* Bricht der Lauf zwischen Abräumen und Umbenennen ab, liegt das vollständige
     Staging noch da. Der nächste Start muss den Tausch abschließen, statt einen
     inkohärenten Katalog zu hinterlassen. */
  it('completes an interrupted swap from the staging directory on the next run', async () => {
    const { assetRoot, catalogPath, directory, assetId } = legacySandbox();
    const setsRoot = join(assetRoot, 'room-images');
    const staging = join(setsRoot, `.phone-backfill-${assetId}`);

    // Zustand nach einem Abbruch: Final abgeräumt, Staging vollständig.
    await backfillRoomImagePhoneVariants({ catalogPath, assetRoot, derive });
    const migratedFiles = readdirSync(directory).sort();
    mkdirSync(staging, { mode: 0o700 });
    for (const name of migratedFiles) {
      writeFileSync(join(staging, name), readFileSync(join(directory, name)), { mode: 0o600 });
    }
    rmSync(directory, { recursive: true, force: true });
    writeFileSync(catalogPath, readFileSync(catalogPath));

    const result = await backfillRoomImagePhoneVariants({ catalogPath, assetRoot, derive });

    expect(result.failed).toEqual([]);
    expect(existsSync(staging)).toBe(false);
    expect(readdirSync(directory).sort()).toEqual(migratedFiles);
    expect(() => createRoomImageAssetStore({ catalogPath, assetRoot })).not.toThrow();
  });

  it('reports a failed asset without touching the rest of the catalog', async () => {
    const { assetRoot, catalogPath, directory, assetId } = legacySandbox();
    rmSync(join(directory, 'dark.avif'));

    const result = await backfillRoomImagePhoneVariants({
      catalogPath, assetRoot, derive, log: () => undefined,
    });

    expect(result).toMatchObject({ status: 'partial', migrated: [], failed: [assetId] });
    expect(existsSync(join(assetRoot, 'room-images', `.phone-backfill-${assetId}`))).toBe(false);
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    expect(catalog.assets[0].files.phoneLight).toBeUndefined();
  });

  it('does nothing when there is no catalog yet', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'hauser-phone-backfill-empty-'));
    sandboxes.push(sandbox);

    await expect(backfillRoomImagePhoneVariants({
      catalogPath: join(sandbox, 'missing.json'), assetRoot: join(sandbox, 'assets'), derive,
    })).resolves.toMatchObject({ status: 'skipped', migrated: [], failed: [] });
  });
});
