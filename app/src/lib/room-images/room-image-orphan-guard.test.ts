import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
// @ts-expect-error Native Node ESM server contract.
import { createRoomImageAssetStore } from '../../../server.mjs';

const sandboxes: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(): { assetRoot: string; setsRoot: string; catalogPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'hmi-orphan-guard-'));
  sandboxes.push(root);
  const assetRoot = join(root, 'assets');
  const setsRoot = join(assetRoot, 'room-images');
  mkdirSync(setsRoot, { recursive: true });
  mkdirSync(join(root, 'config', 'room-images'), { recursive: true });
  return { assetRoot, setsRoot, catalogPath: join(root, 'config', 'room-images', 'assets.json') };
}

function publishedSet(setsRoot: string, assetId: string): void {
  mkdirSync(join(setsRoot, assetId));
  writeFileSync(join(setsRoot, assetId, 'light.avif'), 'avif');
  writeFileSync(join(setsRoot, assetId, 'manifest.json'), JSON.stringify({ version: 1, assetId, files: {} }));
}

describe('Room-Image-Assetroot ohne Katalog', () => {
  it('behält veröffentlichte Bildsets, wenn beim Start kein Katalog existierte', () => {
    const { assetRoot, setsRoot, catalogPath } = sandbox();
    publishedSet(setsRoot, 'kept_published_set');
    mkdirSync(join(setsRoot, 'empty_leftover'));
    mkdirSync(join(setsRoot, '.publishing-stage_leftover'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.cleanupOrphans(new Set());

    expect(existsSync(join(setsRoot, 'kept_published_set', 'light.avif'))).toBe(true);
    expect(readdirSync(setsRoot).sort()).toEqual(['kept_published_set']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept_published_set'));
  });

  it('räumt Bildsets ohne Katalogeintrag weiter auf, wenn der Katalog beim Start vorhanden war', () => {
    const { assetRoot, setsRoot, catalogPath } = sandbox();
    writeFileSync(catalogPath, JSON.stringify({ version: 1, assets: [] }));
    publishedSet(setsRoot, 'stale_published_set');

    const store = createRoomImageAssetStore({ catalogPath, assetRoot });
    store.cleanupOrphans(new Set());

    expect(readdirSync(setsRoot)).toEqual([]);
  });
});
