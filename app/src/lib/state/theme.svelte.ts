/* ============================================
   Day/Night-Automatik (ADR-018, docs/07 Screen 9) — folgt der realen
   `sun.sun`-Entität: über dem Horizont → Light, darunter → Dark, jeweils mit
   Crossfade (≤300 ms). Ein manueller Tap auf den Theme-Toggle setzt einen
   24-h-Vorrang; danach fällt die Anzeige automatisch auf die sun.sun-Automatik
   zurück. Portiert aus prototype (data-theme am <html>, theme-fade am <body>,
   theme-color-Meta) — aber jetzt sensor-, nicht simulationsgetrieben.
   ============================================ */

import { appState, SUN_ENTITY } from './app.svelte.ts';
import { runtime } from '../adapter/runtime.svelte.ts';
import type { SunValue } from '../adapter/types.ts';

type Theme = 'dark' | 'light';

const OVERRIDE_MS = 24 * 60 * 60 * 1000; // manueller Vorrang: 24 h (docs/07 Screen 9)
const OVERRIDE_KEY = 'hmi:theme-override';

/* Manueller Vorrang: `until` = Ablauf-Timestamp (0 = kein Override), `theme` =
   die manuell gewählte Anzeige. Reaktiv, damit die sun-Automatik ihn liest. */
const override = $state<{ until: number; theme: Theme }>(loadOverride());

let overrideTimer: ReturnType<typeof setTimeout> | null = null;

function loadOverride(): { until: number; theme: Theme } {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { until: number; theme: Theme };
      if (typeof o.until === 'number' && o.until > Date.now()) return o;
    }
  } catch { /* ignore */ }
  return { until: 0, theme: 'dark' };
}

function saveOverride(): void {
  try {
    if (override.until > Date.now()) localStorage.setItem(OVERRIDE_KEY, JSON.stringify(override));
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* best-effort */ }
}

/* DOM-Seiteneffekte (identisch zu Phase 2): data-theme, Crossfade, Meta-Farbe. */
function applyThemeDom(theme: Theme, animate: boolean): void {
  if (typeof document === 'undefined') return;
  if (animate) {
    document.body.classList.add('theme-fade');
    setTimeout(() => document.body.classList.remove('theme-fade'), 320);
  }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0b0e12' : '#ececec');
}

function setTheme(theme: Theme, animate: boolean): void {
  if (appState.theme !== theme) appState.theme = theme;
  applyThemeDom(theme, animate);
}

/* sun.sun → Theme, sofern kein Override aktiv ist. Prüft zuerst den Ablauf. */
function syncFromSun(animate: boolean): void {
  if (override.until && Date.now() >= override.until) clearOverride();
  if (override.until) return; // manueller Vorrang aktiv
  const sun = runtime.merged(SUN_ENTITY) as SunValue | undefined;
  if (!sun) return; // noch kein sun.sun-State (Cache/Seed füllt das initial)
  setTheme(sun.day ? 'light' : 'dark', animate);
}

function clearOverride(): void {
  override.until = 0;
  saveOverride();
  if (overrideTimer) { clearTimeout(overrideTimer); overrideTimer = null; }
}

/* Timer auf den exakten Override-Ablauf — sun.sun feuert nur zu Sonnenauf-/
   -untergang, deshalb kann der Effekt allein den Ablauf verpassen. */
function armOverrideExpiry(): void {
  if (overrideTimer) clearTimeout(overrideTimer);
  const ms = override.until - Date.now();
  if (ms <= 0) return;
  overrideTimer = setTimeout(() => { clearOverride(); syncFromSun(true); }, ms);
}

/* Manueller Umschalter (StatusBar): flippt die Anzeige und hält sie 24 h gegen
   die Automatik. Erneuter Tap verlängert den Vorrang auf frische 24 h. */
export function toggleTheme(): void {
  setThemeMode(appState.theme === 'dark' ? 'light' : 'dark');
}

/* Explizite Modus-Wahl (Einstellungen): 'auto' hebt den manuellen Vorrang auf
   und folgt sofort wieder sun.sun; 'light'/'dark' setzen den 24-h-Vorrang. */
export function setThemeMode(mode: 'auto' | Theme): void {
  if (mode === 'auto') {
    clearOverride();
    syncFromSun(true);
    return;
  }
  setTheme(mode, true);
  override.until = Date.now() + OVERRIDE_MS;
  override.theme = mode;
  saveOverride();
  armOverrideExpiry();
}

/* Aktueller Modus für die Einstellungs-UI ('auto', solange kein Vorrang läuft). */
export function themeMode(): 'auto' | Theme {
  return override.until > Date.now() ? override.theme : 'auto';
}

/* Ablauf-Zeitpunkt des manuellen Vorrangs (0 = keiner) — für den Hinweistext. */
export function themeOverrideUntil(): number {
  return override.until;
}

/* true, solange der manuelle Vorrang läuft (für Tooltip/aria in der UI). */
export function themeOverrideActive(): boolean {
  return override.until > Date.now();
}

/* Einmalig aus App.svelte: initialer DOM-Sync + reaktive sun.sun-Kopplung.
   `$effect.root` hält den Effekt über die App-Lebensdauer (kein Cleanup nötig). */
export function initTheme(): void {
  // Startanzeige: aktiver Override gewinnt, sonst der zuletzt bekannte sun-State.
  if (themeOverrideActive()) {
    setTheme(override.theme, false);
    armOverrideExpiry();
  } else {
    clearOverride();
    setTheme(appState.theme, false);
  }
  $effect.root(() => {
    $effect(() => { syncFromSun(true); });
  });
}
