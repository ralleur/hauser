/* ── Vorwärmen im Leerlauf (Paket 5, docs/20) ──

   Arbeit, die niemand erwartet, darf niemandem im Weg stehen: Sie läuft erst,
   wenn der Browser nichts Wichtigeres zu tun hat. Ohne `requestIdleCallback`
   (Safari) tut es ein Timer nach derselben Frist. */

export type CancelIdle = () => void;

const DEFAULT_IDLE_TIMEOUT_MS = 3_000;

interface IdleScope {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

export function whenIdle(run: () => void, timeoutMs = DEFAULT_IDLE_TIMEOUT_MS): CancelIdle {
  const scope = globalThis as IdleScope;
  if (typeof scope.requestIdleCallback === 'function') {
    const handle = scope.requestIdleCallback(run, { timeout: timeoutMs });
    return () => scope.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(run, timeoutMs);
  return () => clearTimeout(timer);
}
