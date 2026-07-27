/* ============================================
   Jellyfin-Mapping (Schritt 8, ADR-008 / docs/08) — reine Übersetzung der
   Jellyfin-REST-DTOs (`BaseItemDto`) in die App-Shapes (LibraryItem/Season/
   Episode). Kein Netz, kein State, keine Seiteneffekte — analog ha-entities.ts.
   Der REST-Client (jellyfin.ts) fetcht die DTOs, diese Datei formt sie.

   Einheiten: Jellyfin misst Zeiten in „Ticks" (100-Nanosekunden-Einheiten).
   1 s = 10_000_000 Ticks. Positions-/Laufzeit-Felder werden hier in Sekunden
   umgerechnet — dieselbe Einheit, die die App (pos/dur/runtime) verwendet.
   ============================================ */

import type { LibraryItem, Season, Episode } from '../state/app.svelte.ts';

const TICKS_PER_SECOND = 10_000_000;

/* ── Jellyfin-DTOs (nur die Felder, die wir lesen) ── */
export interface UserItemData {
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  LastPlayedDate?: string; // ISO-8601
}

export interface BaseItemDto {
  Id: string;
  Name?: string;
  Type?: string; // 'Movie' | 'Series' | 'Season' | 'Episode'
  ProviderIds?: Record<string, string>; // TMDB/TVDB/IMDb — stabil über mehrere Libraries
  ProductionYear?: number;
  OfficialRating?: string; // z. B. 'FSK 16', '16', 'de/16'
  Genres?: string[];
  Overview?: string;
  RunTimeTicks?: number;
  DateCreated?: string; // ISO-8601
  ChildCount?: number; // Serie: Anzahl Staffeln
  UserData?: UserItemData;
  ImageTags?: Record<string, string>; // { Primary, Logo, ... }
  BackdropImageTags?: string[];
  /* Episode/Season */
  IndexNumber?: number; // Folgen- bzw. Staffelnummer
  ParentIndexNumber?: number; // Staffelnummer der Folge
  SeriesId?: string;
  SeriesName?: string; // bei Episoden (Resume/NextUp)
  SeriesPrimaryImageTag?: string; // Poster-Tag der Serie (bei Episoden)
  SeasonId?: string;
}

/* Jellyfin liefert Listen mal als `{ Items: [...] }` (Views/NextUp/Items/Shows),
   mal als nacktes Array (Latest). Der Client normalisiert beides über unwrap(). */
export interface ItemsResponse {
  Items?: BaseItemDto[];
  TotalRecordCount?: number;
}

/* ── Einheiten & Kleinformer ── */

/** Ticks (100 ns) → ganze Sekunden. `undefined`/negativ → 0. */
export function ticksToSeconds(ticks: number | undefined): number {
  if (!ticks || ticks < 0) return 0;
  return Math.round(ticks / TICKS_PER_SECOND);
}

/** Sekunden → Ticks (für PlaybackPositionTicks im Progress-Reporting, Schritt 9). */
export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds)) * TICKS_PER_SECOND;
}

/** OfficialRating → FSK-Zahl. Zieht die erste ganze Zahl aus dem String
    ('FSK 16' → 16, 'de/12' → 12, '16' → 16); ohne Ziffer (z. B. 'R', null) → 0. */
export function parseFsk(rating: string | undefined): number {
  if (!rating) return 0;
  const m = rating.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** Stabiler Platzhalter-Farbton (0–359) aus der Item-Id — deckt die Zeit ab,
    bevor das Poster geladen ist, und ist bei jedem Aufbau gleich (kein Random). */
export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function toMs(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/* ── Item-Mapping ──
   `added` = DateCreated in ms (höher = neuer). `cw` = LastPlayedDate in ms
   (höher = zuletzt gespielt → Weiterschauen sortiert absteigend danach).
   Die Fake-Daten nutzen dieselben Felder als Rangzahlen; die Semantik
   „größer = neuer/zuletzt" bleibt konsistent. */

/** Film-DTO → LibraryItem. Position/Runtime aus Ticks in Sekunden. */
export function mapMovie(dto: BaseItemDto): LibraryItem {
  return {
    id: dto.Id,
    type: 'movie',
    title: dto.Name ?? '',
    year: dto.ProductionYear ?? 0,
    fsk: parseFsk(dto.OfficialRating),
    genres: dto.Genres ?? [],
    hue: hueFromId(dto.Id),
    added: toMs(dto.DateCreated),
    cw: toMs(dto.UserData?.LastPlayedDate),
    overview: dto.Overview ?? '',
    runtime: ticksToSeconds(dto.RunTimeTicks),
    pos: ticksToSeconds(dto.UserData?.PlaybackPositionTicks),
    ...artTags(dto),
  };
}

/** Serien-DTO → LibraryItem. `seasons` optional: im Detail voll geladen.
    `ChildCount` ist bei zusammengeführten Jellyfin-Serien unzuverlässig und
    zählt physische Duplikatbäume; bis zur Hydration bleibt die Liste leer. */
export function mapSeries(dto: BaseItemDto, seasons?: Season[]): LibraryItem {
  const list = seasons ?? [];
  return {
    id: dto.Id,
    type: 'series',
    title: dto.Name ?? '',
    year: dto.ProductionYear ?? 0,
    fsk: parseFsk(dto.OfficialRating),
    genres: dto.Genres ?? [],
    hue: hueFromId(dto.Id),
    added: toMs(dto.DateCreated),
    cw: toMs(dto.UserData?.LastPlayedDate),
    overview: dto.Overview ?? '',
    seasons: list,
    lastPlayed: null,
    ...artTags(dto),
  };
}

/** Dispatch nach `Type`. Serie ohne geladene Staffeln (Shelf-Ebene). */
export function mapItem(dto: BaseItemDto): LibraryItem {
  return dto.Type === 'Series' ? mapSeries(dto) : mapMovie(dto);
}

export function mapItems(dtos: readonly BaseItemDto[]): LibraryItem[] {
  return dtos.map(mapItem);
}

/** Folgen-DTO → Episode. `watched`/`pos` aus UserData. */
export function mapEpisode(dto: BaseItemDto): Episode {
  return {
    n: dto.IndexNumber ?? 0,
    title: dto.Name ?? '',
    dur: ticksToSeconds(dto.RunTimeTicks),
    watched: dto.UserData?.Played ?? false,
    pos: ticksToSeconds(dto.UserData?.PlaybackPositionTicks),
    // Jellyfin-Id der Folge fürs Playback (PlaybackInfo/Progress, Schritt 9).
    jfId: dto.Id,
  };
}

/** Staffel-DTOs + je Staffel geladene Folgen → normalisierte Season[].
    Jellyfin kann bei mehrfach vorhandenen Serien trotz SeasonId einen global
    zusammengeführten Episodenfeed liefern. Deshalb vertrauen wir nicht darauf,
    aus welcher Antwort eine Folge kam, sondern gruppieren fachlich nach
    ParentIndexNumber + IndexNumber. */
export function mapSeasons(
  seasonDtos: readonly BaseItemDto[],
  episodesBySeasonId: Readonly<Record<string, BaseItemDto[]>>,
): Season[] {
  const seasonNumbers = new Set(seasonDtos.map((season) => season.IndexNumber ?? 0));
  const bySeason = new Map<number, Map<string, BaseItemDto>>();

  for (const [sourceSeasonId, episodes] of Object.entries(episodesBySeasonId)) {
    const sourceSeasonNumber = seasonDtos.find((season) => season.Id === sourceSeasonId)?.IndexNumber ?? 0;
    for (const episode of episodes) {
      const seasonNumber = episode.ParentIndexNumber ?? sourceSeasonNumber;
      seasonNumbers.add(seasonNumber);
      const slots = bySeason.get(seasonNumber) ?? new Map<string, BaseItemDto>();
      const key = episodeIdentity(episode);
      const existing = slots.get(key);
      if (!existing || preferEpisode(episode, existing)) slots.set(key, episode);
      bySeason.set(seasonNumber, slots);
    }
  }

  return [...seasonNumbers]
    .sort((a, b) => a - b)
    .map((n) => ({
      n,
      episodes: [...(bySeason.get(n)?.values() ?? [])]
        .map(mapEpisode)
        .sort((a, b) => a.n - b.n),
    }));
}

function episodeIdentity(dto: BaseItemDto): string {
  // Staffel ist bereits die äußere Gruppe. Innerhalb davon ist IndexNumber die
  // fachliche Identität — auch wenn alternative Dateien abweichende Provider-IDs
  // tragen. Nur unnummerierte Specials brauchen einen schwächeren Fallback.
  if (dto.IndexNumber !== undefined) return `index:${dto.IndexNumber}`;
  const providers = dto.ProviderIds ?? {};
  for (const provider of ['Tmdb', 'Tvdb', 'Imdb']) {
    const value = Object.entries(providers)
      .find(([key]) => key.toLowerCase() === provider.toLowerCase())?.[1]
      ?.trim()
      .toLowerCase();
    if (value) return `${provider.toLowerCase()}:${value}`;
  }
  return `jellyfin:${dto.Id}`;
}

/** Bei mehreren Dateien desselben Episodenslots die mit dem aussagekräftigsten
    Benutzerzustand behalten; bei Gleichstand bleibt Jellyfins erste Reihenfolge. */
function preferEpisode(candidate: BaseItemDto, current: BaseItemDto): boolean {
  const score = (dto: BaseItemDto): number => {
    const played = dto.UserData?.Played ? 1_000_000_000_000_000 : 0;
    const position = Math.max(0, dto.UserData?.PlaybackPositionTicks ?? 0);
    const lastPlayed = Date.parse(dto.UserData?.LastPlayedDate ?? '') || 0;
    return played + position + lastPlayed / 1_000;
  };
  return score(candidate) > score(current);
}

/* ── Artwork ── */

/** Poster-/Backdrop-/Logo-Tags aus dem DTO ziehen (stabiles Caching, docs/08).
    Fehlende Tags bleiben undefined → die UI fällt auf den hue-Platzhalter zurück. */
function artTags(dto: BaseItemDto): Pick<LibraryItem, 'primaryTag' | 'backdropTag' | 'logoTag'> {
  return {
    primaryTag: dto.ImageTags?.Primary,
    backdropTag: dto.BackdropImageTags?.[0],
    logoTag: dto.ImageTags?.Logo,
  };
}
