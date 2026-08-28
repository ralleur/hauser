/* ── Was die Raum-Kachel auf dem Home-Screen zeigt ──
   Pro Raum konfigurierbar: Temperatur und Luftfeuchte an/aus, und welcher
   Sensor sie liefert. Der Normalfall soll ohne Konfiguration funktionieren —
   deshalb wird der Sensor automatisch aus der HA-Bereichszuordnung gewählt
   (Katalog-Eintrag mit `deviceClass: temperature|humidity` und passendem
   `area`). Persistiert werden nur ABWEICHUNGEN davon, analog scene-config.ts:
   ein später in HA zugeordneter Sensor wird dadurch automatisch übernommen.

   Reine Logik plus eine Rune für den persistierten Teil; die Auflösung gegen
   den Katalog passiert beim Lesen. */

import { appState } from './app.svelte.ts';
import { setRoomSensorResolver } from './commands.ts';
import { deviceManager } from './device-manager.svelte.ts';
import { sharedStorage } from './shared-config.ts';
import type { EntityCatalogItem } from './fake-discovery-catalog.ts';

export type RoomMetric = 'temperature' | 'humidity';

export interface RoomDisplayEntry {
  /** Temperatur auf der Kachel zeigen (Default: ja) */
  showTemperature?: boolean;
  /** Luftfeuchte auf der Kachel zeigen (Default: nein) */
  showHumidity?: boolean;
  /** abweichend gewählter Sensor; ohne Eintrag greift die HA-Zuordnung */
  temperatureSensorId?: string;
  humiditySensorId?: string;
}

export interface RoomDisplayConfig {
  version: 1;
  rooms: Record<string, RoomDisplayEntry>;
}

export const EMPTY_ROOM_DISPLAY_CONFIG: RoomDisplayConfig = { version: 1, rooms: {} };
export const ROOM_DISPLAY_CONFIG_KEY = 'hmi:room-display:v1';

const DEFAULTS: Record<RoomMetric, boolean> = { temperature: true, humidity: false };

/* ── Automatik: Sensoren aus der HA-Bereichszuordnung ──
   Der Katalog trägt den HA-Bereichsnamen („Wohnzimmer"), die Raum-Id ist ein
   Slug („wohnzimmer"). Beides wird auf dieselbe Normalform gebracht und dann
   sowohl gegen die Id als auch gegen den Anzeigenamen des Raums geprüft. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function areaMatchesRoom(area: string | null | undefined, roomId: string): boolean {
  if (!area) return false;
  const normalized = slug(area);
  if (normalized === slug(roomId)) return true;
  const roomName = appState.rooms.find((r) => r.id === roomId)?.name;
  return !!roomName && normalized === slug(roomName);
}

/** Sensoren des Raums für eine Messgröße, laut HA-Bereich. Der erste ist die
    Automatik-Wahl; die weiteren stehen im Editor zur Auswahl. */
export function roomSensorCandidates(roomId: string, metric: RoomMetric): EntityCatalogItem[] {
  return deviceManager.catalog.filter(
    (item) => item.domain === 'sensor' && item.deviceClass === metric && areaMatchesRoom(item.area, roomId),
  );
}

/** Automatisch gewählter Sensor (erster im Raum) oder '' */
export function autoSensorId(roomId: string, metric: RoomMetric): string {
  return roomSensorCandidates(roomId, metric)[0]?.entityId ?? '';
}

/* ── Persistierter Teil ── */

export const roomDisplay = $state({
  config: load(),
});

function entry(roomId: string): RoomDisplayEntry {
  return roomDisplay.config.rooms[roomId] ?? {};
}

/** Zeigt die Kachel diese Messgröße? */
export function showsMetric(roomId: string, metric: RoomMetric): boolean {
  const e = entry(roomId);
  const value = metric === 'temperature' ? e.showTemperature : e.showHumidity;
  return value ?? DEFAULTS[metric];
}

/** Der tatsächlich verwendete Sensor: eigene Wahl, sonst die HA-Zuordnung. */
export function sensorIdFor(roomId: string, metric: RoomMetric): string {
  const e = entry(roomId);
  const chosen = metric === 'temperature' ? e.temperatureSensorId : e.humiditySensorId;
  return chosen ?? autoSensorId(roomId, metric);
}

setRoomSensorResolver(sensorIdFor);

/** Ist der Sensor automatisch gewählt (also nicht überschrieben)? */
export function sensorIsAutomatic(roomId: string, metric: RoomMetric): boolean {
  const e = entry(roomId);
  return (metric === 'temperature' ? e.temperatureSensorId : e.humiditySensorId) === undefined;
}

export function setShowsMetric(roomId: string, metric: RoomMetric, value: boolean): void {
  const next = { ...entry(roomId) };
  if (value === DEFAULTS[metric]) delete next[metric === 'temperature' ? 'showTemperature' : 'showHumidity'];
  else next[metric === 'temperature' ? 'showTemperature' : 'showHumidity'] = value;
  writeEntry(roomId, next);
}

/** Sensor setzen; `undefined` gibt die Wahl an die HA-Zuordnung zurück. */
export function setSensorId(roomId: string, metric: RoomMetric, entityId: string | undefined): void {
  const next = { ...entry(roomId) };
  const key = metric === 'temperature' ? 'temperatureSensorId' : 'humiditySensorId';
  if (entityId === undefined) delete next[key];
  else next[key] = entityId;
  writeEntry(roomId, next);
}

/* Leere Einträge werden entfernt, damit „alles Standard" auch den Storage räumt. */
function writeEntry(roomId: string, next: RoomDisplayEntry): void {
  const rooms = { ...roomDisplay.config.rooms };
  if (Object.keys(next).length === 0) delete rooms[roomId];
  else rooms[roomId] = next;
  const config: RoomDisplayConfig = { version: 1, rooms };
  roomDisplay.config = config;
  save(config);
}

/* Die aktuell angezeigten Sensoren aller Räume. Das Abo (ADR-006) kommt aus der
   Haushalts-Config und kennt einen hier gewählten Sensor nicht — entities.ts
   nimmt diese Liste deshalb in `visibleEntityIds` mit auf, sonst bekäme er nie
   einen Wert. */
export function configuredRoomSensorIds(): string[] {
  const ids = new Set<string>();
  for (const room of appState.rooms) {
    for (const metric of ['temperature', 'humidity'] as const) {
      if (!showsMetric(room.id, metric)) continue;
      const id = sensorIdFor(room.id, metric);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/* ── Persistenz (Muster scene-config.ts) ── */

export function parseRoomDisplayConfig(raw: string | null): RoomDisplayConfig {
  if (!raw) return { version: 1, rooms: {} };
  try {
    const obj = JSON.parse(raw) as Partial<RoomDisplayConfig>;
    if (!obj || obj.version !== 1 || typeof obj.rooms !== 'object' || obj.rooms === null || Array.isArray(obj.rooms)) {
      return { version: 1, rooms: {} };
    }
    const rooms: Record<string, RoomDisplayEntry> = {};
    for (const [roomId, value] of Object.entries(obj.rooms as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const cand = value as Partial<RoomDisplayEntry>;
      const next: RoomDisplayEntry = {};
      if (typeof cand.showTemperature === 'boolean') next.showTemperature = cand.showTemperature;
      if (typeof cand.showHumidity === 'boolean') next.showHumidity = cand.showHumidity;
      if (typeof cand.temperatureSensorId === 'string') next.temperatureSensorId = cand.temperatureSensorId;
      if (typeof cand.humiditySensorId === 'string') next.humiditySensorId = cand.humiditySensorId;
      if (Object.keys(next).length > 0) rooms[roomId] = next;
    }
    return { version: 1, rooms };
  } catch {
    return { version: 1, rooms: {} };
  }
}

function load(): RoomDisplayConfig {
  try {
    if (typeof localStorage === 'undefined') return { version: 1, rooms: {} };
  } catch {
    return { version: 1, rooms: {} };
  }
  return parseRoomDisplayConfig(sharedStorage.getItem(ROOM_DISPLAY_CONFIG_KEY));
}

function save(config: RoomDisplayConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    sharedStorage.setItem(ROOM_DISPLAY_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage voll oder gesperrt: die Anzeige bleibt für diese Sitzung stehen.
  }
}
