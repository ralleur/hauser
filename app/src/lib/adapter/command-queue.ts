/* ============================================
   CommandQueue — Dedup-Logik (ADR-015 Schicht 3, docs/02).
   Reine Funktionen; der Versand (WebSocket call_service) kommt in der
   HA-Anbindungs-Session dazu.
   ============================================ */

import type { Command } from './types.ts';

/* Dedup (docs/02 Command-Deduplizierung): Queue hält den LETZTEN Command
   pro Entität — ein neuer Command derselben Entität überschreibt den
   pending Command, nur der letzte wird ausgeführt (kein Doppelklick-Bug).
   Die UI zeigt immer den Zustand des letzten Commands (Overlay-Intent). */
export function enqueue(
  queue: readonly Command[],
  cmd: Command,
): Command[] {
  return [...queue.filter((c) => c.entityId !== cmd.entityId), cmd];
}

/* Nach dem Versand: Command verlässt die Queue (der zugehörige Intent
   im Overlay bleibt, bis der Server antwortet oder das Timeout greift). */
export function dequeue(
  queue: readonly Command[],
  entityId: string,
): Command[] {
  return queue.filter((c) => c.entityId !== entityId);
}
