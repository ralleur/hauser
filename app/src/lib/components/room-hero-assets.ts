import type { SunValue } from '../adapter/types.ts';
import type { RoomHeroConfig, RoomHeroFocus } from '../config/household-config.ts';
import { roomImagePhoneVariantFile } from '../room-images/room-image-phone-variants.ts';

export type HeroVariant = 'light' | 'dark' | 'dark-off';
export type PhoneHeroVariant = Exclude<HeroVariant, 'dark-off'>;
export type HeroTarget = 'panel' | 'phone';
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
const PHONE_HERO_ROOMS = new Set([...HERO_ROOMS].filter((roomId) => roomId !== 'all'));
const ROOM_HERO_ASSET_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const CENTER_POSITION = '50% 50%';

export interface HeroAssetInput {
  baseUrl: string;
  roomId: string | null | undefined;
  sun: SunValue | undefined;
  fallbackTheme: UiTheme;
  allAssignedLightsOff?: boolean;
}

interface HeroResolverBaseInput {
  baseUrl: string;
  roomId: string | null | undefined;
  config: RoomHeroConfig | null | undefined;
}

export interface PanelHeroResolverInput extends HeroResolverBaseInput {
  target: 'panel';
  sun: SunValue | undefined;
  fallbackTheme: UiTheme;
  allAssignedLightsOff?: boolean;
}

export interface PhoneHeroResolverInput extends HeroResolverBaseInput {
  target: 'phone';
  variant: PhoneHeroVariant;
}

export type RoomHeroResolverInput = PanelHeroResolverInput | PhoneHeroResolverInput;

export interface HeroImageCandidate {
  source: 'user' | 'project';
  url: string;
  position: string;
}

export interface RoomHeroResolution {
  variant: HeroVariant;
  userCandidate: HeroImageCandidate | null;
  projectFallback: HeroImageCandidate | null;
}

export type HeroImageDecoder = (url: string) => Promise<void>;

/**
 * B-01C: Raum-Hintergründe folgen dem realen beziehungsweise vom
 * Erscheinungsmodus projizierten Tageszustand, nicht dem UI-Theme.
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

/* B-27 D6: Für Phone liefert der Resolver die Ableitung — dieselbe Geometrie
   (106:75), nur rund ein Fünftel der Bytes. Die Kachel dekodiert damit keine
   0,5–1,9-MB-Datei mehr, bevor sie ihren Hintergrund zeigt. */
function projectAssetUrl(
  baseUrl: string,
  roomId: string,
  variant: HeroVariant,
  target: HeroTarget = 'panel',
): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const suffix = target === 'phone' && roomImagePhoneVariantFile(variant) ? '-phone' : '';
  return `${base}hero/${roomId}-${variant}${suffix}.avif`;
}

export function heroAssetUrl({ baseUrl, roomId, sun, fallbackTheme, allAssignedLightsOff }: HeroAssetInput): string {
  return projectAssetUrl(
    baseUrl,
    normalizeHeroRoom(roomId),
    selectHeroVariant(sun, fallbackTheme, allAssignedLightsOff),
  );
}

function validFocus(focus: RoomHeroFocus): boolean {
  return Number.isFinite(focus.x)
    && Number.isFinite(focus.y)
    && focus.x >= 0
    && focus.x <= 1
    && focus.y >= 0
    && focus.y <= 1;
}

function focusPosition(focus: RoomHeroFocus): string {
  return `${focus.x * 100}% ${focus.y * 100}%`;
}

function userCandidate(
  config: RoomHeroConfig | null | undefined,
  target: HeroTarget,
  variant: HeroVariant,
): HeroImageCandidate | null {
  if (!config || !ROOM_HERO_ASSET_ID.test(config.assetId)) return null;
  const focus = config.focus[target];
  if (!validFocus(focus)) return null;
  /* Die Phone-Ableitung liegt seit B-27 D2 im selben atomaren Publish-Commit
     wie die Vollfassung; sie kann also nicht fehlen, solange das Asset aktiv
     ist. Für `dark-off` gibt es keine Phone-Ableitung, weil der Phone-Resolver
     diese Variante nie anfragt — dann bleibt es bei der Vollfassung. */
  const file = target === 'phone'
    ? roomImagePhoneVariantFile(variant) ?? `${variant}.avif`
    : `${variant}.avif`;
  return {
    source: 'user',
    url: `/assets/room-images/${config.assetId}/${file}`,
    position: focusPosition(focus),
  };
}

/** Pure shared policy for panel/phone variant, user candidate, fallback and focus. */
export function resolveRoomHero(input: RoomHeroResolverInput): RoomHeroResolution {
  const variant = input.target === 'panel'
    ? selectHeroVariant(input.sun, input.fallbackTheme, input.allAssignedLightsOff)
    : input.variant;
  const fallbackRoom = input.target === 'panel'
    ? normalizeHeroRoom(input.roomId)
    : input.roomId && PHONE_HERO_ROOMS.has(input.roomId) ? input.roomId : null;
  return {
    variant,
    userCandidate: userCandidate(input.config, input.target, variant),
    projectFallback: fallbackRoom
      ? {
          source: 'project',
          url: projectAssetUrl(input.baseUrl, fallbackRoom, variant, input.target),
          position: CENTER_POSITION,
        }
      : null,
  };
}

export async function decodeHeroImage(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
}

/**
 * Decode-gated User→Projekt policy. `isCurrent` prevents a superseded async
 * request from returning either candidate to a component.
 */
export async function loadRoomHero(
  resolution: RoomHeroResolution,
  decode: HeroImageDecoder = decodeHeroImage,
  isCurrent: () => boolean = () => true,
): Promise<HeroImageCandidate | null> {
  for (const candidate of [resolution.userCandidate, resolution.projectFallback]) {
    if (!candidate || !isCurrent()) continue;
    try {
      await decode(candidate.url);
      if (!isCurrent()) return null;
      return candidate;
    } catch {
      if (!isCurrent()) return null;
    }
  }
  return null;
}
