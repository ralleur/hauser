/* ── Gastprojektion der HA-Zustände (Hotel Mode) ──
   Der eigene, bewusst kleine Store des Gastpfads: er kennt nur `/api/hotel-mode/
   entities`, hält kein HA-Token, liest keinen localStorage-Eintrag und öffnet
   keine WebSocket-Verbindung. Die Wahrheit liegt beim Server — was hier nicht
   ankommt, existiert für den Gast nicht.

   Aktualisiert wird per kurzem Polling (docs/hotel-mode-plan.md §7): ein
   Gastpanel braucht keinen generischen Realtime-Hub, und der Server sammelt die
   erlaubten Entities ohnehin kurz zwischen. */

import { haToValue, type RawEntity } from '../adapter/ha-entities.ts';
import type { HotelGuestAction, HotelTemperatureRange } from '../config/household-config.ts';

export interface HotelGuestEntityPolicy {
  entityId: string;
  actions: HotelGuestAction[];
  temperatureRange: HotelTemperatureRange | null;
}

export interface HotelGuestRoom {
  roomId: string;
  entities: HotelGuestEntityPolicy[];
}

export interface HotelGuestEntity {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HotelGuestProjection {
  enabled: boolean;
  status: 'inactive' | 'active';
  rooms: HotelGuestRoom[];
  scenes: string[];
  scripts: string[];
  entities: HotelGuestEntity[];
  /** Zeitpunkt des Serverabrufs; `null`, solange nichts Belastbares vorliegt. */
  fetchedAt: number | null;
  error: string | null;
}

export const HOTEL_ENTITIES_ENDPOINT = '/api/hotel-mode/entities';
const HOTEL_ENTITIES_TIMEOUT_MS = 4000;
export const HOTEL_ENTITIES_POLL_MS = 5000;

function neutralProjection(): HotelGuestProjection {
  return { enabled: false, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/* Genau die Aktionen, die der v4-Vertrag kennt — eine unbekannte Aktion wird
   verworfen, statt in der Oberfläche als bedienbar zu erscheinen. */
const GUEST_ACTIONS: readonly HotelGuestAction[] = [
  'turn_on', 'turn_off', 'set_temperature', 'set_hvac_mode', 'start', 'return_to_base',
];

function parseActions(value: unknown): HotelGuestAction[] {
  return stringList(value).filter((item): item is HotelGuestAction =>
    (GUEST_ACTIONS as readonly string[]).includes(item));
}

function parseRange(value: unknown): HotelTemperatureRange | null {
  if (!value || typeof value !== 'object') return null;
  const range = value as Record<string, unknown>;
  return typeof range.min === 'number' && typeof range.max === 'number'
    ? { min: range.min, max: range.max }
    : null;
}

function parseRooms(value: unknown): HotelGuestRoom[] {
  if (!Array.isArray(value)) return [];
  const rooms: HotelGuestRoom[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const room = raw as Record<string, unknown>;
    if (typeof room.roomId !== 'string' || !Array.isArray(room.entities)) continue;
    const entities: HotelGuestEntityPolicy[] = [];
    for (const rawEntity of room.entities) {
      if (!rawEntity || typeof rawEntity !== 'object') continue;
      const entity = rawEntity as Record<string, unknown>;
      if (typeof entity.entityId !== 'string') continue;
      entities.push({
        entityId: entity.entityId,
        actions: parseActions(entity.actions),
        temperatureRange: parseRange(entity.temperatureRange),
      });
    }
    rooms.push({ roomId: room.roomId, entities });
  }
  return rooms;
}

function parseEntities(value: unknown): HotelGuestEntity[] {
  if (!Array.isArray(value)) return [];
  const entities: HotelGuestEntity[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entity = raw as Record<string, unknown>;
    if (typeof entity.entityId !== 'string' || typeof entity.state !== 'string') continue;
    const attributes = entity.attributes && typeof entity.attributes === 'object' && !Array.isArray(entity.attributes)
      ? { ...(entity.attributes as Record<string, unknown>) }
      : {};
    entities.push({ entityId: entity.entityId, state: entity.state, attributes });
  }
  return entities;
}

/**
 * Fail-closed: alles, was nicht als aktive Gastprojektion lesbar ist, wird zum
 * neutralen Zustand. Eine halb verstandene Antwort darf nie Steuerdaten zeigen.
 */
export function parseHotelGuestProjection(payload: unknown): HotelGuestProjection {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return neutralProjection();
  const document = payload as Record<string, unknown>;
  const enabled = document.enabled === true;
  const error = typeof document.error === 'string' ? document.error : null;
  // Nur eine in sich stimmige, ausdrücklich aktive Antwort trägt Steuerdaten.
  if (!enabled || document.status !== 'active') return { ...neutralProjection(), enabled, error };
  return {
    enabled,
    status: 'active',
    rooms: parseRooms(document.rooms),
    scenes: stringList(document.scenes),
    scripts: stringList(document.scripts),
    entities: parseEntities(document.entities),
    fetchedAt: typeof document.fetchedAt === 'number' ? document.fetchedAt : null,
    error,
  };
}

export const hotelGuest = $state<HotelGuestProjection>(neutralProjection());

/* Wertansicht der Controls (LightValue/ClimateValue/…): dieselbe reine
   Übersetzung wie im normalen HA-Pfad, damit die Raumansicht unverändert
   bleibt. Der Vorwert deckt HA's Weglassen von Attributen im Aus-Zustand ab. */
const values = $state<Record<string, unknown>>({});

export function hotelEntityValue(entityId: string): unknown {
  return values[entityId];
}

export function hotelEntityIds(): string[] {
  return hotelGuest.entities.map((entity) => entity.entityId);
}

/* ── Push an die Runtime ──
   Der Store bleibt die einzige Stelle, die den Server befragt; das
   Hotel-Backend (adapter/hotel-backend.ts) hängt sich als Hörer daran und
   speist damit denselben AdapterRuntime wie der normale HA-Pfad. Gemeldet wird
   nur eine echte Wertänderung — ein unveränderter Poll darf keinen laufenden
   optimistischen Intent anfassen. */

type HotelEntityListener = (entityId: string, value: unknown) => void;
type HotelConnectionListener = (online: boolean) => void;

const entityListeners = new Set<HotelEntityListener>();
const connectionListeners = new Set<HotelConnectionListener>();
let online = true;

/** Meldet jede Wertänderung; `undefined` heißt „nicht mehr freigegeben". */
export function onHotelGuestEntity(listener: HotelEntityListener): () => void {
  entityListeners.add(listener);
  for (const entityId of Object.keys(values)) listener(entityId, values[entityId]);
  return () => { entityListeners.delete(listener); };
}

export function onHotelGuestConnection(listener: HotelConnectionListener): () => void {
  connectionListeners.add(listener);
  listener(online);
  return () => { connectionListeners.delete(listener); };
}

function setOnline(next: boolean): void {
  if (online === next) return;
  online = next;
  for (const listener of connectionListeners) listener(next);
}

function emitEntity(entityId: string, value: unknown): void {
  for (const listener of entityListeners) listener(entityId, value);
}

function applyProjection(next: HotelGuestProjection): void {
  hotelGuest.enabled = next.enabled;
  hotelGuest.status = next.status;
  hotelGuest.rooms = next.rooms;
  hotelGuest.scenes = next.scenes;
  hotelGuest.scripts = next.scripts;
  hotelGuest.entities = next.entities;
  hotelGuest.fetchedAt = next.fetchedAt;
  hotelGuest.error = next.error;

  const known = new Set<string>();
  for (const entity of next.entities) {
    const raw: RawEntity = { state: entity.state, attributes: entity.attributes };
    const value = haToValue(entity.entityId, raw, values[entity.entityId]);
    if (value === undefined) continue;
    const changed = JSON.stringify(values[entity.entityId]) !== JSON.stringify(value);
    values[entity.entityId] = value;
    known.add(entity.entityId);
    if (changed) emitEntity(entity.entityId, value);
  }
  // Was der Server nicht mehr freigibt, verschwindet sofort — ein Gast darf
  // keinen zurückgezogenen Zustand weiterbedienen.
  for (const entityId of Object.keys(values)) {
    if (known.has(entityId)) continue;
    delete values[entityId];
    emitEntity(entityId, undefined);
  }
}

/**
 * Ein Abruf. Bei Serverproblemen bleibt der zuletzt bekannte Zustand stehen und
 * nur `error` wechselt — die Oberfläche zeigt dann „Verbindung verloren", statt
 * Geräte grundlos verschwinden zu lassen.
 */
export async function refreshHotelGuestEntities(): Promise<void> {
  let payload: unknown = null;
  try {
    const response = await fetch(HOTEL_ENTITIES_ENDPOINT, {
      cache: 'no-store',
      // Der Gastpfad ist bewusst anonym: keine Adminsitzung, kein Token.
      credentials: 'omit',
      signal: AbortSignal.timeout(HOTEL_ENTITIES_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`hotel entities ${response.status}`);
    payload = await response.json();
  } catch {
    hotelGuest.error = 'HOTEL_ENTITIES_UNREACHABLE';
    setOnline(false);
    return;
  }
  setOnline(true);
  applyProjection(parseHotelGuestProjection(payload));
}

/** Startet das Polling und liefert die Stoppfunktion. */
export function startHotelGuestEntities(intervalMs = HOTEL_ENTITIES_POLL_MS): () => void {
  void refreshHotelGuestEntities();
  const timer = setInterval(() => { void refreshHotelGuestEntities(); }, intervalMs);
  return () => clearInterval(timer);
}
