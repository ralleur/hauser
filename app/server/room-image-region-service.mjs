/* ── Flächenerkennung als Dienst (Paket 13) ──

   Bindet die drei Teile zusammen: das veröffentlichte Bild aus dem Assetstore
   holen, es für das Sehmodell aufbereiten, die geprüfte Antwort in den Katalog
   schreiben. Ausgelöst wird auf Knopfdruck aus der Diagnose oder nachts über
   die Vorberechnung — nie aus einem Bedienweg heraus.

   Das Modell bekommt ein JPEG in Bildschirmgröße, nicht das AVIF in voller
   Auflösung: AVIF versteht die Schnittstelle nicht, und für „wo ist das
   Fenster" reicht ein Bruchteil der Pixel. */

import { sharp } from './runtime-env.mjs';
import { detectRoomImageRegions, regionsRecord } from './room-image-regions.mjs';

/* Gemessen am 2026-09-06: Mit 1024 px übersah das Modell in einer dreiteiligen
   Balkonfront regelmäßig eine Scheibe — jede einzelne ist dort nur gut ein
   Prozent des Bildes. Mehr Kantenlänge kostet Tokens, aber Fenster sind das
   Einzige, worauf bisher etwas aufbaut. */
export const REGION_DETECTION_EDGE = 1536;

/** AVIF-Variante → JPEG, lange Kante auf `edge` begrenzt. */
export async function prepareRegionDetectionImage(bytes, { edge = REGION_DETECTION_EDGE } = {}) {
  return new Uint8Array(await sharp(Buffer.from(bytes))
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer());
}

/**
 * Erkennt die Flächen eines veröffentlichten Bildsets und schreibt sie in den
 * Katalog. Gibt immer ein Ergebnisobjekt zurück, wirft nur bei kaputtem Store.
 */
export async function detectRegionsForAsset(assetId, {
  assetStore,
  credential,
  /* `mode` und `headers` gehören zum Zugangsweg (API-Schlüssel oder
     ChatGPT-Anmeldung) und müssen durchgereicht werden — sonst landet der
     Aufruf beim falschen Endpunkt. */
  mode,
  headers,
  model,
  fetchImpl,
  now = () => Date.now(),
  prepare = prepareRegionDetectionImage,
  detect = detectRoomImageRegions,
  signal,
} = {}) {
  if (!assetStore) return { ok: false, code: 'ROOM_IMAGE_STORE_INVALID' };
  const entry = assetStore.activeEntry(assetId);
  if (!entry) return { ok: false, code: 'ASSET_NOT_FOUND' };

  let source;
  try {
    source = assetStore.variantBytes(assetId, 'light');
  } catch {
    return { ok: false, code: 'ASSET_UNREADABLE' };
  }
  if (!source) return { ok: false, code: 'ASSET_NOT_FOUND' };

  let prepared;
  try {
    prepared = await prepare(source);
  } catch {
    return { ok: false, code: 'ASSET_UNREADABLE' };
  }

  const detection = await detect({
    image: prepared, mimeType: 'image/jpeg', model, credential, mode, headers, fetchImpl, signal,
  });
  if (!detection.ok) return { ok: false, code: detection.code, status: detection.status ?? null, model };

  const record = regionsRecord(detection.regions, { now });
  assetStore.setRegions(assetId, record);
  return { ok: true, assetId, regions: record };
}

/** Bildsets ohne Flächenangaben — Arbeitsvorrat des nächtlichen Laufs. */
export function assetsWithoutRegions(assetStore) {
  if (!assetStore) return [];
  return assetStore.list()
    .filter((asset) => asset.status === 'active' && !asset.regions)
    .map((asset) => asset.assetId);
}
