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
   hinein (docs/03).

   Hier steht nur, was der Startpfad braucht: den Modus lesen und eine
   Konfigurations-Aktion daran hängen. Umschalten, PIN und automatisches
   Sperren liegen in `edit-mode-controls.ts`; die lädt erst, wer den
   Moduswechsel-Knopf oder die Einstellungen öffnet (ADR-029). */

export const MODE_KEY = 'hmi:edit-mode';
export const AUTO_LOCK_KEY = 'hmi:edit-auto-lock';
export const PIN_KEY = 'hmi:edit-pin';

/* Zwei vergebliche Versuche innerhalb dieser Spanne gelten als „der Nutzer
   sucht die Konfiguration" — dann erklärt der Hinweis den Weg dorthin. */
const ATTEMPT_WINDOW_MS = 30_000;
const HINT_MS = 5_000;
const ANNOUNCE_MS = 2_600;

export function editModeStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  try {
    return editModeStorage()?.getItem(key) ?? null;
  } catch {
    return null;
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

export function showNotice(kind: 'edit' | 'user' | 'locked'): void {
  modeNotice.kind = kind;
  modeNotice.seq += 1;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { modeNotice.kind = null; }, kind === 'locked' ? HINT_MS : ANNOUNCE_MS);
}

export function dismissNotice(): void {
  clearTimeout(noticeTimer);
  modeNotice.kind = null;
}

/* ── Vergebliche Konfigurations-Versuche ──
   Der Long-Press bleibt im Bedienen-Modus aktiv, damit wir ihn bemerken: beim
   ersten Mal passiert nichts (das kann Zufall sein), ab dem zweiten Versuch
   innerhalb der Zeitspanne erklärt der Hinweis den Weg über den Knopf oben. */
let blockedAttempts = 0;
let firstAttemptAt = 0;

/** Laufende Summe aller vergeblichen Versuche — die Demo-Tipps lesen sie, um
    zu erkennen, dass der Long-Press im Bedienen-Modus ausprobiert wurde. */
export const blockedConfigAttempts = $state({ total: 0 });

export function resetBlockedConfigAttempts(): void {
  blockedAttempts = 0;
}

export function noteBlockedConfigAttempt(immediate = false): void {
  const now = Date.now();
  if (now - firstAttemptAt > ATTEMPT_WINDOW_MS) {
    blockedAttempts = 0;
    firstAttemptAt = now;
  }
  blockedAttempts += 1;
  blockedConfigAttempts.total += 1;
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
