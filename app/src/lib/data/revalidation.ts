/* ── Revalidierung im Hintergrund ──

   Leseabfragen melden sich hier mit „bin ich veraltet?“ und „lade neu“ an.
   Wird die App sichtbar oder kommt das Netz zurück, werden genau die
   veralteten Abfragen neu geladen — nicht alle, und nicht bei jedem Tab-
   Wechsel innerhalb der App. Eigene Intervalle der Abfragen bleiben bestehen;
   die Revalidierung ergänzt sie um die Momente, in denen ein Intervall
   typischerweise verpasst wurde (Telefon aus der Tasche, Panel aus dem
   Standby). */

export interface RevalidationEntry {
  name: string;
  isStale: () => boolean;
  revalidate: () => Promise<void> | void;
}

export type RevalidationReason = 'visible' | 'online' | 'manual';

const entries = new Map<string, RevalidationEntry>();
let listening = false;
let inFlight: Promise<void> | null = null;

export function registerRevalidation(entry: RevalidationEntry): () => void {
  entries.set(entry.name, entry);
  return () => { entries.delete(entry.name); };
}

export function registeredRevalidations(): string[] {
  return [...entries.keys()];
}

/** Revalidiert alle veralteten Abfragen; parallele Auslöser teilen sich einen Lauf. */
export function revalidateStaleQueries(_reason: RevalidationReason = 'manual'): Promise<void> {
  if (inFlight) return inFlight;
  const stale = [...entries.values()].filter((entry) => {
    try { return entry.isStale(); } catch { return false; }
  });
  inFlight = Promise.allSettled(stale.map((entry) => Promise.resolve().then(() => entry.revalidate())))
    .then(() => undefined)
    .finally(() => { inFlight = null; });
  return inFlight;
}

export interface RevalidationTargets {
  document?: Pick<Document, 'addEventListener' | 'visibilityState'> | null;
  window?: Pick<Window, 'addEventListener'> | null;
  navigator?: Pick<Navigator, 'onLine'> | null;
}

/** Hängt die Auslöser genau einmal an; ohne DOM (Tests, SSR) ist es ein No-op. */
export function startQueryRevalidation(targets: RevalidationTargets = {}): void {
  if (listening) return;
  const doc = targets.document === undefined ? (typeof document === 'undefined' ? null : document) : targets.document;
  const win = targets.window === undefined ? (typeof window === 'undefined' ? null : window) : targets.window;
  const nav = targets.navigator === undefined ? (typeof navigator === 'undefined' ? null : navigator) : targets.navigator;
  if (!doc && !win) return;
  listening = true;
  doc?.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible' && (nav?.onLine ?? true)) void revalidateStaleQueries('visible');
  });
  win?.addEventListener('online', () => { void revalidateStaleQueries('online'); });
}

/* Testhaken. */
export const __revalidationInternals = {
  reset(): void { entries.clear(); listening = false; inFlight = null; },
};
