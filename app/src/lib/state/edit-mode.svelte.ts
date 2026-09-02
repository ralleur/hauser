/* ── Bearbeiten vs. Bedienen ──
   Zwei Betriebsarten der Oberfläche, umgeschaltet über den Knopf in der Mitte
   der Kopfzeile:

   • Bearbeiten (Default, bisheriges Verhalten): alle Konfigurations-Overlays
     sind über Long-Press erreichbar — Layout, Raum-Geräte, Szenen, zentrale
     Klimasteuerung — und der System-Bereich ist offen.
   • Bedienen: genau diese Zugänge sind gesperrt. Geräte lassen sich
     unverändert steuern, auch per Long-Press (Licht-Detail), denn das ist
     Bedienung und keine Konfiguration.

   Zweck: wer nur bedient, soll nichts verstellen können und deshalb auch
   keine Angst haben müssen, etwas kaputtzumachen.

   Gerätelokal wie die UI-Modus-Wahl (hmi:ui-mode): das Wandpanel im Flur darf
   gesperrt sein, während das eigene Telefon weiter konfiguriert. Bewusst ein
   eigenes kleines Modul statt eines Settings-Werts — die Sperre wird im
   Startup-Pfad beider Shells gelesen, der Settings-Store gehört dort nicht
   hinein (docs/03). */

const MODE_KEY = 'hmi:edit-mode';
const AUTO_LOCK_KEY = 'hmi:edit-auto-lock';
const PIN_KEY = 'hmi:edit-pin';

/* Zwei vergebliche Versuche innerhalb dieser Spanne gelten als „der Nutzer
   sucht die Konfiguration" — dann erklärt der Hinweis den Weg dorthin. */
const ATTEMPT_WINDOW_MS = 30_000;
const HINT_MS = 5_000;
const ANNOUNCE_MS = 2_600;

function storage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    const store = storage();
    if (!store) return;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Privatmodus o. ä.: die Wahl gilt dann nur für diese Sitzung.
  }
}

function initialMinutes(): number | null {
  const raw = read(AUTO_LOCK_KEY);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 240) : null;
}

export const editMode = $state({
  // Nur ein ausdrückliches „off" sperrt — unbekannte Werte und ein leerer
  // Speicher bleiben beim bisherigen Verhalten.
  active: read(MODE_KEY) !== 'off',
  /** Minuten Ruhe bis zum automatischen Sperren; null = aus. */
  autoLockMinutes: initialMinutes(),
  /** PIN, die das Verlassen des Bedienen-Modus schützt; leer = keine. */
  pin: read(PIN_KEY) ?? '',
});

/** Was gerade eingeblendet wird: der Moduswechsel oder der Sperr-Hinweis. */
export const modeNotice = $state({
  kind: null as 'edit' | 'user' | 'locked' | null,
  /* Hochzählend, damit dieselbe Meldung erneut anlaufen kann. */
  seq: 0,
});

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function showNotice(kind: 'edit' | 'user' | 'locked'): void {
  modeNotice.kind = kind;
  modeNotice.seq += 1;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { modeNotice.kind = null; }, kind === 'locked' ? HINT_MS : ANNOUNCE_MS);
}

export function dismissNotice(): void {
  clearTimeout(noticeTimer);
  modeNotice.kind = null;
}

export function setEditMode(active: boolean): void {
  if (editMode.active === active) return;
  editMode.active = active;
  write(MODE_KEY, active ? null : 'off');
  blockedAttempts = 0;
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

/* ── Vergebliche Konfigurations-Versuche ──
   Der Long-Press bleibt im Bedienen-Modus aktiv, damit wir ihn bemerken: beim
   ersten Mal passiert nichts (das kann Zufall sein), ab dem zweiten Versuch
   innerhalb der Zeitspanne erklärt der Hinweis den Weg über den Knopf oben. */
let blockedAttempts = 0;
let firstAttemptAt = 0;

export function noteBlockedConfigAttempt(immediate = false): void {
  const now = Date.now();
  if (now - firstAttemptAt > ATTEMPT_WINDOW_MS) {
    blockedAttempts = 0;
    firstAttemptAt = now;
  }
  blockedAttempts += 1;
  if (immediate || blockedAttempts >= 2) showNotice('locked');
}

/** Hüllt eine Konfigurations-Aktion: im Bedienen-Modus zählt sie nur als
    Versuch, statt das Overlay zu öffnen. */
export function whenEditable(action: () => void): () => void {
  return () => {
    if (editMode.active) action();
    else noteBlockedConfigAttempt();
  };
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
