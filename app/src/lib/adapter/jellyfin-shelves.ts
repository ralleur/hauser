/* ============================================
   Live-Shelf-Komposition (Schritt 8/9-Übergang) — reine Funktion, die aus den
   Browse-Antworten (Resume/Latest/Items) die Bibliotheks-Shelves + den
   deduplizierten Item-Index baut, den die Screens konsumieren. Kein Netz, kein
   State (analog jellyfin-map / ha-entities), damit die Ordnungs- und Overlay-
   Logik testbar bleibt.

   Zwei Eigenheiten des Jellyfin-Modells landen hier:
   1. Dasselbe Item taucht in mehreren Shelves auf (eine Serie ist „zuletzt
      hinzugefügt" UND „weiterschauen"). Wir halten pro Id GENAU EIN LibraryItem
      und überlagern den Resume-Fortschritt darauf — so zeigt die Kachel überall
      denselben Zustand, und Detail/Player finden das Item über libItem(id).
   2. „Weiterschauen" kommt als Film- ODER Episoden-DTO. Eine Resume-Episode wird
      auf ihre SERIE projiziert (lastPlayed + eingebettete Folge mit Position),
      damit continueInfo/resumeTarget (state/app) unverändert greifen.
   ============================================ */

import type { LibraryItem, Season } from '../state/app.svelte.ts';
import {
  mapMovie,
  mapSeries,
  mapEpisode,
  ticksToSeconds,
  hueFromId,
  type BaseItemDto,
} from './jellyfin-map.ts';

export interface LiveShelf {
  label: string;
  list: LibraryItem[];
}

export interface LiveLibrary {
  /** Deduplizierter Item-Index (für libItem/Detail/Player). */
  items: LibraryItem[];
  shelves: LiveShelf[];
}

export interface ShelfInput {
  resume: readonly BaseItemDto[];
  latest: readonly BaseItemDto[];
  movies: readonly BaseItemDto[];
  series: readonly BaseItemDto[];
}

/** Baut Item-Index + die vier Shelves (Weiterschauen, Zuletzt, Serien, Filme).
    Reihenfolge der Shelves folgt den Endpunkten (Resume-/Latest-Order bleibt),
    nicht einer Neuberechnung. */
export function buildLiveLibrary(input: ShelfInput): LiveLibrary {
  const byId = new Map<string, LibraryItem>();
  const byMediaIdentity = new Map<string, LibraryItem>();
  const upsert = (dto: BaseItemDto): LibraryItem => {
    const existing = byId.get(dto.Id);
    if (existing) return existing;
    const identity = mediaIdentity(dto);
    const sameMedia = byMediaIdentity.get(identity);
    if (sameMedia) {
      // Jellyfin vergibt für dasselbe Medium in mehreren Libraries verschiedene
      // Item-Ids. Der Alias leitet auch Resume-Daten auf das sichtbare Item um.
      byId.set(dto.Id, sameMedia);
      return sameMedia;
    }
    const item = dto.Type === 'Series' ? mapSeries(dto) : mapMovie(dto);
    byId.set(item.id, item);
    byMediaIdentity.set(identity, item);
    return item;
  };

  // dedupeById pro Shelf: Jellyfin liefert dasselbe Item über mehrere Libraries
  // (DiskA/DiskB) teils doppelt, und mehrere Resume-Folgen derselben Serie
  // projizieren auf dasselbe Serien-Item. Doppelte Ids in EINER Liste sprengen
  // sonst das keyed `{#each … (item.id)}` (Svelte each_key_duplicate).
  const movieItems = dedupeById(input.movies.map(upsert));
  const seriesItems = dedupeById(input.series.map(upsert));
  const latestItems = dedupeById(input.latest.map(upsert));

  // Resume überlagern + Weiterschauen-Liste in Endpunkt-Reihenfolge bauen.
  const continueList: LibraryItem[] = [];
  for (const dto of input.resume) {
    const item = dto.Type === 'Episode' ? overlayResumeEpisode(byId, dto) : overlayResumeMovie(byId, dto);
    if (item && hasResumeProgress(item)) continueList.push(item);
  }

  return {
    items: dedupeById([...byId.values()]),
    shelves: [
      { label: 'Weiterschauen', list: dedupeById(continueList) },
      { label: 'Zuletzt hinzugefügt', list: latestItems },
      { label: `Serien · ${seriesItems.length}`, list: seriesItems },
      { label: `Filme · ${movieItems.length}`, list: movieItems },
    ],
  };
}

/** Medien-Identität über Jellyfin-Library-Grenzen hinweg. Provider-IDs sind
    stabil, selbst wenn DiskA/DiskB verschiedene Jellyfin-Ids erhalten. Fehlen
    sie, fängt Typ + normalisierter Titel + Jahr die üblichen Doppelimporte ab. */
function mediaIdentity(dto: BaseItemDto): string {
  const type = dto.Type === 'Series' ? 'series' : 'movie';
  const providers = dto.ProviderIds ?? {};
  for (const provider of ['Tmdb', 'Tvdb', 'Imdb']) {
    const value = Object.entries(providers)
      .find(([key]) => key.toLowerCase() === provider.toLowerCase())?.[1]
      ?.trim()
      .toLowerCase();
    if (value) return `${type}:${provider.toLowerCase()}:${value}`;
  }
  const title = (dto.Name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${type}:title:${title}:year:${dto.ProductionYear ?? 0}`;
}

/* ── Resume-Overlay ── */

function overlayResumeMovie(byId: Map<string, LibraryItem>, dto: BaseItemDto): LibraryItem {
  const item = byId.get(dto.Id) ?? mapMovie(dto);
  byId.set(item.id, item);
  item.pos = ticksToSeconds(dto.UserData?.PlaybackPositionTicks);
  item.cw = lastPlayedMs(dto);
  return item;
}

/** Resume-Episode auf ihre Serie projizieren: Serie sicherstellen, lastPlayed
    setzen und die Folge (mit Position) in die passende Staffel einbetten. */
function overlayResumeEpisode(byId: Map<string, LibraryItem>, dto: BaseItemDto): LibraryItem | null {
  const seriesId = dto.SeriesId;
  if (!seriesId) return null;
  let series = byId.get(seriesId);
  if (!series) {
    series = seriesFromEpisode(dto);
    byId.set(seriesId, series);
  }
  const seasonN = dto.ParentIndexNumber ?? 1;
  const epN = dto.IndexNumber ?? 1;
  const episode = mapEpisode(dto);
  injectEpisode(series, seasonN, episode);
  series.lastPlayed = { season: seasonN, ep: epN };
  series.cw = lastPlayedMs(dto);
  if (!series.primaryTag && dto.SeriesPrimaryImageTag) series.primaryTag = dto.SeriesPrimaryImageTag;
  return series;
}

/** Minimales Serien-Item aus einem Episoden-DTO (nur Series*-Felder verfügbar).
    Detail lädt später die echten Staffeln/Folgen nach (hydrate). */
function seriesFromEpisode(dto: BaseItemDto): LibraryItem {
  const id = dto.SeriesId!;
  return {
    id,
    type: 'series',
    title: dto.SeriesName ?? '',
    year: 0,
    fsk: 0,
    genres: [],
    hue: hueFromId(id),
    added: 0,
    cw: 0,
    overview: '',
    seasons: [],
    lastPlayed: null,
    primaryTag: dto.SeriesPrimaryImageTag,
  };
}

/** Folge in die (ggf. Platzhalter-)Staffel einsetzen — ersetzt eine bereits
    vorhandene gleiche Foldennummer, damit continueInfo die Position sieht. */
function injectEpisode(series: LibraryItem, seasonN: number, episode: Season['episodes'][number]): void {
  const seasons = series.seasons ?? (series.seasons = []);
  let season = seasons.find((s) => s.n === seasonN);
  if (!season) {
    season = { n: seasonN, episodes: [] };
    seasons.push(season);
    seasons.sort((a, b) => a.n - b.n);
  }
  const idx = season.episodes.findIndex((e) => e.n === episode.n);
  if (idx >= 0) season.episodes[idx] = episode;
  else {
    season.episodes.push(episode);
    season.episodes.sort((a, b) => a.n - b.n);
  }
}

/* continueInfo-Bedingung (state/app) — hier lokal gespiegelt, um die
   Nebenwirkungen von app.svelte.ts (Timer) nicht in die pure Schicht zu ziehen. */
function hasResumeProgress(item: LibraryItem): boolean {
  if (item.type === 'movie') return (item.pos ?? 0) > 0;
  if (!item.lastPlayed) return false;
  const ep = item.seasons
    ?.find((s) => s.n === item.lastPlayed!.season)
    ?.episodes.find((e) => e.n === item.lastPlayed!.ep);
  return !!ep && ep.pos > 0;
}

/** Duplikate (gleiche Id) aus einer Liste entfernen, Reihenfolge erhalten. */
function dedupeById(items: readonly LibraryItem[]): LibraryItem[] {
  const seen = new Set<string>();
  const out: LibraryItem[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function lastPlayedMs(dto: BaseItemDto): number {
  const iso = dto.UserData?.LastPlayedDate;
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
