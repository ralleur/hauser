/* ── Reine Regeln des Welcome Screens ──
   Personenbezug entsteht ausschließlich während eines laufenden Aufenthalts.
   Ohne individuelle Nachricht gibt es keine automatisch erzeugte Begrüßung,
   sondern nur die feste Nutzungseinladung (docs/hotel-mode-plan.md §5). */

import type { HotelBootstrapState } from '../hotel-mode-bootstrap.ts';

/** Bleibt bewusst Englisch: ein Gast versteht „Tap Me" ohne Sprachwahl. */
export const HOTEL_WELCOME_CALL_TO_ACTION = 'Tap Me';
const HOTEL_WELCOME_MESSAGE_MAX = 500;
/* Steuerzeichen aus einem fremden Kalendereintrag gehören nicht auf den Schirm. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export interface HotelWelcomeView {
  message: string | null;
  callToAction: typeof HOTEL_WELCOME_CALL_TO_ACTION;
}

/**
 * Kürzt und säubert die Kalenderbeschreibung für die Anzeige. Ein leerer oder
 * unbrauchbarer Wert wird zu `null` — dann bleibt es bei der Einladung.
 */
export function hotelWelcomeMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(CONTROL_CHARACTERS, ' ').trim();
  if (cleaned === '') return null;
  return cleaned.length > HOTEL_WELCOME_MESSAGE_MAX
    ? `${cleaned.slice(0, HOTEL_WELCOME_MESSAGE_MAX).trimEnd()}…`
    : cleaned;
}

/**
 * Der Welcome Screen existiert nur im aktiven Gastzustand. Neutral, admin und
 * ein deaktivierter Hotel Mode liefern `null` — dort darf gar keine
 * Aufenthaltsinformation erscheinen.
 */
export function hotelWelcomeView(state: HotelBootstrapState): HotelWelcomeView | null {
  if (state.surface !== 'active') return null;
  return {
    message: hotelWelcomeMessage(state.welcomeMessage),
    callToAction: HOTEL_WELCOME_CALL_TO_ACTION,
  };
}
