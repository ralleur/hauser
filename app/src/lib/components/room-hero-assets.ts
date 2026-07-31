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
 * B-01C: Raum-Hintergründe folgen dem realen beziehungsweise vom
 * Erscheinungsmodus projizierten Tageszustand, nicht dem UI-Theme.
 *
 * Mit den gelieferten Assets ist die Matrix bewusst klein:
 * - `light` = Tag
 * - `dark`  = Abend/Dämmerung/Nacht mit Licht
 * - `dark-off` = Abend/Dämmerung/Nacht ohne zugewiesenes Raumlicht
 *
 * Falls noch kein Tageszustand verfügbar ist, fällt die Auswahl auf das aktuelle
 * UI-Theme zurück. Unbekannte Räume fallen auf die Collage `all` zurück.
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
