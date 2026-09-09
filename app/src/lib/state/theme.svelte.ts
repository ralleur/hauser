/* ============================================
   B-01C: getrennte Interface- und Hero-Policy. Auto folgt `sun.sun`, die beiden
   Interface-Modi fixieren nur die UI, die beiden kombinierten Modi zusätzlich
   den Tag- beziehungsweise Abend-Hero. Manuelle Modi bleiben gerätelokal aktiv,
   bis der Nutzer bewusst weiterrotiert oder Auto auswählt.
   ============================================ */

import { appState, SUN_ENTITY } from './app.svelte.ts';
import { DUSK_BAND_DEG, duskProgress, inDuskBand } from './dusk.ts';
import { simulation } from './simulation.svelte.ts';
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

/* Spiegelt `--duration-dusk` aus design-tokens/tokens.css: nur zum Aufräumen
   der Klasse, die Kurve selbst steht im CSS. */
const DUSK_THEME_FADE_MS = 1300;

/* Test-Override in der Art von `?idle=` und `?deepnight=1` im Standby:
   `?dusk=0.5` friert die Überblendung auf einem festen Stand ein. Sonst wäre
   sie nur zweimal am Tag für zwanzig Minuten zu sehen — zu wenig, um sie zu
   beurteilen. Ohne Parameter ändert sich nichts. */
const DUSK_OVERRIDE = readDuskOverride();

function readDuskOverride(): number | null {
  if (typeof location === 'undefined') return null;
  try {
    const raw = new URLSearchParams(location.search).get('dusk');
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
  } catch { return null; }
}

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

/* DOM-Seiteneffekte (identisch zu Phase 2): data-theme, Crossfade, Meta-Farbe.
   Paket 4: Fällt der Wechsel in die Dämmerung, läuft er über `--duration-dusk`
   statt über `--duration-enter` — dann kippt die Fläche im selben Tempo, in dem
   das Hero-Bild darunter überblendet. Der Dämmerungsstand kommt als Argument
   herein und wird bewusst nicht aus `appState` gelesen: derselbe Effekt schreibt
   ihn, ein Lesen an dieser Stelle würde ihn endlos neu auslösen. */
function applyThemeDom(theme: Theme, animate: boolean, dusk: boolean): void {
  if (typeof document === 'undefined') return;
  if (animate) {
    document.body.classList.add('theme-fade');
    document.body.classList.toggle('is-dusk', dusk);
    setTimeout(
      () => document.body.classList.remove('theme-fade', 'is-dusk'),
      dusk ? DUSK_THEME_FADE_MS : 320,
    );
  }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0b0e12' : '#f2f0ec');
}

/* `syncInterfaceTheme` läuft in einem Effekt, der an jeder Entity-Änderung
   hängt — ein Lichtschalter genügt. Die Fade-Klasse darf deshalb nur fallen,
   wenn das Theme wirklich kippt: sie ersetzt für ihre Dauer die `transition`
   sämtlicher Elemente und würgte sonst bei jedem Schaltvorgang alle laufenden
   Überblendungen ab (Lichtkegel, Nachdimmen). */
function setTheme(theme: Theme, animate: boolean, dusk: boolean): void {
  const changed = appState.theme !== theme
    || (typeof document !== 'undefined' && document.documentElement.dataset.theme !== theme);
  if (changed) appState.theme = theme;
  applyThemeDom(theme, animate && changed, dusk);
}

function syncInterfaceTheme(animate: boolean): void {
  const observed = SUN_ENTITY ? runtime.merged(SUN_ENTITY) as SunValue | undefined : undefined;
  /* Simulator (fünfmal auf die Uhr) und `?dusk=` treten an die Stelle des
     Sonnenstands, nicht an die der Moduswahl. In den fixierten Modi ändert der
     Regler deshalb nichts — und genau das soll er auch zeigen. Beide werden
     immer gelesen, damit dieser Effekt ihnen folgt. */
  const forcedDusk = simulation.dusk ?? DUSK_OVERRIDE;
  const sun: SunValue | undefined = forcedDusk === null ? observed : {
    day: forcedDusk >= 0.5,
    elevation: (forcedDusk * 2 - 1) * DUSK_BAND_DEG,
  };
  const heroPolicy = appearanceHeroPolicy(appearance.mode);
  let heroSun: SunValue | undefined;
  if (heroPolicy === 'auto') {
    /* Nur der real beobachtete Sonnenstand wird gemerkt; solange er fehlt,
       traegt der letzte bekannte Stand den ersten Paint. Ein manuell gesetzter
       Modus (heroPolicy !== 'auto') gewinnt weiterhin und wird nicht
       persistiert — sonst ueberstimmte er spaeter das Auto-Verhalten. Ein
       simulierter Stand wird ebenfalls nicht gemerkt. */
    if (observed) saveHeroSun(observed);
    heroSun = sun ?? loadHeroSun();
  } else {
    /* Fixiert heißt fixiert: kein Dämmerungsband, weil die Sonnenhöhe fehlt.
       Das Nachdimmen auf `dark-off` hängt am Licht und bleibt davon unberührt. */
    heroSun = { day: heroPolicy === 'day' };
  }
  const theme = appearanceTheme(appearance.mode, sun?.day, appState.theme);
  /* Paket 4: Der Fortschritt entsteht aus derselben Quelle wie die Variante.
     Ohne Sonnenhöhe bleibt es beim Hartschnitt aus Tag/Nacht. */
  const dusk = heroSun
    ? duskProgress(heroSun.elevation, heroSun.day)
    : duskProgress(null, theme === 'light');
  appState.heroSun = heroSun;
  appState.heroDusk = dusk;
  setTheme(theme, animate, inDuskBand(dusk));
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
