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

export function appearanceTheme(
  mode: AppearanceMode,
  sunDay: boolean | undefined,
  fallbackTheme: Theme,
): Theme {
  if (mode === 'auto') return sunDay === undefined ? fallbackTheme : sunDay ? 'light' : 'dark';
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
