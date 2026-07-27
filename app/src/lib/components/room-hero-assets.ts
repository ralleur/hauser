import type { SunValue } from '../adapter/types.ts';

export type HeroVariant = 'light' | 'dark' | 'dark-off';
export type UiTheme = 'light' | 'dark';

const HERO_ROOMS = new Set([
  'all',
  'wohnzimmer',
  'kueche',
  'bad',
  'schlafzimmer',
  'kinderzimmer',
  'flur',
]);

export interface HeroAssetInput {
  baseUrl: string;
  roomId: string | null | undefined;
  sun: SunValue | undefined;
  fallbackTheme: UiTheme;
  allAssignedLightsOff?: boolean;
}

/**
 * B-01A: Raum-Hintergründe folgen der realen Tageszeit (`sun.sun`), nicht dem
 * manuell gesetzten UI-Theme. Der manuelle Theme-Toggle darf also die Lesbarkeit
 * der UI ändern, aber nicht das Motiv von Tag auf Abend/Nacht zwingen.
 *
 * Mit den gelieferten Assets ist die Matrix bewusst klein:
 * - `light` = Tag
 * - `dark`  = Abend/Dämmerung/Nacht
 *
 * Falls `sun.sun` noch nicht verfügbar ist, fällt die Auswahl auf das aktuelle
 * UI-Theme zurück. Unbekannte Räume fallen auf die Collage `all` zurück, damit
 * kein kaputtes Hintergrundbild gerendert wird.
 */
export function selectHeroVariant(
  sun: SunValue | undefined,
  fallbackTheme: UiTheme,
  allAssignedLightsOff = false,
): HeroVariant {
  const day = sun ? sun.day : fallbackTheme === 'light';
  if (day) return 'light';
  return allAssignedLightsOff ? 'dark-off' : 'dark';
}

export function normalizeHeroRoom(roomId: string | null | undefined): string {
  return roomId && HERO_ROOMS.has(roomId) ? roomId : 'all';
}

export function heroAssetUrl({ baseUrl, roomId, sun, fallbackTheme, allAssignedLightsOff }: HeroAssetInput): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}hero/${normalizeHeroRoom(roomId)}-${selectHeroVariant(sun, fallbackTheme, allAssignedLightsOff)}.avif`;
}
