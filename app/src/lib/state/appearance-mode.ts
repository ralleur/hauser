export type AppearanceMode =
  | 'auto'
  | 'interface-light'
  | 'interface-dark'
  | 'fixed-light'
  | 'fixed-dark';
export type Theme = 'dark' | 'light';
export type HeroBackgroundPolicy = 'auto' | 'day' | 'evening';

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'auto'
    || value === 'interface-light'
    || value === 'interface-dark'
    || value === 'fixed-light'
    || value === 'fixed-dark';
}

export function nextAppearanceMode(mode: AppearanceMode): AppearanceMode {
  if (mode === 'auto') return 'interface-light';
  if (mode === 'interface-light') return 'interface-dark';
  if (mode === 'interface-dark') return 'fixed-light';
  return mode === 'fixed-light' ? 'fixed-dark' : 'auto';
}

/* Ohne Sonnendaten hatte `auto` keinen Anhaltspunkt und blieb auf dem
   Startwert stehen — also dauerhaft dunkel, solange Home Assistant nicht
   erreichbar ist. Das ist genau dann falsch, wenn es am hellsten ist.

   Ersatz ist bewusst die Ortszeit und NICHT `prefers-color-scheme`: „Auto"
   heißt in Hauser „dem Tag folgen", nicht „dem Betriebssystem folgen". Wer
   seinen Rechner dauerhaft dunkel stellt, will deshalb noch lange keine
   Nachtansicht am Küchenpanel um drei Uhr nachmittags.

   Die Grenzen sind grob und absichtlich einfach: sie gelten nur, solange der
   echte Sonnenstand fehlt, und werden von ihm sofort abgelöst. */
export const DAY_STARTS_HOUR = 7;
export const NIGHT_STARTS_HOUR = 19;

export function themeFromLocalTime(now: Date = new Date()): Theme {
  const hour = now.getHours();
  return hour >= DAY_STARTS_HOUR && hour < NIGHT_STARTS_HOUR ? 'light' : 'dark';
}

export function appearanceTheme(
  mode: AppearanceMode,
  sunDay: boolean | undefined,
  fallbackTheme: Theme,
  clockTheme: Theme = themeFromLocalTime(),
): Theme {
  if (mode === 'auto') {
    if (sunDay !== undefined) return sunDay ? 'light' : 'dark';
    return clockTheme;
  }
  return mode === 'interface-light' || mode === 'fixed-light' ? 'light' : 'dark';
}

export function appearanceHeroPolicy(mode: AppearanceMode): HeroBackgroundPolicy {
  if (mode === 'fixed-light') return 'day';
  if (mode === 'fixed-dark') return 'evening';
  return 'auto';
}

export function resolveStoredAppearance(
  storedMode: string | null,
  legacyOverride: string | null,
  now = Date.now(),
): AppearanceMode {
  if (isAppearanceMode(storedMode)) return storedMode;

  if (storedMode) {
    try {
      const parsed = JSON.parse(storedMode) as unknown;
      if (isAppearanceMode(parsed)) return parsed;
    } catch { /* invalid values fall through to the legacy migration */ }
  }

  if (!legacyOverride) return 'auto';
  try {
    const legacy = JSON.parse(legacyOverride) as { until?: unknown; theme?: unknown };
    if (typeof legacy.until !== 'number' || legacy.until <= now) return 'auto';
    if (legacy.theme === 'light') return 'interface-light';
    if (legacy.theme === 'dark') return 'interface-dark';
  } catch { /* invalid legacy values become Auto */ }
  return 'auto';
}
