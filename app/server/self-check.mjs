/* ── Selbstprüfung beim Start (Paket 11, docs/20) ──

   Der Katalog der Raumbilder und der Assetroot können auseinanderlaufen: ein
   wiederhergestelltes Config-Volume neben einem alten Asset-Volume, ein
   halb kopiertes Backup, ein von Hand gelöschtes Bildset. Bisher fiel das
   erst auf, wenn ein Raum leer blieb.

   Diese Prüfung läuft einmal beim Start, findet die Lücken und schreibt sie
   als Warnung in den Health-Payload. Sie bricht nichts ab: ein fehlendes Bild
   ist ein Mangel, kein Grund, das Haus nicht zu bedienen (ADR-030 §5 in
   derselben Haltung). */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOM_IMAGE_VARIANT_FILES } from './runtime-env.mjs';

/** @typedef {{ ok: boolean, checkedSets: number, missing: string[], note: string|null }} SelfCheckResult */

const MAX_REPORTED = 10;

/** Liest den Katalog; ein fehlender Katalog ist kein Fehler, nur nichts zu prüfen. */
function readCatalog(catalogPath, readFile) {
  if (!catalogPath) return null;
  try {
    const raw = readFile(catalogPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.assets) ? parsed.assets : null;
  } catch {
    return null;
  }
}

/* Ein Bildset liegt unter `<assetRoot>/room-images/<assetId>/` und trägt je
   Variante genau eine Datei plus das Manifest — dieselbe Erwartung wie im
   Assetstore. Geprüft wird nur die Existenz: Prüfsummen sind Sache der
   Veröffentlichung, hier geht es um „ist überhaupt noch da". */
function expectedFiles() {
  return [...Object.values(ROOM_IMAGE_VARIANT_FILES), 'manifest.json'];
}

/**
 * Prüft den Raumbild-Katalog gegen den Assetroot.
 * @returns {SelfCheckResult}
 */
export function checkRoomImageAssets({
  catalogPath = null,
  assetRoot = null,
  readFile = readFileSync,
  exists = existsSync,
} = {}) {
  const assets = readCatalog(catalogPath, readFile);
  if (!assets || !assetRoot) {
    return { ok: true, checkedSets: 0, missing: [], note: 'no-catalog' };
  }
  const setsRoot = join(assetRoot, 'room-images');
  const missing = [];
  for (const asset of assets) {
    const id = typeof asset?.assetId === 'string' ? asset.assetId : null;
    if (!id) continue;
    for (const name of expectedFiles()) {
      if (exists(join(setsRoot, id, name))) continue;
      if (missing.length < MAX_REPORTED) missing.push(`${id}/${name}`);
    }
  }
  return {
    ok: missing.length === 0,
    checkedSets: assets.length,
    missing,
    note: null,
  };
}

/** Fasst alle Startprüfungen zu dem zusammen, was `/api/health` mitträgt. */
export function runSelfCheck(options = {}) {
  const roomImages = checkRoomImageAssets(options.roomImages ?? {});
  return {
    ok: roomImages.ok,
    at: (options.now ?? (() => Date.now()))(),
    roomImages,
  };
}
