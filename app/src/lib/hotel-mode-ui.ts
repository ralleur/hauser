/* ── Reine Regeln der Hotel-Adminbedienung ──
   PIN-Eingabe, Rückmeldung und Inaktivität als kleine Funktionen ohne DOM und
   ohne Netz: der Store und die Komponenten werten dieselben Regeln aus, und die
   Tests kommen ohne Browser aus. */

export const HOTEL_PIN_MIN_LENGTH = 6;
export const HOTEL_PIN_MAX_LENGTH = 12;
/** Der Server verlängert bei jedem Touch; öfter als einmal pro Minute bringt nichts. */
export const HOTEL_TOUCH_INTERVAL_MS = 60_000;

export function appendPinDigit(current: string, digit: string): string {
  if (!/^\d$/.test(digit) || current.length >= HOTEL_PIN_MAX_LENGTH) return current;
  return current + digit;
}

export function deletePinDigit(current: string): string {
  return current.slice(0, -1);
}

export function pinReadyToSubmit(current: string): boolean {
  return current.length >= HOTEL_PIN_MIN_LENGTH && current.length <= HOTEL_PIN_MAX_LENGTH;
}

export type HotelUnlockFeedback = 'none' | 'mismatch' | 'rate-limited' | 'not-configured' | 'unavailable';

export interface HotelUnlockOutcome {
  ok: boolean;
  feedback: HotelUnlockFeedback;
  /** Nur bei `rate-limited` gesetzt; sonst 0. */
  retryAfterMs: number;
}

/**
 * Übersetzt die Serverantwort in eine ruhige Rückmeldung. Fehlversuchszähler,
 * Blockstufen und Sperrzeitpunkte des Servers bleiben absichtlich außen vor —
 * der Bildschirm hängt in einem Gastzimmer.
 */
export function interpretUnlockResponse(status: number, payload: unknown): HotelUnlockOutcome {
  if (status === 200) return { ok: true, feedback: 'none', retryAfterMs: 0 };
  const code = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).code
    : undefined;
  if (status === 429 || code === 'HOTEL_PIN_RATE_LIMITED') {
    return { ok: false, feedback: 'rate-limited', retryAfterMs: 0 };
  }
  if (status === 503 || code === 'HOTEL_PIN_NOT_CONFIGURED') {
    return { ok: false, feedback: 'not-configured', retryAfterMs: 0 };
  }
  if (status === 401) return { ok: false, feedback: 'mismatch', retryAfterMs: 0 };
  return { ok: false, feedback: 'unavailable', retryAfterMs: 0 };
}

/** `Retry-After` in Sekunden; alles Unbrauchbare wird zu 0. */
export function retryAfterMs(header: string | null): number {
  if (typeof header !== 'string') return 0;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : 0;
}

/**
 * Nur echte Benutzerinteraktion verlängert die Adminsitzung. Hintergrundtakte,
 * Serverantworten und synthetische Events tun das ausdrücklich nicht — sonst
 * bliebe ein vergessenes Panel dauerhaft offen.
 */
export function extendsAdminSession(event: { type: string; isTrusted?: boolean }): boolean {
  if (event.isTrusted === false) return false;
  return event.type === 'pointerdown' || event.type === 'keydown';
}

/** Ob der nächste Touch fällig ist; `lastTouchAt === 0` heißt „noch nie". */
export function shouldTouchSession(lastTouchAt: number, nowMs: number): boolean {
  return lastTouchAt === 0 || nowMs - lastTouchAt >= HOTEL_TOUCH_INTERVAL_MS;
}
