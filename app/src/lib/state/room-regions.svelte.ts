/* ── Erkannte Flächen eines Raums (Paket 13) ──

   Die Polygone stehen im Katalog der Bildsets, also beim Server. Die
   Oberfläche holt die Liste einmal und merkt sich, welches Bildset welche
   Flächen hat; die Bühne fragt dann nur noch nach Raum und Art.

   Verbraucher ist bisher genau einer: das Wetter zieht nur im Fenster. Die
   übrigen Arten liegen bereit, damit später etwas darauf aufsetzen kann, ohne
   jedes Bildset erneut durchs Modell zu schicken. Ohne Erkennung ist die
   Antwort leer — und dann zeigt die Bühne kein Wetter. Lieber gar nichts als
   Regen an der falschen Stelle. */

import { normalizeHeroRoom, PROJECT_OVERCAST_ROOMS } from '../components/room-hero-assets.ts';
import { roomHeroConfig } from './room-hero-config.svelte.ts';
import type { RoomImageRegion, RoomImageRegionKind } from './room-image-library-client.ts';

const regionsByAsset = $state<{ map: Record<string, RoomImageRegion[]> }>({ map: {} });
/* Dieselben Flächen für die mitgelieferten Bilder: Wer noch kein eigenes
   Bildset hat, soll trotzdem Regen im Fenster sehen. Die Datei entsteht mit
   den Bildern (`scripts/export-project-heroes.mjs`) und wird erst geholt, wenn
   ein Raum ohne eigenes Set danach fragt. */
const projectRegions = $state<{ map: Record<string, RoomImageRegion[]> }>({ map: {} });
let projectLoaded = false;
/* Welche Bildsets eine trübe Fassung haben. Dieselbe Quelle wie die Flächen:
   ein Abruf der Bibliothek, danach nur noch Nachschlagen. */
const overcastAssets = $state<{ set: Record<string, true> }>({ set: {} });
let loaded = false;

/** Flächen des Raums, wahlweise auf eine Art gefiltert. */
export function roomRegions(
  roomId: string | null | undefined,
  kind?: RoomImageRegionKind,
): RoomImageRegion[] {
  const assetId = roomHeroConfig(roomId)?.assetId;
  const regions = assetId
    ? regionsByAsset.map[assetId] ?? []
    : projectRegions.map[normalizeHeroRoom(roomId)] ?? [];
  return kind ? regions.filter((region) => region.kind === kind) : regions;
}

/** CSS-`clip-path` je Fläche. `clip-path` kennt nur eine Form, also wird die
    Schicht pro Fläche einmal gezeichnet. */
export function regionClipPaths(regions: readonly RoomImageRegion[]): string[] {
  return regions.map((region) => `polygon(${region.points
    .map((point) => `${(point.x * 100).toFixed(2)}% ${(point.y * 100).toFixed(2)}%`)
    .join(', ')})`);
}

/** true, wenn das Bildset dieses Raums eine trübe Fassung mitbringt. */
export function roomHasOvercast(roomId: string | null | undefined): boolean {
  const assetId = roomHeroConfig(roomId)?.assetId;
  if (assetId) return overcastAssets.set[assetId] === true;
  return PROJECT_OVERCAST_ROOMS.has(normalizeHeroRoom(roomId));
}

/** Einmal pro Sitzung: Flächen und Varianten aus der Bildbibliothek nachziehen. */
export async function loadRoomRegionsOnce(): Promise<void> {
  void loadProjectRegionsOnce();
  if (loaded) return;
  loaded = true;
  try {
    const { loadRoomImageLibrary } = await import('./room-image-library-client.ts');
    const library = await loadRoomImageLibrary();
    const map: Record<string, RoomImageRegion[]> = {};
    const overcast: Record<string, true> = {};
    for (const asset of library.assets) {
      if (asset.regions?.regions?.length) map[asset.assetId] = asset.regions.regions;
      if ((asset.variants as Record<string, string>).overcast) overcast[asset.assetId] = true;
    }
    regionsByAsset.map = map;
    overcastAssets.set = overcast;
  } catch {
    loaded = false; // ein Fehlschlag darf einen späteren Versuch nicht sperren
  }
}

/** Die Flächen der mitgelieferten Bilder — einmal je Sitzung, still. */
async function loadProjectRegionsOnce(): Promise<void> {
  if (projectLoaded) return;
  projectLoaded = true;
  try {
    const base = import.meta.env.BASE_URL;
    const response = await fetch(`${base.endsWith('/') ? base : `${base}/`}hero/regions.json`);
    if (!response.ok) return;
    projectRegions.map = await response.json() as Record<string, RoomImageRegion[]>;
  } catch {
    projectLoaded = false; // ein Fehlschlag darf einen späteren Versuch nicht sperren
  }
}
