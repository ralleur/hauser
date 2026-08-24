import { afterEach, describe, expect, it, vi } from 'vitest';

/* Geprüft wird die Sitzungsgrenze im Client: was verlängert, was nicht, und
   dass ein Fehlversuch ruhig bleibt statt Serverinterna zu zeigen. */

async function freshStore() {
  vi.resetModules();
  return await import('./hotel-session.svelte.ts');
}

interface StubResponse {
  status: number;
  payload?: unknown;
  headers?: Record<string, string>;
}

function stubFetch(routes: Record<string, StubResponse | Error>) {
  const calls: { url: string; method: string }[] = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const route = routes[url];
    if (route instanceof Error) throw route;
    if (!route) return { status: 404, headers: new Headers(), json: async () => ({}) };
    return {
      status: route.status,
      headers: new Headers(route.headers ?? {}),
      json: async () => route.payload ?? {},
    };
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

function eventTarget() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  return {
    listeners,
    addEventListener(type: string, listener: (event: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string, event: Record<string, unknown> = {}) {
      for (const listener of listeners.get(type) ?? []) listener({ type, isTrusted: true, ...event });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Adminsitzung', () => {
  it('spiegelt den Serverstatus, ohne ihn zu verlängern', async () => {
    const calls = stubFetch({
      '/api/hotel-mode/session': { status: 200, payload: { configured: true, unlocked: true, expiresAt: 1234 } },
    });
    const store = await freshStore();

    await store.refreshHotelSession();

    expect(store.hotelSession).toMatchObject({ configured: true, unlocked: true, expiresAt: 1234 });
    expect(calls).toEqual([{ url: '/api/hotel-mode/session', method: 'GET' }]);
  });

  it('öffnet mit korrekter PIN und übernimmt den Ablaufzeitpunkt', async () => {
    stubFetch({
      '/api/hotel-mode/unlock': { status: 200, payload: { configured: true, unlocked: true, expiresAt: 9999 } },
    });
    const store = await freshStore();

    expect(await store.unlockHotelAdmin('123456')).toBe(true);
    expect(store.hotelSession.unlocked).toBe(true);
    expect(store.hotelSession.expiresAt).toBe(9999);
    expect(store.hotelSession.feedback).toBe('none');
    expect(store.hotelSession.busy).toBe(false);
  });

  it('bleibt bei falscher PIN ruhig und öffnet nichts', async () => {
    stubFetch({
      '/api/hotel-mode/unlock': { status: 401, payload: { code: 'HOTEL_PIN_MISMATCH', message: 'PIN ist nicht korrekt.' } },
    });
    const store = await freshStore();

    expect(await store.unlockHotelAdmin('000000')).toBe(false);
    expect(store.hotelSession.unlocked).toBe(false);
    expect(store.hotelSession.feedback).toBe('mismatch');
    expect(store.hotelSession.retryAfterMs).toBe(0);
  });

  it('übernimmt die Wartezeit des Backoffs', async () => {
    stubFetch({
      '/api/hotel-mode/unlock': {
        status: 429, payload: { code: 'HOTEL_PIN_RATE_LIMITED' }, headers: { 'retry-after': '60' },
      },
    });
    const store = await freshStore();

    expect(await store.unlockHotelAdmin('000000')).toBe(false);
    expect(store.hotelSession.feedback).toBe('rate-limited');
    expect(store.hotelSession.retryAfterMs).toBe(60_000);
  });

  it('schließt lokal, auch wenn der Server nicht antwortet', async () => {
    stubFetch({ '/api/hotel-mode/lock': new Error('offline') });
    const store = await freshStore();
    store.hotelSession.unlocked = true;
    store.hotelSession.expiresAt = 5;

    await store.lockHotelAdmin();

    expect(store.hotelSession.unlocked).toBe(false);
    expect(store.hotelSession.expiresAt).toBeNull();
  });

  it('verlängert nur bei echter Interaktion und höchstens minütlich', async () => {
    const calls = stubFetch({ '/api/hotel-mode/touch': { status: 200, payload: { configured: true, unlocked: true, expiresAt: 5 } } });
    const store = await freshStore();
    store.hotelSession.unlocked = true;
    const target = eventTarget();
    let clock = 1_000_000;
    const stop = store.startHotelAdminIdleWatch({ target, now: () => clock, onExpired: () => {} });

    // Direkt nach dem Öffnen ist die Sitzung ohnehin frisch.
    target.emit('pointerdown');
    expect(calls.length).toBe(0);

    clock += 61_000;
    target.emit('pointerdown');
    await vi.waitFor(() => expect(calls.length).toBe(1));

    // Innerhalb derselben Minute passiert nichts mehr.
    clock += 30_000;
    target.emit('keydown');
    target.emit('pointerdown');
    expect(calls.length).toBe(1);

    clock += 31_000;
    target.emit('pointerdown');
    await vi.waitFor(() => expect(calls.length).toBe(2));

    // Hintergrundereignisse verlängern gar nichts.
    clock += 120_000;
    target.emit('visibilitychange');
    target.emit('pointerdown', { isTrusted: false });
    expect(calls.length).toBe(2);

    stop();
    clock += 120_000;
    target.emit('pointerdown');
    expect(calls.length).toBe(2);
    expect(target.listeners.get('pointerdown')?.size ?? 0).toBe(0);
  });

  it('meldet den Ablauf und beendet die Beobachtung', async () => {
    vi.useFakeTimers();
    stubFetch({});
    const store = await freshStore();
    store.hotelSession.unlocked = true;
    store.hotelSession.expiresAt = 2_000_000;
    const target = eventTarget();
    let clock = 1_000_000;
    const expired = vi.fn();
    store.startHotelAdminIdleWatch({ target, now: () => clock, onExpired: expired, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(3000);
    expect(expired).not.toHaveBeenCalled();

    clock = 2_000_000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).toHaveBeenCalledTimes(1);

    // Nach dem Ende folgt kein zweiter Aufruf und kein Listener bleibt liegen.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(target.listeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('meldet auch eine serverseitig beendete Sitzung als Ablauf', async () => {
    vi.useFakeTimers();
    stubFetch({});
    const store = await freshStore();
    store.hotelSession.unlocked = false;
    const expired = vi.fn();
    store.startHotelAdminIdleWatch({ target: eventTarget(), onExpired: expired, intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
