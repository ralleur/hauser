/* ── Bearbeiten vs. Bedienen: umschalten, PIN, automatisches Sperren ──
   Die Schreibseite von `edit-mode.svelte.ts`. Sie hängt am Moduswechsel-Knopf
   (ModeToggle, nur Panel) und an den Einstellungen — beide liegen außerhalb
   des Phone-Startpfads, deshalb ein eigenes Modul (ADR-029). */

import {
  AUTO_LOCK_KEY, MODE_KEY, PIN_KEY,
  editMode, editModeStorage, resetBlockedConfigAttempts, showNotice,
} from './edit-mode.svelte.ts';

function write(key: string, value: string | null): void {
  try {
    const store = editModeStorage();
    if (!store) return;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Privatmodus o. ä.: die Wahl gilt dann nur für diese Sitzung.
  }
}

export function setEditMode(active: boolean): void {
  if (editMode.active === active) return;
  editMode.active = active;
  write(MODE_KEY, active ? null : 'off');
  resetBlockedConfigAttempts();
  showNotice(active ? 'edit' : 'user');
}

/** true, wenn zum Verlassen des Bedienen-Modus eine PIN nötig ist. */
export function editModeNeedsPin(): boolean {
  return !editMode.active && editMode.pin.length > 0;
}

export function pinMatches(candidate: string): boolean {
  return editMode.pin.length > 0 && candidate === editMode.pin;
}

/* Die PIN liegt im Klartext im Gerätespeicher. Sie schützt vor dem
   versehentlichen Verstellen durch Mitbewohner, nicht gegen jemanden mit
   Zugriff auf das entsperrte Gerät — für mehr wäre ein Server-Geheimnis
   nötig, und das Panel läuft ohne TLS (kein `crypto.subtle`). */
export function setEditPin(pin: string): void {
  editMode.pin = pin;
  write(PIN_KEY, pin.length > 0 ? pin : null);
}

export function setAutoLockMinutes(minutes: number | null): void {
  editMode.autoLockMinutes = minutes;
  write(AUTO_LOCK_KEY, minutes === null ? null : String(minutes));
}

/* ── Automatisches Sperren ──
   Läuft nur, solange Bearbeiten aktiv und eine Dauer eingestellt ist. Jede
   Berührung setzt die Frist zurück; die Shell meldet sich beim Start an. */
let idleTimer: ReturnType<typeof setTimeout> | undefined;

export function startAutoLock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const arm = () => {
    clearTimeout(idleTimer);
    const minutes = editMode.autoLockMinutes;
    if (!editMode.active || minutes === null) return;
    idleTimer = setTimeout(() => setEditMode(false), minutes * 60_000);
  };
  window.addEventListener('pointerdown', arm, { passive: true });
  window.addEventListener('keydown', arm);
  arm();
  return () => {
    clearTimeout(idleTimer);
    window.removeEventListener('pointerdown', arm);
    window.removeEventListener('keydown', arm);
  };
}
