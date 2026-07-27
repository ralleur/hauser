/* ============================================
   Geteilte Interaktionsmuster der Einstellungs-Sektionen: zweistufige
   Bestätigung für destruktive Aktionen und transientes „Geleert“-Feedback.

   Lag ursprünglich lokal in SystemScreen.svelte. Seit die Sektionen eigene
   Komponenten sind, brauchen mehrere davon dasselbe Verhalten — ein
   Modul-Singleton genügt, weil immer nur ein Einstellungs-Screen offen ist.
   ============================================ */

import { settingsUi, clearStoredKeys } from './settings.svelte.ts';

const CONFIRM_MS = 4000;
const CLEARED_MS = 2000;

export const settingsActions = $state({
  confirmId: null as string | null,
  clearedIds: [] as string[],
});

let confirmTimer: ReturnType<typeof setTimeout> | null = null;

/* Erster Aufruf fragt nach, ein zweiter innerhalb des Fensters führt aus. */
export function confirmThen(id: string, action: () => void): void {
  if (confirmTimer) clearTimeout(confirmTimer);
  if (settingsActions.confirmId === id) {
    settingsActions.confirmId = null;
    action();
    return;
  }
  settingsActions.confirmId = id;
  confirmTimer = setTimeout(() => { settingsActions.confirmId = null; }, CONFIRM_MS);
}

export function isConfirming(id: string): boolean {
  return settingsActions.confirmId === id;
}

export function markCleared(id: string): void {
  settingsActions.clearedIds = [...settingsActions.clearedIds, id];
  setTimeout(() => {
    settingsActions.clearedIds = settingsActions.clearedIds.filter((c) => c !== id);
  }, CLEARED_MS);
}

export function isCleared(id: string): boolean {
  return settingsActions.clearedIds.includes(id);
}

/* Cache leeren: unkritisch, deshalb ohne Rückfrage und ohne Reload-Hinweis. */
export function clearCache(id: string, keys: readonly string[]): void {
  clearStoredKeys(keys);
  markCleared(id);
}

/* Gespeicherte Konfiguration verwerfen: Rückfrage, danach Reload nötig,
   weil die betroffenen Werte beim App-Start gelesen werden. */
export function resetStored(id: string, keys: readonly string[]): void {
  confirmThen(id, () => {
    clearStoredKeys(keys);
    markCleared(id);
    settingsUi.needsReload = true;
  });
}
