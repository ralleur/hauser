/* ============================================
   Optimistic Overlay — Reconciliation (ADR-005/015, docs/02).
   Reine Funktionen ohne Framework-Bezug: Signale/Storage kommen in der
   HA-Anbindungs-Session dazu; die Fälle hier sind der testbare Kern.
   ============================================ */

import type { EntityState, Intent, ReconcileOutcome } from './types.ts';

export const COMMAND_TIMEOUT_MS = 5000; // docs/02 Timeout-Schwelle

/* Flache Objekt-Gleichheit für die Reconciliation der Entity-Values
   (LightValue/ClimateValue): confirmed nur, wenn alle Felder übereinstimmen. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/* Patch-Merge (ADR-017 Addendum): der Intent überlagert NUR die Felder, die er
   behauptet — Server-Metadaten (z. B. media track/artist) fließen unverändert
   durch. Für die vollen Licht-/Klima-Intents ist das deckungsgleich mit dem
   bisherigen „Ersetzen" (sie behaupten alle Felder). */
export function mergePatch(server: unknown, intentValue: unknown): unknown {
  if (isPlainObject(server) && isPlainObject(intentValue)) {
    return { ...server, ...intentValue };
  }
  return intentValue;
}

/* Subset-Match (ADR-017 Addendum): ein Intent gilt als bestätigt, wenn JEDES
   Feld, das er behauptet, mit dem Server übereinstimmt. Für volle Intents
   (Licht/Klima) ist das identisch zum Voll-Vergleich; für Media-Teil-Patches
   ({ playing } / { volume }) werden die Server-Metadaten ignoriert. Primitive
   fallen auf Object.is zurück (die Reconcile-Unit-Tests nutzen Booleans). */
export function subsetMatch(intentValue: unknown, server: unknown): boolean {
  if (Object.is(intentValue, server)) return true;
  if (!isPlainObject(intentValue) || !isPlainObject(server)) return false;
  return Object.keys(intentValue).every((k) => Object.is(intentValue[k], server[k]));
}

/* Gemergte Sicht (das Einzige, was die UI liest): pending Intent gewinnt
   über Server-State; ohne Intent zählt die Server-Wahrheit. */
export function mergedValue<V>(
  server: EntityState<V> | undefined,
  intent: Intent<V> | undefined,
): V | undefined {
  return intent !== undefined ? intent.value : server?.value;
}

/* Neuer optimistischer Intent: ersetzt einen bestehenden Intent derselben
   Entität (der letzte Touch gewinnt — passend zum CommandQueue-Dedup). */
export function applyIntent<V>(
  intents: readonly Intent<V>[],
  entityId: string,
  value: V,
  now: number,
): Intent<V>[] {
  return [
    ...intents.filter((i) => i.entityId !== entityId),
    { entityId, value, sentAt: now, status: 'inflight' },
  ];
}

/* Server-Update gegen die Intent-Liste abgleichen (docs/02 Konflikt-Typen):
   - kein eigener Intent        → 'external'      (übernehmen, ohne Animation)
   - Intent, Wert bestätigt     → 'confirmed'     (Intent weg, keine Aktion)
   - Intent, Wert widerspricht  → 'contradicted'  (Intent weg; UI springt auf
                                   den Server-Wert zurück, Wobble 200 ms) */
export function reconcile<V>(
  intents: readonly Intent<V>[],
  update: { entityId: string; value: V },
  equals: (a: V, b: V) => boolean = Object.is,
): { intents: Intent<V>[]; outcome: ReconcileOutcome } {
  const intent = intents.find((i) => i.entityId === update.entityId);
  if (!intent) return { intents: [...intents], outcome: 'external' };
  return {
    intents: intents.filter((i) => i.entityId !== update.entityId),
    outcome: equals(intent.value, update.value) ? 'confirmed' : 'contradicted',
  };
}

/* Timeout-Übergang (docs/02): nach 5 s wird der Intent NICHT verworfen —
   der State bleibt optimistisch sichtbar, das Control zeigt den
   „pending"-Dot. Kein automatischer Retry; der User entscheidet durch
   erneuten Touch. */
export function markTimeouts<V>(
  intents: readonly Intent<V>[],
  now: number,
  timeoutMs: number = COMMAND_TIMEOUT_MS,
): Intent<V>[] {
  return intents.map((i) => (
    i.status === 'inflight' && now - i.sentAt >= timeoutMs
      ? { ...i, status: 'pending' as const }
      : i
  ));
}
