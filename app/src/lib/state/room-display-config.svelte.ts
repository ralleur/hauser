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
import { setRoomContactResolver, setRoomSensorResolver, type RoomContactKind } from './commands.ts';
import { deviceManager } from './device-manager.svelte.ts';
import { presenceEntityIds, windowEntityIds } from './entities.ts';
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
  /** abweichend gewählte Kontakte/Melder; ohne Eintrag greift die HA-Zuordnung.
      Mehrzahl, weil ein Raum mehrere Fenster hat. Leeres Array heißt bewusst
      „keine" — das ist etwas anderes als „nicht konfiguriert". */
  windowSensorIds?: string[];
  presenceSensorIds?: string[];
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

/* ── Kontakte und Melder (docs/06 §5) ──
   HA typisiert sie über die device_class des binary_sensors. Anders als bei
   Temperatur zählt hier nicht der erste, sondern ALLE Sensoren des Raums:
   drei Fenster sind drei Kontakte. */
const CONTACT_DEVICE_CLASSES: Record<RoomContactKind, readonly string[]> = {
  window: ['window', 'door', 'garage_door', 'opening'],
  presence: ['motion', 'occupancy', 'presence'],
};

export function roomContactCandidates(roomId: string, kind: RoomContactKind): EntityCatalogItem[] {
  const classes = CONTACT_DEVICE_CLASSES[kind];
  return deviceManager.catalog.filter(
    (item) => item.domain === 'binary_sensor'
      && !!item.deviceClass && classes.includes(item.deviceClass)
      && areaMatchesRoom(item.area, roomId),
  );
}

export interface RoomContactOption {
  entityId: string;
  name: string;
  /** aus der Haushalts-Config (Rolle window/presence), nicht aus dem HA-Bereich */
  fromConfig: boolean;
}

/* Alles, was für den Raum infrage kommt: erst die Rollen der Haushalts-Config,
   dann was der HA-Bereich zusätzlich hergibt. Diese Menge ist zugleich die
   Voreinstellung — erkannt heißt aktiv, bis jemand abwählt. */
export function roomContactOptions(roomId: string, kind: RoomContactKind): RoomContactOption[] {
  const configured = kind === 'window' ? windowEntityIds(roomId) : presenceEntityIds(roomId);
  const seen = new Set<string>();
  const options: RoomContactOption[] = [];
  for (const entityId of configured) {
    if (seen.has(entityId)) continue;
    seen.add(entityId);
    options.push({ entityId, name: catalogName(entityId), fromConfig: true });
  }
  for (const item of roomContactCandidates(roomId, kind)) {
    if (seen.has(item.entityId)) continue;
    seen.add(item.entityId);
    options.push({ entityId: item.entityId, name: item.name, fromConfig: false });
  }
  return options;
}

function catalogName(entityId: string): string {
  return deviceManager.catalog.find((item) => item.entityId === entityId)?.name ?? entityId;
}

/** Automatisch zugeordnete Kontakte des Raums (alles Erkannte). */
export function autoContactIds(roomId: string, kind: RoomContactKind): string[] {
  return roomContactOptions(roomId, kind).map((option) => option.entityId);
}

/** Ist dieser Sensor aktiv, zählt also für den Sicherheitsstatus? */
export function contactEnabled(roomId: string, kind: RoomContactKind, entityId: string): boolean {
  return contactIdsFor(roomId, kind).includes(entityId);
}

/* An-/Abwählen. Die erste Abweichung friert die aktuelle Menge ein — ab dann
   zählt die eigene Liste, ein später in HA ergänzter Sensor kommt nicht mehr
   von selbst dazu. */
export function setContactEnabled(
  roomId: string,
  kind: RoomContactKind,
  entityId: string,
  enabled: boolean,
): void {
  const current = new Set(contactIdsFor(roomId, kind));
  if (enabled) current.add(entityId);
  else current.delete(entityId);
  setContactIds(roomId, kind, [...current]);
}

/** Die tatsächlich verwendeten Kontakte: eigene Wahl, sonst die HA-Zuordnung. */
export function contactIdsFor(roomId: string, kind: RoomContactKind): readonly string[] {
  const e = entry(roomId);
  const chosen = kind === 'window' ? e.windowSensorIds : e.presenceSensorIds;
  return chosen ?? autoContactIds(roomId, kind);
}

/** Sind die Kontakte automatisch zugeordnet (also nicht überschrieben)? */
export function contactsAreAutomatic(roomId: string, kind: RoomContactKind): boolean {
  const e = entry(roomId);
  return (kind === 'window' ? e.windowSensorIds : e.presenceSensorIds) === undefined;
}

/** Kontakte setzen; `undefined` gibt die Wahl an die HA-Zuordnung zurück. */
export function setContactIds(
  roomId: string,
  kind: RoomContactKind,
  entityIds: readonly string[] | undefined,
): void {
  const next = { ...entry(roomId) };
  const key = kind === 'window' ? 'windowSensorIds' : 'presenceSensorIds';
  if (entityIds === undefined) delete next[key];
  else next[key] = [...entityIds];
  writeEntry(roomId, next);
}

setRoomContactResolver(contactIdsFor);

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
    // Kontakte hängen nicht an `showsMetric` — die Sicherheitsleiste zeigt sie
    // global, unabhängig davon was auf der Raum-Kachel steht.
    for (const kind of ['window', 'presence'] as const) {
      for (const id of contactIdsFor(room.id, kind)) ids.add(id);
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
      if (Array.isArray(cand.windowSensorIds)) {
        next.windowSensorIds = cand.windowSensorIds.filter((id): id is string => typeof id === 'string');
      }
      if (Array.isArray(cand.presenceSensorIds)) {
        next.presenceSensorIds = cand.presenceSensorIds.filter((id): id is string => typeof id === 'string');
      }
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
