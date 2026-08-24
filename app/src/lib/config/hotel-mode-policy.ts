import {
  HOTEL_HVAC_MODES,
  type HotelCalendarConfig,
  type HotelGuestAction,
  type HotelModeConfig,
  type HotelTemperatureRange,
} from './household-config.ts';

/**
 * Pure hotel-mode decisions. Nothing here reads a clock, a network or a store:
 * every caller passes the current instant and the already validated policy, so
 * the server and the tests evaluate exactly the same rules.
 */

export interface HotelCalendarEventInput {
  /** Stable identity of the calendar event; used as the opaque stay ID source. */
  uid: string;
  summary?: string | null;
  description?: string | null;
  /** ISO date-time for timed events or `YYYY-MM-DD` for all-day events. */
  start: string;
  /** All-day ends are exclusive, matching iCalendar and Home Assistant. */
  end: string;
}

export interface HotelStay {
  uid: string;
  allDay: boolean;
  /** Epoch milliseconds. */
  checkIn: number;
  checkOut: number;
  guestName: string | null;
  welcomeMessage: string | null;
}

export type HotelStayIssueCode =
  | 'INVALID_START'
  | 'INVALID_END'
  | 'MIXED_DATE_KINDS'
  | 'EMPTY_WINDOW'
  | 'OVERLAP'
  | 'INVALID_CALENDAR';

export interface HotelStayIssue {
  code: HotelStayIssueCode;
  uid: string;
  message: string;
}

export type HotelStayResolution =
  | { ok: true; stay: HotelStay }
  | { ok: false; issue: HotelStayIssue };

export interface HotelStayProjection {
  stays: HotelStay[];
  issues: HotelStayIssue[];
}

export type HotelStayStatus =
  | { status: 'inactive'; nextStay: HotelStay | null }
  | { status: 'active'; stay: HotelStay }
  | { status: 'conflict'; issues: HotelStayIssue[] };

const ALL_DAY_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ALL_DAY_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MINUTE_MS = 60_000;

function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const field = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return asUtc - instantMs;
}

/**
 * Resolves a local wall-clock date and time in an IANA zone to an instant. The
 * second pass settles DST transitions where the first guessed offset is stale.
 */
export function zonedWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstOffset = timeZoneOffsetMs(naive, timeZone);
  const secondOffset = timeZoneOffsetMs(naive - firstOffset, timeZone);
  return naive - secondOffset;
}

function parseAllDayBoundary(
  value: string,
  timeOfDay: string,
  timeZone: string,
): number | null {
  const date = ALL_DAY_DATE.exec(value);
  if (!date) return null;
  const [hour, minute] = timeOfDay.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  // Date.UTC silently rolls a February 30th over, so reject it explicitly.
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDay.getUTCFullYear() !== year
    || calendarDay.getUTCMonth() !== month - 1
    || calendarDay.getUTCDate() !== day
  ) {
    return null;
  }
  return zonedWallClockToInstant(year, month, day, hour, minute, timeZone);
}

function parseTimedBoundary(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Projects a single calendar event onto a stay window. All-day events use the
 * configured default times; a malformed event never degrades into a guess.
 */
export function resolveStayWindow(
  event: HotelCalendarEventInput,
  calendar: HotelCalendarConfig,
): HotelStayResolution {
  const uid = event.uid;
  if (calendar.timeZone === '' || !ALL_DAY_TIME.test(calendar.allDayCheckIn) || !ALL_DAY_TIME.test(calendar.allDayCheckOut)) {
    return {
      ok: false,
      issue: { code: 'INVALID_CALENDAR', uid, message: 'The calendar policy has no usable time zone or default times.' },
    };
  }

  const startIsAllDay = ALL_DAY_DATE.test(event.start);
  const endIsAllDay = ALL_DAY_DATE.test(event.end);
  if (startIsAllDay !== endIsAllDay) {
    return {
      ok: false,
      issue: { code: 'MIXED_DATE_KINDS', uid, message: 'A stay must not mix an all-day boundary with a timed one.' },
    };
  }

  const checkIn = startIsAllDay
    ? parseAllDayBoundary(event.start, calendar.allDayCheckIn, calendar.timeZone)
    : parseTimedBoundary(event.start);
  if (checkIn === null) {
    return { ok: false, issue: { code: 'INVALID_START', uid, message: 'The stay start is not a usable date or date-time.' } };
  }
  const checkOut = endIsAllDay
    ? parseAllDayBoundary(event.end, calendar.allDayCheckOut, calendar.timeZone)
    : parseTimedBoundary(event.end);
  if (checkOut === null) {
    return { ok: false, issue: { code: 'INVALID_END', uid, message: 'The stay end is not a usable date or date-time.' } };
  }
  if (checkOut <= checkIn) {
    return { ok: false, issue: { code: 'EMPTY_WINDOW', uid, message: 'A stay must end after it starts.' } };
  }

  return {
    ok: true,
    stay: {
      uid,
      allDay: startIsAllDay,
      checkIn,
      checkOut,
      guestName: trimmedOrNull(event.summary),
      welcomeMessage: calendar.useDescriptionAsWelcome ? trimmedOrNull(event.description) : null,
    },
  };
}

/** Projects every calendar event and keeps the rejected ones as admin diagnostics. */
export function projectStays(
  events: readonly HotelCalendarEventInput[],
  calendar: HotelCalendarConfig,
): HotelStayProjection {
  const stays: HotelStay[] = [];
  const issues: HotelStayIssue[] = [];
  for (const event of events) {
    const resolved = resolveStayWindow(event, calendar);
    if (resolved.ok) stays.push(resolved.stay);
    else issues.push(resolved.issue);
  }
  stays.sort((left, right) => left.checkIn - right.checkIn || (left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0));
  return { stays, issues };
}

/** Reports every pair of stays that share time, which is never a valid apartment state. */
export function findOverlappingStays(stays: readonly HotelStay[]): HotelStayIssue[] {
  const ordered = [...stays].sort((left, right) => left.checkIn - right.checkIn);
  const issues: HotelStayIssue[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.checkIn < previous.checkOut) {
      issues.push({
        code: 'OVERLAP',
        uid: current.uid,
        message: `Stay "${current.uid}" overlaps stay "${previous.uid}".`,
      });
    }
  }
  return issues;
}

export function isStayActive(stay: HotelStay, nowMs: number): boolean {
  return nowMs >= stay.checkIn && nowMs < stay.checkOut;
}

export interface HotelStaySelectionOptions {
  /**
   * Latest instant a stay may have started at to still count as active. Reading
   * a cached projection passes the fetch time here so a cache can keep a
   * running stay alive but never open a stay that began after the last fetch.
   */
  activeSince?: number;
}

/**
 * Fail-closed stay selection: any unusable event and any overlap keeps the
 * apartment neutral, and the reason stays an admin-only diagnostic.
 */
export function selectStayStatus(
  projection: HotelStayProjection,
  nowMs: number,
  { activeSince = Number.POSITIVE_INFINITY }: HotelStaySelectionOptions = {},
): HotelStayStatus {
  const overlaps = findOverlappingStays(projection.stays);
  const issues = [...projection.issues, ...overlaps];
  if (issues.length > 0) return { status: 'conflict', issues };

  const active = projection.stays.find((stay) => isStayActive(stay, nowMs) && stay.checkIn <= activeSince);
  if (active) return { status: 'active', stay: active };

  return { status: 'inactive', nextStay: projection.stays.find((stay) => stay.checkIn > nowMs) ?? null };
}

export interface HotelGuestCommand {
  entityId: string;
  action: HotelGuestAction;
  /** Numeric setpoint for set_temperature or the HVAC mode for set_hvac_mode. */
  value?: unknown;
}

export type HotelCommandDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'DISABLED' | 'ENTITY_NOT_ALLOWED' | 'ACTION_NOT_ALLOWED' | 'VALUE_NOT_ALLOWED';
    };

function activeGuestPolicy(hotelMode: HotelModeConfig | undefined): HotelModeConfig | null {
  return hotelMode !== undefined && hotelMode.enabled ? hotelMode : null;
}

/** Flat, duplicate-free set of every entity a guest may observe. */
export function guestVisibleEntityIds(hotelMode: HotelModeConfig | undefined): string[] {
  const policy = activeGuestPolicy(hotelMode);
  if (!policy) return [];
  const entityIds = new Set<string>();
  for (const room of policy.guestAccess.rooms) {
    for (const entity of room.entities) entityIds.add(entity.entityId);
  }
  return [...entityIds].sort();
}

/** Room IDs a guest may navigate to, in configured order. */
export function guestVisibleRoomIds(hotelMode: HotelModeConfig | undefined): string[] {
  const policy = activeGuestPolicy(hotelMode);
  if (!policy) return [];
  return policy.guestAccess.rooms.filter((room) => room.entities.length > 0).map((room) => room.roomId);
}

function findGuestEntity(policy: HotelModeConfig, entityId: string) {
  for (const room of policy.guestAccess.rooms) {
    const entity = room.entities.find((candidate) => candidate.entityId === entityId);
    if (entity) return entity;
  }
  return undefined;
}

/**
 * Default-deny command check. Unknown entities, unreleased actions and values
 * outside the configured range are rejected without any implicit widening.
 */
export function evaluateGuestCommand(
  hotelMode: HotelModeConfig | undefined,
  command: HotelGuestCommand,
): HotelCommandDecision {
  const policy = activeGuestPolicy(hotelMode);
  if (!policy) return { allowed: false, reason: 'DISABLED' };

  if (command.action === 'turn_on' && (command.entityId.startsWith('scene.') || command.entityId.startsWith('script.'))) {
    const released = command.entityId.startsWith('scene.')
      ? policy.guestAccess.scenes
      : policy.guestAccess.scripts;
    return released.includes(command.entityId)
      ? { allowed: true }
      : { allowed: false, reason: 'ENTITY_NOT_ALLOWED' };
  }

  const entity = findGuestEntity(policy, command.entityId);
  if (!entity) return { allowed: false, reason: 'ENTITY_NOT_ALLOWED' };
  if (!entity.actions.includes(command.action)) return { allowed: false, reason: 'ACTION_NOT_ALLOWED' };

  if (command.action === 'set_temperature') {
    const range = entity.temperatureRange;
    if (range === null) return { allowed: false, reason: 'VALUE_NOT_ALLOWED' };
    const value = command.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) {
      return { allowed: false, reason: 'VALUE_NOT_ALLOWED' };
    }
    return { allowed: true };
  }
  if (command.action === 'set_hvac_mode') {
    return typeof command.value === 'string' && (HOTEL_HVAC_MODES as readonly string[]).includes(command.value)
      ? { allowed: true }
      : { allowed: false, reason: 'VALUE_NOT_ALLOWED' };
  }
  return command.value === undefined
    ? { allowed: true }
    : { allowed: false, reason: 'VALUE_NOT_ALLOWED' };
}

/** Milliseconds of admin inactivity after which the session falls back to the guest state. */
export function adminIdleTimeoutMs(hotelMode: HotelModeConfig | undefined): number {
  return (hotelMode?.adminIdleTimeoutMinutes ?? 15) * MINUTE_MS;
}

/* ── Gastprojektion ──
   Was ein aktiver Gast vom Server sehen darf: die freigegebene Raum-/Aktions-
   Struktur und pro Entity nur die Attribute, die Hausers bestehende Controls
   wirklich lesen. Beides sind reine Funktionen, damit Proxy und Client dieselbe
   Grenze auswerten. */

export interface HotelGuestEntityProjection {
  entityId: string;
  actions: HotelGuestAction[];
  temperatureRange: HotelTemperatureRange | null;
}

export interface HotelGuestRoomProjection {
  roomId: string;
  entities: HotelGuestEntityProjection[];
}

export interface HotelGuestAccessProjection {
  rooms: HotelGuestRoomProjection[];
  scenes: string[];
  scripts: string[];
}

/** Roher Home-Assistant-Zustand, wie ihn der Proxy von der REST-API erhält. */
export interface HotelRawEntityState {
  state: string;
  attributes?: Record<string, unknown> | null;
}

export interface HotelGuestEntityState {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
}

/**
 * Attribut-Allowlist je Domäne. Alles andere — Anzeigenamen, Geräte-IDs,
 * Feature-Bitmasken, Kontextdaten — bleibt auf dem Server. Eine hier nicht
 * gelistete Domäne wird gar nicht projiziert.
 */
const HOTEL_GUEST_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  light: ['brightness', 'color_mode', 'color_temp', 'color_temp_kelvin', 'rgb_color'],
  climate: ['current_temperature', 'temperature'],
  switch: [],
  vacuum: [],
};

export function hotelEntityDomain(entityId: string): string {
  const separator = entityId.indexOf('.');
  return separator === -1 ? '' : entityId.slice(0, separator);
}

/** Die freigegebene Struktur selbst; ohne aktive Policy bleibt sie leer. */
export function projectGuestAccess(hotelMode: HotelModeConfig | undefined): HotelGuestAccessProjection {
  const policy = activeGuestPolicy(hotelMode);
  if (!policy) return { rooms: [], scenes: [], scripts: [] };
  return {
    rooms: policy.guestAccess.rooms
      .filter((room) => room.entities.length > 0)
      .map((room) => ({
        roomId: room.roomId,
        entities: room.entities.map((entity) => ({
          entityId: entity.entityId,
          actions: [...entity.actions],
          temperatureRange: entity.temperatureRange === null ? null : { ...entity.temperatureRange },
        })),
      })),
    scenes: [...policy.guestAccess.scenes],
    scripts: [...policy.guestAccess.scripts],
  };
}

/**
 * Reduziert einen rohen Entity-Zustand auf das, was der Gast bedienen kann.
 * Eine unbekannte Domäne oder ein unbrauchbarer Zustand liefert `null` — der
 * Gast sieht das Gerät dann gar nicht, statt einen geratenen Wert zu bekommen.
 */
export function projectGuestEntityState(
  entityId: string,
  raw: HotelRawEntityState | null | undefined,
): HotelGuestEntityState | null {
  const keys = HOTEL_GUEST_ATTRIBUTES[hotelEntityDomain(entityId)];
  if (keys === undefined) return null;
  if (!raw || typeof raw.state !== 'string') return null;
  const source = raw.attributes && typeof raw.attributes === 'object' && !Array.isArray(raw.attributes)
    ? raw.attributes
    : {};
  const attributes: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) attributes[key] = source[key];
  }
  return { entityId, state: raw.state, attributes };
}

/* ── Gastbefehle ──
   Der Gastpfad schickt keinen Service-Call, sondern eine Absicht: Entity plus
   eine der wenigen Aktionen aus H01. Erst diese reine Funktion entscheidet, ob
   daraus überhaupt ein Home-Assistant-Aufruf werden darf, und baut die Nutzlast
   aus einer geschlossenen Feldliste neu auf. Was der Client sonst noch
   mitschickt — Domain, Zusatzfelder, fremde Werte — fällt hier weg. */

export const HOTEL_GUEST_ACTIONS: readonly HotelGuestAction[] = [
  'turn_on', 'turn_off', 'set_temperature', 'set_hvac_mode', 'start', 'return_to_base',
];

/** `domain.object_id`, wie Home Assistant Entities benennt. */
const HOTEL_ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

type HotelPayloadCheck = (value: unknown) => boolean;

const isPercent: HotelPayloadCheck = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const isKelvin: HotelPayloadCheck = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 10_000;
const isRgb: HotelPayloadCheck = (value) =>
  Array.isArray(value) && value.length === 3
  && value.every((part) => typeof part === 'number' && Number.isInteger(part) && part >= 0 && part <= 255);
const isFiniteNumber: HotelPayloadCheck = (value) => typeof value === 'number' && Number.isFinite(value);
const isHvacMode: HotelPayloadCheck = (value) =>
  typeof value === 'string' && (HOTEL_HVAC_MODES as readonly string[]).includes(value);

/**
 * Erlaubte Nutzlastfelder je `domain:action`. Nicht gelistete Kombinationen
 * tragen gar keine Felder — Helligkeit, Farbe und Zielwerte sind genau das, was
 * Hausers vorhandene Controls senden, mehr braucht der Gastpfad nicht.
 */
const HOTEL_GUEST_PAYLOADS: Readonly<Record<string, Readonly<Record<string, HotelPayloadCheck>>>> = {
  'light:turn_on': { brightness_pct: isPercent, color_temp_kelvin: isKelvin, rgb_color: isRgb },
  'climate:set_temperature': { temperature: isFiniteNumber },
  'climate:set_hvac_mode': { hvac_mode: isHvacMode },
};

const NO_PAYLOAD: Readonly<Record<string, HotelPayloadCheck>> = {};

export interface HotelGuestServiceRequest {
  entityId: unknown;
  action: unknown;
  /** Rohe Nutzlast des Clients; nur bekannte Felder überleben die Prüfung. */
  data?: unknown;
}

export interface HotelGuestServiceCall {
  domain: string;
  service: string;
  entityId: string;
  data: Record<string, unknown>;
}

export type HotelServiceCallDecision =
  | { allowed: true; call: HotelGuestServiceCall }
  | { allowed: false; reason: 'DISABLED' | 'ENTITY_NOT_ALLOWED' | 'ACTION_NOT_ALLOWED' | 'VALUE_NOT_ALLOWED' };

/**
 * Default-Deny bis zum fertigen Service-Call: die Domain stammt aus der
 * Entity-ID, der Service ausschließlich aus der freigegebenen Aktionsliste und
 * die Nutzlast aus neu aufgebauten, einzeln geprüften Feldern.
 */
export function resolveGuestServiceCall(
  hotelMode: HotelModeConfig | undefined,
  request: HotelGuestServiceRequest,
): HotelServiceCallDecision {
  const entityId = typeof request.entityId === 'string' ? request.entityId : '';
  if (!HOTEL_ENTITY_ID.test(entityId)) return { allowed: false, reason: 'ENTITY_NOT_ALLOWED' };

  const action = request.action;
  if (typeof action !== 'string' || !(HOTEL_GUEST_ACTIONS as readonly string[]).includes(action)) {
    return { allowed: false, reason: 'ACTION_NOT_ALLOWED' };
  }

  const raw = request.data;
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    return { allowed: false, reason: 'VALUE_NOT_ALLOWED' };
  }

  const domain = hotelEntityDomain(entityId);
  const fields = HOTEL_GUEST_PAYLOADS[`${domain}:${action}`] ?? NO_PAYLOAD;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const check = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (check === undefined || !check(value)) return { allowed: false, reason: 'VALUE_NOT_ALLOWED' };
    data[key] = value;
  }

  // Der Wertebereich einer Entity gehört zur Policy, nicht zur Nutzlastform:
  // set_temperature und set_hvac_mode reichen ihren Wert deshalb weiter.
  const value = action === 'set_temperature'
    ? data.temperature
    : action === 'set_hvac_mode' ? data.hvac_mode : undefined;
  const decision = evaluateGuestCommand(hotelMode, { entityId, action: action as HotelGuestAction, value });
  if (!decision.allowed) return decision;

  return { allowed: true, call: { domain, service: action, entityId, data } };
}
