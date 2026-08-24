/* ── Formmodell der Hotel-Mode-Betriebseinstellungen ──
   Reine Funktionen zwischen Eingabemaske und v4-Vertrag. Die GUI schreibt nie
   freien Policy-Text: sie füllt diesen Entwurf, und erst `draftToHotelMode`
   erzeugt daraus den Block, den `parseHouseholdConfig` prüft. Was hier nicht
   gültig ist, wird gar nicht erst gesendet.

   Die Geräte-Allowlist gehört ausdrücklich nicht hierher (H09); dieser Entwurf
   reicht sie unverändert durch. */

import type {
  HotelGuestAccessConfig,
  HotelModeConfig,
} from '../../config/household-config.ts';

export interface HotelModeDraft {
  enabled: boolean;
  calendarEntityId: string;
  timeZone: string;
  allDayCheckIn: string;
  allDayCheckOut: string;
  useDescriptionAsWelcome: boolean;
  checkoutEnabled: boolean;
  /** Leer heißt „keine Szene" — Hauser verändert dann beim Checkout nichts. */
  checkoutSceneEntityId: string;
  adminIdleTimeoutMinutes: number;
  kioskAcknowledged: boolean;
}

export type HotelModeDraftField =
  | 'calendarEntityId'
  | 'timeZone'
  | 'allDayCheckIn'
  | 'allDayCheckOut'
  | 'checkoutSceneEntityId'
  | 'adminIdleTimeoutMinutes'
  | 'kioskAcknowledged';

export interface HotelModeDraftIssue {
  field: HotelModeDraftField;
  code: 'REQUIRED' | 'INVALID';
}

export const HOTEL_ADMIN_IDLE_MIN_MINUTES = 1;
export const HOTEL_ADMIN_IDLE_MAX_MINUTES = 120;

const HA_ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function entityIdInDomain(value: string, domain: string): boolean {
  return HA_ENTITY_ID.test(value) && value.startsWith(`${domain}.`);
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Voreinstellung eines noch nicht eingerichteten Apartments (Plan §4). */
export function emptyHotelModeDraft(): HotelModeDraft {
  return {
    enabled: false,
    calendarEntityId: '',
    timeZone: defaultTimeZone(),
    allDayCheckIn: '15:00',
    allDayCheckOut: '11:00',
    useDescriptionAsWelcome: true,
    checkoutEnabled: true,
    checkoutSceneEntityId: '',
    adminIdleTimeoutMinutes: 15,
    kioskAcknowledged: false,
  };
}

export function defaultTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

export function draftFromHotelMode(hotelMode: HotelModeConfig | undefined): HotelModeDraft {
  if (!hotelMode) return emptyHotelModeDraft();
  return {
    enabled: hotelMode.enabled,
    calendarEntityId: hotelMode.calendar.entityId,
    timeZone: hotelMode.calendar.timeZone,
    allDayCheckIn: hotelMode.calendar.allDayCheckIn,
    allDayCheckOut: hotelMode.calendar.allDayCheckOut,
    useDescriptionAsWelcome: hotelMode.calendar.useDescriptionAsWelcome,
    checkoutEnabled: hotelMode.checkout.enabled,
    checkoutSceneEntityId: hotelMode.checkout.sceneEntityId ?? '',
    adminIdleTimeoutMinutes: hotelMode.adminIdleTimeoutMinutes,
    kioskAcknowledged: hotelMode.kioskAcknowledged,
  };
}

/**
 * Prüft exakt die Grenzen, die der v4-Parser zieht. Ein Entwurf ohne Befunde
 * ergibt garantiert einen annehmbaren `hotelMode`-Block.
 */
export function validateHotelModeDraft(draft: HotelModeDraft): HotelModeDraftIssue[] {
  const issues: HotelModeDraftIssue[] = [];
  if (draft.calendarEntityId === '') issues.push({ field: 'calendarEntityId', code: 'REQUIRED' });
  else if (!entityIdInDomain(draft.calendarEntityId, 'calendar')) {
    issues.push({ field: 'calendarEntityId', code: 'INVALID' });
  }

  if (draft.timeZone === '') issues.push({ field: 'timeZone', code: 'REQUIRED' });
  else if (!isValidTimeZone(draft.timeZone)) issues.push({ field: 'timeZone', code: 'INVALID' });

  for (const field of ['allDayCheckIn', 'allDayCheckOut'] as const) {
    if (!TIME_OF_DAY.test(draft[field])) issues.push({ field, code: 'INVALID' });
  }

  if (draft.checkoutSceneEntityId !== '' && !entityIdInDomain(draft.checkoutSceneEntityId, 'scene')) {
    issues.push({ field: 'checkoutSceneEntityId', code: 'INVALID' });
  }

  const minutes = draft.adminIdleTimeoutMinutes;
  if (!Number.isSafeInteger(minutes)
      || minutes < HOTEL_ADMIN_IDLE_MIN_MINUTES
      || minutes > HOTEL_ADMIN_IDLE_MAX_MINUTES) {
    issues.push({ field: 'adminIdleTimeoutMinutes', code: 'INVALID' });
  }

  // Der Parser lehnt einen aktiven Hotel Mode ohne bestätigte Kioskcheckliste ab.
  if (draft.enabled && !draft.kioskAcknowledged) {
    issues.push({ field: 'kioskAcknowledged', code: 'REQUIRED' });
  }
  return issues;
}

export function draftToHotelMode(
  draft: HotelModeDraft,
  guestAccess: HotelGuestAccessConfig,
): HotelModeConfig {
  return {
    enabled: draft.enabled,
    calendar: {
      entityId: draft.calendarEntityId,
      timeZone: draft.timeZone,
      allDayCheckIn: draft.allDayCheckIn,
      allDayCheckOut: draft.allDayCheckOut,
      useDescriptionAsWelcome: draft.useDescriptionAsWelcome,
    },
    guestAccess,
    checkout: {
      enabled: draft.checkoutEnabled,
      sceneEntityId: draft.checkoutSceneEntityId === '' ? null : draft.checkoutSceneEntityId,
    },
    adminIdleTimeoutMinutes: draft.adminIdleTimeoutMinutes,
    kioskAcknowledged: draft.kioskAcknowledged,
  };
}

export type HotelActivationBlocker =
  | 'DRAFT_INVALID'
  | 'PIN_MISSING'
  | 'KIOSK_UNCONFIRMED'
  | 'NO_GUEST_ACCESS'
  | 'PREFLIGHT_PENDING';

export interface HotelActivationContext {
  pinConfigured: boolean;
  guestAccess: HotelGuestAccessConfig;
  /** Ob der serverseitige Aktivierungscheck vollständig bestanden ist. */
  preflightReady: boolean;
}

/**
 * Was einer produktiven Aktivierung konkret im Weg steht. Der Schalter bleibt
 * sichtbar — der Admin soll sehen, was noch fehlt, statt auf ein taubes
 * Bedienelement zu treffen.
 */
export function hotelActivationBlockers(
  draft: HotelModeDraft,
  { pinConfigured, guestAccess, preflightReady }: HotelActivationContext,
): HotelActivationBlocker[] {
  const blockers: HotelActivationBlocker[] = [];
  if (validateHotelModeDraft({ ...draft, enabled: false }).length > 0) blockers.push('DRAFT_INVALID');
  if (!pinConfigured) blockers.push('PIN_MISSING');
  if (!draft.kioskAcknowledged) blockers.push('KIOSK_UNCONFIRMED');
  if (!guestAccess.rooms.some((room) => room.entities.length > 0)) blockers.push('NO_GUEST_ACCESS');
  if (!preflightReady) blockers.push('PREFLIGHT_PENDING');
  return blockers;
}

export interface HotelGuestPreviewRoom {
  roomId: string;
  entityIds: string[];
}

export interface HotelGuestPreview {
  rooms: HotelGuestPreviewRoom[];
  scenes: string[];
  scripts: string[];
  entityCount: number;
}

/** Was ein Gast nach dem Speichern tatsächlich sähe — dieselbe Grenze wie im Proxy. */
export function hotelGuestPreview(guestAccess: HotelGuestAccessConfig): HotelGuestPreview {
  const rooms = guestAccess.rooms
    .filter((room) => room.entities.length > 0)
    .map((room) => ({ roomId: room.roomId, entityIds: room.entities.map((entity) => entity.entityId) }));
  return {
    rooms,
    scenes: [...guestAccess.scenes],
    scripts: [...guestAccess.scripts],
    entityCount: new Set(rooms.flatMap((room) => room.entityIds)).size,
  };
}
