/* ============================================
   Entity-Mapping (ADR-018): übersetzt zwischen der Domänensicht (Raum + Gerät)
   und den realen HA-`entity_id`s. Seit der HA-Anbindung folgen die IDs KEINER
   Namenskonvention mehr (Live-Discovery zeigte inkonsistente IDs) — die reale
   `entity_id` steht explizit im Seed (RoomSeed/LightSeed/MediaSeed), und dieses
   Modul baut daraus die Nachschlage-Maps. Reine Funktionen, ohne Framework-Bezug;
   Value-Shapes (LightValue/ClimateValue/MediaValue) bleiben unverändert.
   ============================================ */

import type { LightValue, ClimateValue, MediaValue } from '../adapter/types.ts';
import { appState, MEDIA_SEED, SUN_ENTITY, ENERGY_SENSORS, energyRefIds, type RoomSeed, type MediaSeed } from './app.svelte.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';

export const VACATION_MODE_ENTITY = 'switch.urlaubsmodus';
export const LAUNDRY_ENTITIES = {
  washer: 'input_boolean.waschmaschine_laeuft',
  dryer: 'input_boolean.trockner_laeuft',
} as const;
/* In der Demo gibt es keinen Kamerastream — ein leeres „nicht verfügbar"-Panel
   anzubieten wäre schlechter als gar keins (docs/12). */
export const ROOM_CAMERA_ENTITIES: Readonly<Record<string, string>> = IS_DEMO ? {} : {
  // Live in HA geprüft: Camera1 ist dem Bereich Wohnzimmer zugeordnet und zeigt den Balkon.
  wohnzimmer: 'camera.balkon',
};

/* Explizite Maps aus dem Seed (ADR-018): Domänensicht → reale entity_id. */
const climateIds = new Map<string, string>();    // roomId → entity_id
const tempSensorIds = new Map<string, string>(); // roomId → dedizierter sensor.*
const mediaIds = new Map<string, string>();      // playerId → entity_id

for (const p of MEDIA_SEED) mediaIds.set(p.id, p.entityId);

function currentLightIds(): Map<string, string> {
  const ids = new Map<string, string>();
  for (const r of appState.rooms) {
    for (const l of r.lights) ids.set(`${r.id}/${l.id}`, l.entityId);
  }
  return ids;
}

function rebuildClimateIds(rooms: readonly RoomSeed[]): void {
  climateIds.clear();
  tempSensorIds.clear();
  for (const r of rooms) {
    if (r.climateEntityId) climateIds.set(r.id, r.climateEntityId);
    if (r.tempSensorId) tempSensorIds.set(r.id, r.tempSensorId);
  }
}

export function lightEntityId(roomId: string, lightId: string): string {
  return currentLightIds().get(`${roomId}/${lightId}`) ?? `light.${roomId}_${lightId}`;
}

export function climateEntityId(roomId: string): string {
  return climateIds.get(roomId) ?? '';
}

export function roomHasClimate(roomId: string): boolean {
  return climateIds.has(roomId);
}

/* Dedizierter Raum-Temperatursensor (leer, wenn keiner gemappt ist). */
export function tempSensorEntityId(roomId: string): string {
  return tempSensorIds.get(roomId) ?? '';
}

export function roomCameraEntityId(roomId: string): string {
  return ROOM_CAMERA_ENTITIES[roomId] ?? '';
}

export function mediaEntityId(playerId: string): string {
  return mediaIds.get(playerId) ?? `media_player.${playerId}`;
}

/* Initial-State/Fallback-Cache des EntityStores aus dem Raum-Seed (ADR-018):
   pro Raum ein climate.*-Entity, pro Licht ein light.*-Entity — unter der realen
   entity_id. Diese Werte gelten, bis das erste subscribe_entities-Echo greift. */
export function buildEntitySeed(rooms: readonly RoomSeed[]): Map<string, unknown> {
  rebuildClimateIds(rooms);
  const seed = new Map<string, unknown>();
  for (const r of rooms) {
    if (r.climateEntityId) {
      const c: ClimateValue = { target: r.target!, hvac: r.hvac! };
      // Ist-Temp-Startwert nur setzen, wenn konfiguriert (Fallback-Cache bis
      // zum ersten Echo); sonst bleibt `current` bis dahin undefined.
      if (typeof r.current === 'number') c.current = r.current;
      seed.set(r.climateEntityId, c);
    }
    for (const l of r.lights) {
      const v: LightValue = { on: l.on, brightness: l.brightness };
      // Fähigkeits-abhängige Startwerte (Fallback bis zum ersten Echo)
      if (l.colorTemp) v.colorTemp = l.colorTempK ?? 2700;
      if (l.color) v.color = l.colorHex ?? null;
      seed.set(l.entityId, v);
    }
  }
  return seed;
}

/* Media-Seed (ADR-018): pro Audio-Zone ein media_player.*-Entity unter der realen
   entity_id. `position` gehört bewusst NICHT ins Entity (lokale Simulation). */
export function buildMediaSeed(players: readonly MediaSeed[]): Map<string, unknown> {
  const seed = new Map<string, unknown>();
  for (const p of players) {
    seed.set(p.entityId, {
      playing: p.playing, volume: p.volume, source: p.source,
      available: p.available, track: p.track, artist: p.artist, duration: p.duration,
    } satisfies MediaValue);
  }
  return seed;
}

/* Read-only-Ambient-Entitäten (ADR-018): sun.sun + konfigurierte Energie-Sensoren.
   Immer abonniert (auf JEDEM Screen), weil sun.sun die globale Theme-Automatik
   treibt — nicht an einen sichtbaren Screen gebunden. Der Satz ist klein (wenige
   Entitäten), die Dauer-Subscription damit vernachlässigbar. Nicht konfigurierte
   (null) Energie-Sensoren werden ausgelassen. */
export function ambientEntityIds(): string[] {
  const ids = [SUN_ENTITY, ...Object.values(LAUNDRY_ENTITIES)];
  for (const ref of Object.values(ENERGY_SENSORS)) ids.push(...energyRefIds(ref));
  return ids;
}

/* Volle Menge der gemappten entity_ids (ADR-006-Startset fürs Abo): steuerbar
   (Licht/Klima/Media) + read-only-Ambient (sun/Energie). */
export function allEntityIds(): string[] {
  const lightIds = currentLightIds();
  return [...climateIds.values(), ...tempSensorIds.values(), ...lightIds.values(), ...mediaIds.values(), ...Object.values(ROOM_CAMERA_ENTITIES), VACATION_MODE_ENTITY, ...ambientEntityIds()];
}

/* Sichtbare entity_ids je Screen (ADR-006): der Home-Screen zeigt Räume
   (Licht + Klima) und die Media-Karten; der Media-Screen die Player. Die
   Ambient-Entitäten (sun/Energie) sind IMMER dabei — sun treibt die globale
   Theme-Automatik, unabhängig vom sichtbaren Screen. */
export function visibleEntityIds(screen: string): string[] {
  const ambient = ambientEntityIds();
  const lightIds = currentLightIds();
  if (screen === 'home') return [...climateIds.values(), ...tempSensorIds.values(), ...lightIds.values(), ...mediaIds.values(), ...Object.values(ROOM_CAMERA_ENTITIES), VACATION_MODE_ENTITY, ...ambient];
  if (screen === 'media') return [...mediaIds.values(), ...ambient];
  return ambient;
}
