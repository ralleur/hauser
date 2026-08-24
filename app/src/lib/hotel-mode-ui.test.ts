import { describe, expect, it } from 'vitest';
import {
  HOTEL_TOUCH_INTERVAL_MS,
  appendPinDigit,
  deletePinDigit,
  extendsAdminSession,
  interpretUnlockResponse,
  pinReadyToSubmit,
  retryAfterMs,
  shouldTouchSession,
} from './hotel-mode-ui.ts';

describe('PIN-Eingabe', () => {
  it('nimmt nur Ziffern und höchstens zwölf davon', () => {
    expect(appendPinDigit('12', '3')).toBe('123');
    for (const noise of ['a', '', '12', ' ', '·']) {
      expect(appendPinDigit('12', noise)).toBe('12');
    }
    expect(appendPinDigit('1'.repeat(12), '2')).toBe('1'.repeat(12));
  });

  it('löscht rückwärts und bleibt bei leerer Eingabe leer', () => {
    expect(deletePinDigit('123')).toBe('12');
    expect(deletePinDigit('')).toBe('');
  });

  it('gibt erst ab sechs Stellen frei', () => {
    expect(pinReadyToSubmit('12345')).toBe(false);
    expect(pinReadyToSubmit('123456')).toBe(true);
    expect(pinReadyToSubmit('1'.repeat(13))).toBe(false);
  });
});

describe('Rückmeldung des Unlock-Versuchs', () => {
  it('bleibt ruhig und nennt keine internen Details', () => {
    expect(interpretUnlockResponse(200, { unlocked: true }))
      .toEqual({ ok: true, feedback: 'none', retryAfterMs: 0 });
    expect(interpretUnlockResponse(401, { code: 'HOTEL_PIN_MISMATCH' }).feedback).toBe('mismatch');
    expect(interpretUnlockResponse(429, { code: 'HOTEL_PIN_RATE_LIMITED' }).feedback).toBe('rate-limited');
    expect(interpretUnlockResponse(503, { code: 'HOTEL_PIN_NOT_CONFIGURED' }).feedback).toBe('not-configured');
    expect(interpretUnlockResponse(500, null).feedback).toBe('unavailable');
  });

  it('liest Retry-After nur als brauchbare Sekundenzahl', () => {
    expect(retryAfterMs('60')).toBe(60_000);
    for (const header of [null, '', 'bald', '-5', '0', 'NaN']) {
      expect(retryAfterMs(header)).toBe(0);
    }
    expect(retryAfterMs('99999')).toBe(3_600_000);
  });
});

describe('Inaktivität', () => {
  it('verlängert nur bei echter Pointer- oder Tastaturinteraktion', () => {
    expect(extendsAdminSession({ type: 'pointerdown', isTrusted: true })).toBe(true);
    expect(extendsAdminSession({ type: 'keydown' })).toBe(true);
    // Netzwerk, Polling und synthetische Events halten die Sitzung nicht offen.
    for (const event of [
      { type: 'pointerdown', isTrusted: false },
      { type: 'visibilitychange', isTrusted: true },
      { type: 'message', isTrusted: true },
      { type: 'scroll', isTrusted: true },
    ]) {
      expect(extendsAdminSession(event)).toBe(false);
    }
  });

  it('schickt höchstens minütlich einen Touch', () => {
    expect(shouldTouchSession(0, 1)).toBe(true);
    expect(shouldTouchSession(1000, 1000 + HOTEL_TOUCH_INTERVAL_MS - 1)).toBe(false);
    expect(shouldTouchSession(1000, 1000 + HOTEL_TOUCH_INTERVAL_MS)).toBe(true);
  });
});
