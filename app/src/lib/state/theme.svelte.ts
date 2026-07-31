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
  appState.heroSun = heroPolicy === 'auto' ? sun : { day: heroPolicy === 'day' };
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
