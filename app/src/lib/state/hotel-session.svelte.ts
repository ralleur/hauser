/* ── Adminsitzung im Client (Hotel Mode) ──
   Der Server hält die Wahrheit: Ablauf, Backoff und Cookie leben dort. Dieser
   Store spiegelt nur den Zustand, schickt PIN, Lock und Touch und beobachtet
   den Ablauf lokal, damit die Oberfläche nicht offen stehen bleibt.

   Der Statusabruf verlängert bewusst nichts (`/session` ist read-only) —
   verlängert wird ausschließlich durch echte Pointer-/Tastaturinteraktion. */

import {
  extendsAdminSession,
  interpretUnlockResponse,
  retryAfterMs,
  shouldTouchSession,
  type HotelUnlockFeedback,
} from '../hotel-mode-ui.ts';

export const HOTEL_SESSION_ENDPOINT = '/api/hotel-mode/session';
export const HOTEL_UNLOCK_ENDPOINT = '/api/hotel-mode/unlock';
export const HOTEL_LOCK_ENDPOINT = '/api/hotel-mode/lock';
export const HOTEL_TOUCH_ENDPOINT = '/api/hotel-mode/touch';
const HOTEL_SESSION_TIMEOUT_MS = 4000;

export interface HotelSessionState {
  configured: boolean;
  unlocked: boolean;
  /** Serverseitiger Ablaufzeitpunkt in Millisekunden. */
  expiresAt: number | null;
  feedback: HotelUnlockFeedback;
  /** Verbleibende Sperrzeit nach zu vielen Fehlversuchen. */
  retryAfterMs: number;
  busy: boolean;
}

export const hotelSession = $state<HotelSessionState>({
  configured: false,
  unlocked: false,
  expiresAt: null,
  feedback: 'none',
  retryAfterMs: 0,
  busy: false,
});

function applyStatus(payload: unknown): void {
  const document = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  hotelSession.configured = document.configured === true;
  hotelSession.unlocked = document.unlocked === true;
  hotelSession.expiresAt = typeof document.expiresAt === 'number' ? document.expiresAt : null;
}

async function send(url: string, body?: unknown): Promise<{ status: number; payload: unknown; headers: Headers | null }> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(HOTEL_SESSION_TIMEOUT_MS),
  });
  let payload: unknown = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, payload, headers: response.headers };
}

/** Read-only: verlängert die Sitzung ausdrücklich nicht. */
export async function refreshHotelSession(): Promise<void> {
  try {
    const { status, payload } = await send(HOTEL_SESSION_ENDPOINT);
    if (status === 200) applyStatus(payload);
  } catch { /* der lokale Ablauf greift weiterhin */ }
}

export async function unlockHotelAdmin(pin: string): Promise<boolean> {
  hotelSession.busy = true;
  try {
    const { status, payload, headers } = await send(HOTEL_UNLOCK_ENDPOINT, { pin });
    const outcome = interpretUnlockResponse(status, payload);
    hotelSession.feedback = outcome.feedback;
    hotelSession.retryAfterMs = outcome.feedback === 'rate-limited'
      ? retryAfterMs(headers?.get('retry-after') ?? null)
      : 0;
    if (outcome.ok) applyStatus(payload);
    return outcome.ok;
  } catch {
    hotelSession.feedback = 'unavailable';
    hotelSession.retryAfterMs = 0;
    return false;
  } finally {
    hotelSession.busy = false;
  }
}

/** Beendet die Sitzung serverseitig; der Rückfall in den Gastzustand folgt danach. */
export async function lockHotelAdmin(): Promise<void> {
  try {
    const { status, payload } = await send(HOTEL_LOCK_ENDPOINT, {});
    if (status === 200) applyStatus(payload);
  } catch { /* das Cookie läuft serverseitig ohnehin ab */ }
  hotelSession.unlocked = false;
  hotelSession.expiresAt = null;
  hotelSession.feedback = 'none';
}

async function touchHotelAdmin(): Promise<void> {
  try {
    const { status, payload } = await send(HOTEL_TOUCH_ENDPOINT, {});
    if (status === 200) applyStatus(payload);
  } catch { /* der lokale Ablauf greift weiterhin */ }
}

export interface HotelIdleWatchOptions {
  /** Ziel der Interaktionslistener; produktiv das Fenster. */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
  /** Wird gerufen, sobald die Sitzung abgelaufen oder beendet ist. */
  onExpired: () => void;
  intervalMs?: number;
}

/**
 * Beobachtet die Adminsitzung: echte Interaktion verlängert sie höchstens
 * minütlich, ein abgelaufener Ablaufzeitpunkt beendet sie. Hintergrundtakte und
 * Serverantworten verlängern nichts.
 */
export function startHotelAdminIdleWatch({
  target,
  now = () => Date.now(),
  onExpired,
  intervalMs = 15_000,
}: HotelIdleWatchOptions): () => void {
  const listenTarget = target ?? (typeof window === 'undefined' ? null : window);
  let lastTouchAt = now();
  let finished = false;

  function finish(): void {
    if (finished) return;
    finished = true;
    stop();
    onExpired();
  }

  function onInteraction(event: Event): void {
    if (finished || !extendsAdminSession(event)) return;
    const moment = now();
    if (!shouldTouchSession(lastTouchAt, moment)) return;
    lastTouchAt = moment;
    void touchHotelAdmin();
  }

  const timer = setInterval(() => {
    if (!hotelSession.unlocked) return finish();
    if (hotelSession.expiresAt !== null && hotelSession.expiresAt <= now()) finish();
  }, intervalMs);

  listenTarget?.addEventListener('pointerdown', onInteraction, true);
  listenTarget?.addEventListener('keydown', onInteraction, true);

  function stop(): void {
    clearInterval(timer);
    listenTarget?.removeEventListener('pointerdown', onInteraction, true);
    listenTarget?.removeEventListener('keydown', onInteraction, true);
  }

  return stop;
}
