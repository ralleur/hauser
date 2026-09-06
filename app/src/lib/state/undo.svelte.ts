/* ============================================
   Undo statt Bestätigen (Paket 6, docs/20)
   --------------------------------------------
   Große Eingriffe — „Alles aus", Szenenwechsel — fragen nicht vorher nach,
   sondern gehen sofort raus. Stepper (Klima) bekommen keinen Streifen: der
   andere Knopf ist ihr Rückweg (Owner-Entscheidung 2026-09-06). Fünf Sekunden lang
   steht dann ein Rückgängig-Streifen bereit: er schickt einen zweiten Befehl
   über dieselbe Command-Queue, mit den Werten von vor dem Eingriff.

   Der Schnappschuss entsteht VOR dem Eingriff aus der gemergten Sicht; die
   Gegenbefehle baut buildRestoreCommand (dieselbe Logik wie die Rücknahme
   der Szenen-Vorschau).
   ============================================ */

import { runtime } from '../adapter/runtime.svelte.ts';
import { buildRestoreCommand, type SceneCommand } from './entity-restore.ts';

export const UNDO_WINDOW_MS = 5000;

/* Der Streifen beschriftet sich selbst: hier steht nur, WAS zurückgenommen
   werden kann. Die Übersetzung lebt in UndoToast — so bleiben die
   Meldungen aus dem Startpfad des Telefons heraus (ADR-029). */
export type UndoKind = 'all-off' | 'scene';

export interface UndoSubject {
  kind: UndoKind;
  /** Szenenname (Nutzerinhalt) bei `kind: 'scene'`. */
  scene?: string;
}

type UndoEntry = SceneCommand;

export const undoOffer = $state<{ active: boolean; subject: UndoSubject | null; deadline: number }>({
  active: false,
  subject: null,
  deadline: 0,
});

let entries: UndoEntry[] = [];
let activeKey = '';
let timer: ReturnType<typeof setTimeout> | undefined;

/** Führt `apply` aus und bietet danach fünf Sekunden lang die Rücknahme an.
    Ohne rücknehmbaren Zustand (keine bekannten Werte) läuft der Eingriff
    trotzdem — nur ohne Streifen.

    `key` fasst eine Serie zusammen: wer dreimal hintereinander wärmer drückt,
    landet mit einem Rückgängig wieder beim Wert von vor der Serie — der erste
    Schnappschuss bleibt, nur das Fenster fängt neu an. */
export function offerUndo(
  subject: UndoSubject,
  entityIds: readonly string[],
  apply: () => void,
  key = '',
): void {
  const keeping = undoOffer.active && key !== '' && key === activeKey;
  const snapshot = keeping ? entries : [...new Set(entityIds)]
    .map((entityId) => buildRestoreCommand(entityId, runtime.merged(entityId)))
    .filter((entry): entry is UndoEntry => entry !== null);
  apply();
  if (snapshot.length === 0) return;
  entries = snapshot;
  activeKey = key;
  undoOffer.subject = subject;
  undoOffer.active = true;
  undoOffer.deadline = Date.now() + UNDO_WINDOW_MS;
  clearTimeout(timer);
  timer = setTimeout(dismissUndo, UNDO_WINDOW_MS);
}

/** Zweiter Befehl über die Command-Queue — kein Sonderweg am Adapter vorbei. */
export function runUndo(): void {
  const batch = entries;
  dismissUndo();
  const queuedAt = Date.now();
  for (const { command, optimistic } of batch) runtime.dispatch({ ...command, queuedAt }, optimistic);
}

export function dismissUndo(): void {
  clearTimeout(timer);
  timer = undefined;
  entries = [];
  activeKey = '';
  undoOffer.active = false;
  undoOffer.subject = null;
  undoOffer.deadline = 0;
}
