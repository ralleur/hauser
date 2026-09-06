import type { SunValue } from '../adapter/types.ts';
import type { RoomHeroConfig, RoomHeroFocus } from '../config/household-config.ts';
import { roomImagePhoneVariantFile } from '../room-images/room-image-phone-variants.ts';

/* `overcast` ist die trübe Tagvariante (Paket 13). Sie ist optional: nicht
   jedes Bildset hat sie, und der Projekt-Fallback kennt sie gar nicht. */
export type HeroVariant = 'light' | 'dark' | 'dark-off' | 'overcast';
export type PhoneHeroVariant = Exclude<HeroVariant, 'dark-off' | 'overcast'>;
export type HeroTarget = 'panel' | 'phone';
export type UiTheme = 'light' | 'dark';

/* Die mitgelieferten Bilder gibt es für diese sechs Räume; `all` ist der alte
   neutrale Rückfall. */
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

/* Für welche Räume der mitgelieferte Satz eine trübe Fassung hat. Wo sie
   fehlt, bleibt es beim Tagbild — eine Adresse zu bilden, hinter der keine
   Datei liegt, hieße nur, den Fehler später zu bemerken.
   Gepflegt von `scripts/export-project-heroes.mjs`. */
export const PROJECT_OVERCAST_ROOMS = new Set([
  'wohnzimmer',
  'kinderzimmer',
  'schlafzimmer',
  'bad',
  'kueche',
]);

/* ── Raumname → mitgeliefertes Bild ──

   Die Raumkennung entsteht bei der Ersteinrichtung aus dem Namen des
   Home-Assistant-Bereichs; Umlaute und fremde Zeichen fallen dabei weg
   („Küche" wird zu `kuche`, „Łazienka" zu `azienka`). Ein Vergleich auf
   Gleichheit traf deshalb selbst im deutschen Haushalt daneben und in einem
   englischen nie: „Living Room" hieß `living_room` und bekam das neutrale Bild.

   Diese Liste führt die Grundbegriffe der sechs Oberflächensprachen samt der
   Formen, die der Slug daraus macht. Gesucht wird als Teilzeichenkette, damit
   auch zusammengesetzte Namen greifen („Großes Wohnzimmer", „Kids Bedroom").
   Die Reihenfolge entscheidet: Das Kinderzimmer steht vor dem Schlafzimmer,
   sonst gewönne „chambre" gegen „chambre d’enfant". */
const HERO_ROOM_ALIASES: readonly (readonly [string, readonly string[]])[] = [
  ['kinderzimmer', [
    'kinderzimmer', 'kinder', 'kids', 'kid', 'child', 'children', 'nursery',
    'enfant', 'cameretta', 'bambini', 'dzieci', 'crianca', 'criancas', 'bebe', 'baby',
  ]],
  ['schlafzimmer', [
    'schlafzimmer', 'schlafraum', 'schlaf', 'bedroom', 'chambre', 'camera', 'letto',
    'sypialnia', 'quarto', 'dormitorio',
  ]],
  ['wohnzimmer', [
    'wohnzimmer', 'wohnraum', 'wohn', 'stube', 'living', 'lounge', 'sitting',
    'salon', 'sejour', 'soggiorno', 'salotto', 'dzienny', 'sala', 'salao', 'estar',
  ]],
  ['kueche', ['kueche', 'kuche', 'kitchen', 'cuisine', 'cucina', 'kuchnia', 'cozinha']],
  ['bad', [
    'badezimmer', 'bad', 'bathroom', 'bath', 'shower', 'toilet', 'restroom', 'wc',
    'bain', 'douche', 'bagno', 'doccia', 'azienka', 'lazienka', 'casa_de_banho', 'banho',
  ]],
  ['flur', [
    'flur', 'diele', 'korridor', 'eingang', 'hallway', 'hall', 'corridor', 'entrance',
    'entry', 'couloir', 'entree', 'vestibule', 'corridoio', 'ingresso', 'korytarz',
    'przedpokoj', 'corredor', 'entrada',
  ]],
];

/** Welches mitgelieferte Bild zu einer Raumkennung passt — `null`, wenn keins. */
export function heroRoomForId(roomId: string | null | undefined): string | null {
  if (!roomId) return null;
  if (PHONE_HERO_ROOMS.has(roomId)) return roomId;
  const needle = roomId.toLowerCase();
  for (const [room, aliases] of HERO_ROOM_ALIASES) {
    if (aliases.some((alias) => needle.includes(alias))) return room;
  }
  return null;
}
const ROOM_HERO_ASSET_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const CENTER_POSITION = '50% 50%';

export interface HeroAssetInput {
  baseUrl: string;
  roomId: string | null | undefined;
  sun: SunValue | undefined;
  fallbackTheme: UiTheme;
  allAssignedLightsOff?: boolean;
  /* true = draußen ist es trüb UND dieses Bildset hat die trübe Variante. */
  overcast?: boolean;
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
  /* true = draußen ist es trüb UND dieses Bildset hat die trübe Variante. */
  overcast?: boolean;
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
  /* Trübes Wetter zählt nur bei Tag und nur, wenn das Bildset die Variante
     wirklich hat — nachts sieht man das Wetter ohnehin nicht am Fensterlicht,
     und ein Set ohne trübe Fassung soll nicht ins Leere zeigen. */
  overcastAvailable = false,
): HeroVariant {
  const day = sun ? sun.day : fallbackTheme === 'light';
  if (day) return overcastAvailable ? 'overcast' : 'light';
  return allAssignedLightsOff ? 'dark-off' : 'dark';
}

/* Owner-Entscheidung 2026-09-06: Wo kein Bild passt, gilt das Wohnzimmer. Es
   ist das Bild, das jeder Haushalt hat, und ein Zimmer sieht besser aus als
   eine neutrale Fläche. */
export function normalizeHeroRoom(roomId: string | null | undefined): string {
  return heroRoomForId(roomId) ?? 'wohnzimmer';
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
  const file = variant === 'overcast' && !PROJECT_OVERCAST_ROOMS.has(roomId) ? 'light' : variant;
  return `${base}hero/${roomId}-${file}${suffix}.avif`;
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
    ? roomImagePhoneVariantFile(variant as PhoneHeroVariant) ?? `${variant}.avif`
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
    ? selectHeroVariant(input.sun, input.fallbackTheme, input.allAssignedLightsOff, input.overcast)
    : input.variant;
  /* Beide Ziele fallen auf dasselbe zurück: Ein Zimmer sieht besser aus als
     eine leere Fläche, und ein Haushalt ohne eigene Bilder soll überall etwas
     sehen — auf dem Telefon wie am Panel. */
  const fallbackRoom = normalizeHeroRoom(input.roomId);
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
