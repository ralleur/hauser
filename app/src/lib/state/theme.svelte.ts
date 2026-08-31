/* ============================================
   B-01C: getrennte Interface- und Hero-Policy. Auto folgt `sun.sun`, die beiden
   Interface-Modi fixieren nur die UI, die beiden kombinierten Modi zusätzlich
   den Tag- beziehungsweise Abend-Hero. Manuelle Modi bleiben gerätelokal aktiv,
   bis der Nutzer bewusst weiterrotiert oder Auto auswählt.
   ============================================ */

import { appState, SUN_ENTITY } from './app.svelte.ts';
import { runtime } from '../adapter/runtime.svelte.ts';
import type { SunValue } from '../adapter/types.ts';
import {
  appearanceHeroPolicy,
  appearanceTheme,
  nextAppearanceMode,
  resolveStoredAppearance,
  type AppearanceMode,
  type HeroBackgroundPolicy,
  type Theme,
} from './appearance-mode.ts';

const APPEARANCE_KEY = 'hmi:appearance-mode';
const LEGACY_OVERRIDE_KEY = 'hmi:theme-override';
/* B-27 D7: Bis die HA-Daten eintreffen, ist `heroSun` undefiniert und die
   Kacheln raten die Variante aus dem UI-Theme. Trifft der Sonnenstand dann
   anders ein, kippt der Effect-Key und ALLE Kacheln dekodieren einen zweiten
   Bildersatz. Der zuletzt beobachtete Stand ist der weitaus bessere Startwert. */
const HERO_VARIANT_KEY = 'hmi:hero-variant';

const appearance = $state<{ mode: AppearanceMode }>({ mode: loadAppearanceMode() });

function loadAppearanceMode(): AppearanceMode {
  if (typeof localStorage === 'undefined') return 'auto';
  try {
    return resolveStoredAppearance(
      localStorage.getItem(APPEARANCE_KEY),
      localStorage.getItem(LEGACY_OVERRIDE_KEY),
    );
  } catch { return 'auto'; }
}

function saveAppearanceMode(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (appearance.mode === 'auto') localStorage.removeItem(APPEARANCE_KEY);
    else localStorage.setItem(APPEARANCE_KEY, appearance.mode);
    localStorage.removeItem(LEGACY_OVERRIDE_KEY);
  } catch { /* best-effort */ }
}

function loadHeroSun(): SunValue | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const stored = localStorage.getItem(HERO_VARIANT_KEY);
    if (stored === 'day') return { day: true };
    if (stored === 'night') return { day: false };
    return undefined;
  } catch { return undefined; }
}

function saveHeroSun(sun: SunValue): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(HERO_VARIANT_KEY, sun.day ? 'day' : 'night'); }
  catch { /* best-effort */ }
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

function syncInterfaceTheme(animate: boolean): void {
  const sun = SUN_ENTITY ? runtime.merged(SUN_ENTITY) as SunValue | undefined : undefined;
  const heroPolicy = appearanceHeroPolicy(appearance.mode);
  if (heroPolicy === 'auto') {
    /* Nur der real beobachtete Sonnenstand wird gemerkt; solange er fehlt,
       traegt der letzte bekannte Stand den ersten Paint. Ein manuell gesetzter
       Modus (heroPolicy !== 'auto') gewinnt weiterhin und wird nicht
       persistiert — sonst ueberstimmte er spaeter das Auto-Verhalten. */
    if (sun) saveHeroSun(sun);
    appState.heroSun = sun ?? loadHeroSun();
  } else {
    appState.heroSun = { day: heroPolicy === 'day' };
  }
  setTheme(appearanceTheme(appearance.mode, sun?.day, appState.theme), animate);
}

export function cycleAppearanceMode(): void {
  setAppearanceMode(nextAppearanceMode(appearance.mode));
}

export function setAppearanceMode(mode: AppearanceMode): void {
  appearance.mode = mode;
  saveAppearanceMode();
  syncInterfaceTheme(true);
}

export function appearanceMode(): AppearanceMode {
  return appearance.mode;
}

export function heroBackgroundPolicy(): HeroBackgroundPolicy {
  return appearanceHeroPolicy(appearance.mode);
}

/* Einmalig aus App.svelte: initialer DOM-Sync + reaktive sun.sun-Kopplung.
   `$effect.root` hält den Effekt über die App-Lebensdauer (kein Cleanup nötig). */
export function initTheme(): void {
  // Schreibt eine mögliche aktive Altwertmigration und entfernt den Legacy-Key.
  saveAppearanceMode();
  syncInterfaceTheme(false);
  $effect.root(() => {
    $effect(() => { syncInterfaceTheme(true); });
  });
}
