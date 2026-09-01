/* ============================================
   Smart Home HMI — Fake-State-Engine als Runes-Store (Phase 3, ADR-013/015)
   Portiert aus prototype/scripts/main.js: gleiche Daten, gleiche Logik —
   aber $state statt Hand-Rendering. Die HA-/Jellyfin-Anbindung ersetzt
   sendCommand/sendJellyfin in der Anbindungs-Session (Adapter, ADR-015).
   ============================================ */

import { showScreen } from './nav.svelte.ts';
import { m } from '../../paraglide/messages.js';

import {
  buildRuntimeRooms,
  loadDeviceConfig,
  mergeCatalog,
  seedCatalog,
} from './device-config.ts';

import {
  ENERGY_SENSORS,
  MEDIA_SEED,
  ROOM_SEED,
  SUN_ENTITY,
} from '../config/household-runtime-data.ts';
import {
  energyRefIds,
  type EnergySensorRef,
  type EnergySensors,
  type Light,
  type LightSeed,
  type LoadSource,
  type MediaPlayerMeta,
  type MediaSeed,
  type Room,
  type RoomSeed,
} from '../config/legacy-household-data.ts';
export {
  ENERGY_SENSORS,
  MEDIA_SEED,
  ROOM_SEED,
  SUN_ENTITY,
} from '../config/household-runtime-data.ts';
export {
  energyRefIds,
} from '../config/legacy-household-data.ts';
export type {
  EnergySensorRef,
  EnergySensors,
  Light,
  LightSeed,
  LoadSource,
  MediaPlayerMeta,
  MediaSeed,
  Room,
  RoomSeed,
} from '../config/legacy-household-data.ts';

/* Static room/media/energy values are installed before this module is imported.
   Shadow keeps the exact legacy references; active exposes the config projection. */

export interface Episode {
  n: number; title: string; dur: number; watched: boolean; pos: number;
  /* Jellyfin-Item-Id der Folge (Funktionsumfang 9): nötig für PlaybackInfo/
     Progress-Reporting. Nur gesetzt, wenn die Folge aus der echten API stammt;
     die Fake-Folgen kennen keine Id (der Fake-Pfad ruft Jellyfin nie auf). */
  jfId?: string;
}

export interface Season { n: number; episodes: Episode[] }

export interface LibraryItem {
  id: string; type: 'movie' | 'series'; title: string; year: number; fsk: number;
  genres: string[]; hue: number; added: number; cw: number; overview: string;
  /* movie */ runtime?: number; pos?: number;
  /* series */ seasons?: Season[]; lastPlayed?: { season: number; ep: number } | null;
  /* Jellyfin-Artwork (ADR-008, Schritt 8): stabile Image-Tags fürs Caching.
     Nur gesetzt, wenn das Item aus der echten API stammt; die Fake-Daten
     bleiben beim `hue`-Platzhalter. Die Poster-URL baut die UI über
     `jellyfin.imageUrl(id, { tag })` zur passenden Render-Größe. */
  primaryTag?: string; backdropTag?: string; logoTag?: string;
  /* Statisches Poster der Fake-Bibliothek (relative URL unter dem Basispfad
     des Builds). Nur die Demo-Daten setzen es; die Jellyfin-Zuordnung nie. */
  poster?: string;
}

export interface Playback {
  item: LibraryItem;
  season: number | null;
  ep: Episode | null;
  duration: number;
  position: number;
  playing: boolean;
  /* Live-Wiedergabe (Funktionsumfang 9): true, sobald ein echtes <video> mit
     HLS läuft. Dann treibt der Player-Timeupdate die Position — nicht der
     Fake-1-Hz-Tick (der schaltet sich ab). PlayerLayer.svelte setzt das Flag,
     sobald der Live-Modus greift; im Fake-Modus bleibt es undefined. */
  live?: boolean;
}

export interface SystemService {
  id: string; name: string; status: 'online' | 'degraded' | 'offline'; detail: string;
}

/* Generische Staffel für die Fake-Bibliothek — englische Folgentitel wie der
   Rest der erfundenen Inhalte; bewusst kein Message-Aufruf beim Modulstart,
   weil Tests das Modul ohne Browser-Speicher laden (nur nicht-Feature-Serien —
   „Halbmond" hat handgeschriebene Folgentitel). watchedThrough = Folgen 1…n
   gelten als gesehen. */
const POSTER_BASE = `${import.meta.env.BASE_URL}demo-posters/`;

function makeSeason(n: number, count: number, dur: number, watchedThrough = 0): Season {
  return {
    n,
    episodes: Array.from({ length: count }, (_, i) => ({
      n: i + 1, title: `Episode ${i + 1}`, dur, watched: i < watchedThrough, pos: 0,
    })),
  };
}

/* Farbtemperatur-Bereich der UI (Kelvin) — warm ↔ kühl (Hauser-Tick-Skala). */
export const COLOR_TEMP_MIN = 2000;
export const COLOR_TEMP_MAX = 6500;

export const appState = $state({
  theme: 'dark' as 'dark' | 'light',
  heroSun: undefined as { day: boolean } | undefined,
  currentRoom: null as string | null,
  // Statische Projektion des Seeds (ADR-017): steuerbare Felder bewusst weg —
  // die kommen aus dem EntityStore über die gemergte Sicht.
  rooms: buildRuntimeRooms(ROOM_SEED, mergeCatalog(seedCatalog(ROOM_SEED), []), loadDeviceConfig()),
  scenes: ['Gemütlich', 'Hell', 'Aus'],
  // Energie (docs/07 Screen 10): die Live-Sicht liegt in state/energy.svelte.ts
  // und liest reale HA-Sensoren (ENERGY_SENSORS) über den Adapter-Seam — kein
  // Fake-State mehr im appState.
  media: {
    current: MEDIA_SEED[0]?.id ?? '',
    // Statische Player-Liste (id/name); steuerbare + gepushte Werte kommen aus
    // dem EntityStore über mergedMedia (ADR-017 Addendum).
    players: MEDIA_SEED.map(({ id, name }): MediaPlayerMeta => ({ id, name })),
    // Preset-Grid (docs/06 §4: Ghost-Cards, Hauser-Radio-Pattern)
    presets: [
      { label: 'Radio', value: '1LIVE' },
      { label: 'Radio', value: 'WDR 2' },
      { label: 'Playlist', value: 'Morgen-Mix' },
      { label: 'Playlist', value: 'Abendruhe' },
    ],
  },
  /* Jellyfin-Bibliothek (docs/07 Screens 6–8, docs/08): Fake-Daten mit
     eigenen Postern — sechzehn erfundene Filme und Serien, deren Titel mit
     Begriffen aus dem Alltag am Rechner spielen (Ctrl+Z, 404, ein Stapel
     Pfannkuchen ohne Limit). Die Poster liegen als kleine WebP-Dateien unter
     public/demo-posters/ und sind bewusst nicht im Offline-Precache; `hue`
     bleibt der Platzhalter, falls ein Poster fehlt. Echte Poster kommen über
     /Items/{id}/Images/Primary?maxWidth&tag.
     pos/ep.pos in Sekunden = Resume-Punkt (Jellyfin: PositionTicks). */
  library: {
    currentId: null as string | null,
    season: 1, // im Detail ausgewählte Staffel
    items: [
      {
        id: 'off-by-one', type: 'movie', title: "Off by One", year: 2025, fsk: 12,
        genres: ["Heist", "Comedy"], hue: 258, runtime: 6480, added: 1, pos: 0, cw: 0,
        poster: `${POSTER_BASE}off-by-one.webp`,
        overview: "Eleven friends plan the perfect heist and buy ten ski masks. The eleventh, a maths teacher, insists the plan is correct and the world is counting wrong.",
      },
      {
        id: 'ctrl-z', type: 'movie', title: "Ctrl+Z", year: 2023, fsk: 12,
        genres: ["Drama", "Science Fiction"], hue: 180, runtime: 7680, added: 2, pos: 2880, cw: 3,
        poster: `${POSTER_BASE}ctrl-z.webp`,
        overview: "After a lab accident, Mira can undo the last thing she did. Only the last thing. Her sister is about to say something she cannot take back.",
      },
      {
        id: 'hello-world', type: 'movie', title: "Hello, World", year: 2025, fsk: 0,
        genres: ["Documentary"], hue: 205, runtime: 5220, added: 4, pos: 0, cw: 0,
        poster: `${POSTER_BASE}hello-world.webp`,
        overview: "The first words of every programmer, spoken by people who never wrote a line. A documentary about a greeting that went around the planet, and the twelve countries that answered.",
      },
      {
        id: 'love-not-found', type: 'movie', title: "404: Love Not Found", year: 2022, fsk: 6,
        genres: ["Romantic Comedy"], hue: 350, runtime: 6060, added: 6, pos: 0, cw: 0,
        poster: `${POSTER_BASE}love-not-found.webp`,
        overview: "He is a page nobody links to. She is the search engine. A romantic comedy about being found by the one person who was actually looking.",
      },
      {
        id: 'dark-mode', type: 'movie', title: "Dark Mode", year: 2023, fsk: 16,
        genres: ["Noir", "Crime"], hue: 230, runtime: 7260, added: 7, pos: 1080, cw: 1,
        poster: `${POSTER_BASE}dark-mode.webp`,
        overview: "A city switched to night and never switched back. A detective who works only by the light of her phone hunts the one who flipped the switch.",
      },
      {
        id: 'rubber-duck', type: 'movie', title: "The Rubber Duck", year: 2024, fsk: 0,
        genres: ["Family", "Animation"], hue: 45, runtime: 5460, added: 8, pos: 0, cw: 0,
        poster: `${POSTER_BASE}rubber-duck.webp`,
        overview: "A small yellow duck never says a word, yet everyone who explains their problem to it walks away with the answer. Now the duck is missing, and the town has questions.",
      },
      {
        id: 'race-condition', type: 'movie', title: "Race Condition", year: 2024, fsk: 16,
        genres: ["Thriller"], hue: 12, runtime: 6240, added: 9, pos: 0, cw: 0,
        poster: `${POSTER_BASE}race-condition.webp`,
        overview: "Two couriers are handed the same key to a vault that opens exactly once. Whoever arrives second was never there. Told twice, from both sides.",
      },
      {
        id: 'cache-also-rises', type: 'movie', title: "The Cache Also Rises", year: 2020, fsk: 12,
        genres: ["Drama"], hue: 25, runtime: 7020, added: 11, pos: 0, cw: 0,
        poster: `${POSTER_BASE}cache-also-rises.webp`,
        overview: "A village bakery remembers every order ever placed and bakes it again before you ask. Then a stranger orders something new.",
      },
      {
        id: 'kernel-panic', type: 'movie', title: "Kernel Panic", year: 2021, fsk: 12,
        genres: ["Disaster"], hue: 0, runtime: 5340, added: 12, pos: 0, cw: 0,
        poster: `${POSTER_BASE}kernel-panic.webp`,
        overview: "The world's biggest cinema installs a popcorn machine with a mind of its own. On opening night it decides the show will not go on.",
      },
      {
        id: 'big-endian', type: 'movie', title: "Big Endian", year: 2019, fsk: 12,
        genres: ["Western"], hue: 35, runtime: 8040, added: 13, pos: 0, cw: 0,
        poster: `${POSTER_BASE}big-endian.webp`,
        overview: "A frontier town has argued for forty years about which end of Main Street is the beginning. A stranger arrives with a measuring tape and no opinion.",
      },
      {
        id: 'infinite-loop', type: 'series', title: "Infinite Loop", year: 2024, fsk: 16,
        genres: ["Mystery"], hue: 265, added: 5, cw: 4,
        lastPlayed: { season: 2, ep: 4 },
        poster: `${POSTER_BASE}infinite-loop.webp`,
        overview: "Every morning the 7:42 leaves the station and arrives at the station it just left. Only the conductor notices, and she is running out of ways to say so.",
        seasons: [
          { n: 1, episodes: [
            { n: 1, title: 'Departure', dur: 3060, watched: true, pos: 0 },
            { n: 2, title: 'Arrival', dur: 2940, watched: true, pos: 0 },
            { n: 3, title: 'Departure', dur: 3000, watched: true, pos: 0 },
            { n: 4, title: 'Arrival', dur: 3120, watched: true, pos: 0 },
            { n: 5, title: 'Loop Line', dur: 2880, watched: true, pos: 0 },
            { n: 6, title: 'Terminus', dur: 3060, watched: true, pos: 0 },
            { n: 7, title: 'Terminus', dur: 2940, watched: true, pos: 0 },
            { n: 8, title: 'Terminus', dur: 3300, watched: true, pos: 0 },
          ] },
          { n: 2, episodes: [
            { n: 1, title: 'Same Train', dur: 3060, watched: true, pos: 0 },
            { n: 2, title: 'Different Day', dur: 2940, watched: true, pos: 0 },
            { n: 3, title: 'The Timetable', dur: 3000, watched: true, pos: 0 },
            { n: 4, title: 'Signal Failure', dur: 3120, watched: false, pos: 1250 },
            { n: 5, title: 'Return Ticket', dur: 2940, watched: false, pos: 0 },
            { n: 6, title: 'Platform Nine', dur: 3060, watched: false, pos: 0 },
            { n: 7, title: 'Last Stop', dur: 2940, watched: false, pos: 0 },
            { n: 8, title: 'First Stop', dur: 3480, watched: false, pos: 0 },
          ] },
        ],
      },
      {
        id: 'merge-conflict', type: 'series', title: "Merge Conflict", year: 2023, fsk: 6,
        genres: ["Romantic Comedy"], hue: 150, added: 10, cw: 0,
        lastPlayed: null,
        poster: `${POSTER_BASE}merge-conflict.webp`,
        overview: "Two families move into one house with two sets of rules. Nobody will delete a line, so they keep both. A comedy about the parts that overlap.",
        seasons: [makeSeason(1, 8, 1560, 8), makeSeason(2, 8, 1560, 3)],
      },
      {
        id: 'the-daemon', type: 'series', title: "The Daemon", year: 2025, fsk: 16,
        genres: ["Horror"], hue: 120, added: 3, cw: 0,
        lastPlayed: null,
        poster: `${POSTER_BASE}the-daemon.webp`,
        overview: "Something in the house has been running since before the family moved in. It is quiet, it is helpful, and it does not like being stopped.",
        seasons: [makeSeason(1, 8, 2820)],
      },
      {
        id: 'legacy-code', type: 'series', title: "Legacy Code", year: 2022, fsk: 12,
        genres: ["Family Drama"], hue: 30, added: 14, cw: 0,
        lastPlayed: null,
        poster: `${POSTER_BASE}legacy-code.webp`,
        overview: "Three siblings inherit their grandfather's workshop, a customer list from 1974 and a manual nobody can read. Everything still works. Nobody knows why.",
        seasons: [makeSeason(1, 6, 2700, 6), makeSeason(2, 6, 2760, 2)],
      },
      {
        id: 'stack-overflow', type: 'series', title: "Stack Overflow", year: 2020, fsk: 6,
        genres: ["Comedy"], hue: 40, added: 15, cw: 2,
        lastPlayed: { season: 1, ep: 2 },
        poster: `${POSTER_BASE}stack-overflow.webp`,
        overview: "A pancake diner with one rule: the plate has no limit. Four seasons of regulars, rivals and a stack that has never once been finished.",
        seasons: [makeSeason(1, 10, 1560, 1), makeSeason(2, 10, 1560), makeSeason(3, 10, 1620), makeSeason(4, 10, 1620)],
      },
      {
        id: 'serial-port', type: 'series', title: "Serial Port", year: 2021, fsk: 16,
        genres: ["Crime"], hue: 215, added: 16, cw: 0,
        lastPlayed: null,
        poster: `${POSTER_BASE}serial-port.webp`,
        overview: "A harbour detective takes cases one at a time, in the order they arrive, and refuses to be rushed. The harbour does not agree.",
        seasons: [makeSeason(1, 8, 2640, 8), makeSeason(2, 8, 2640, 8), makeSeason(3, 8, 2700)],
      },
    ] as LibraryItem[],
  },
  playback: null as Playback | null, // aktive (Fake-)Wiedergabe im Player-Layer
  system: {
    services: [
      { id: 'ha', name: 'Home Assistant', status: 'online', detail: 'Version 2026.6.4 · 885 Entitäten' },
      { id: 'z2m', name: 'Zigbee2MQTT', status: 'online', detail: '27 Geräte verbunden' },
      { id: 'mqtt', name: 'MQTT Broker', status: 'online', detail: 'Verbunden' },
      { id: 'tunnel', name: 'Cloudflared Tunnel', status: 'degraded', detail: '1/2 Routen aktiv' },
      { id: 'adguard', name: 'AdGuard', status: 'online', detail: '142.853 Anfragen heute' },
    ] as SystemService[],
    updates: [
      { name: 'Home Assistant Core', from: '2026.6.4', to: '2026.7.1' },
      { name: 'Home Assistant OS', from: '15.2', to: '15.3' },
      { name: 'Zigbee2MQTT', from: '2.4.0', to: '2.5.1' },
      { name: 'ESPHome', from: '2026.5.2', to: '2026.6.0' },
      { name: 'AdGuard Home', from: '0.107.60', to: '0.107.62' },
      { name: 'Matter Server', from: '7.0.1', to: '7.1.0' },
    ],
  },
});

/* Resume-Punkt in einer generierten Staffel nachtragen (Tiefgang S1E2 läuft) */
appState.library.items.find((i) => i.id === 'stack-overflow')!.seasons![0].episodes[1].pos = 900;

// Dev-Handle: appState im Preview-Browser inspizierbar (window.__hmi.appState).
if (typeof window !== 'undefined') {
  const w = window as unknown as { __hmi?: Record<string, unknown> };
  w.__hmi = { ...(w.__hmi ?? {}), appState };
}

/* SystemStatus-Zustände (docs/06 §6) — Dot + Label aus einer Quelle */
export const SERVICE_STATUS = {
  online: { label: 'Verbunden', dot: 'dot-online' },
  degraded: { label: 'Eingeschränkt', dot: 'dot-warning' },
  offline: { label: 'Nicht erreichbar', dot: 'dot-offline' },
} as const;

export const HVAC_MODES = [
  { id: 'heat', get label() { return m.climate_mode_heat(); }, icon: 'i-flame' },
  { id: 'cool', get label() { return m.climate_mode_cool(); }, icon: 'i-snow' },
  { id: 'off', get label() { return m.climate_mode_off(); }, icon: 'i-power' },
] as const;

/* Fake-Command-Dispatch: loggt nur; die Anbindungs-Session ersetzt das durch
   CommandQueue → WebSocket (ADR-015). Der optimistische UI-Update ist zu
   diesem Zeitpunkt bereits passiert. */
export function sendCommand(domain: string, service: string, data: Record<string, unknown>) {
  console.log(`[fake-ha] ${domain}.${service}`, data);
}

/* Fake-Jellyfin-Dispatch (analog sendCommand): loggt nur; später REST-API
   (/Sessions/Playing, /Sessions/Playing/Progress, … — docs/08) */
export function sendJellyfin(endpoint: string, data: Record<string, unknown>) {
  console.log(`[fake-jellyfin] ${endpoint}`, data);
}

/* ── Räume ── */
export function currentRoom(): Room | undefined {
  return appState.rooms.find((r) => r.id === appState.currentRoom);
}

/* ── Energie ── */

/* Deterministischer 24-h-Verlauf als PLATZHALTER für den Tagesverlauf-Chart.
   Der echte historische Verlauf braucht die HA-Statistics-API
   (`recorder/statistics_during_period`) — ein separater WS-Request außerhalb
   des subscribe_entities-Seams — und ist als Folge-Schritt zurückgestellt
   (BACKLOG). Live-Fluss + Tages-KPIs (state/energy.svelte.ts) sind bereits real.
   Kein Math.random: der Chart sieht bei jedem Aufbau gleich aus. */
export const ENERGY_CURVE = Array.from({ length: 24 }, (_, h) => {
  const wave = (n: number) => Math.abs(Math.sin(h * n + 1.7)) * 0.12; // organisches Rauschen
  const prod = h < 6 || h > 20 ? 0 : Math.max(0, Math.sin(((h - 6) / 14) * Math.PI) - wave(2.3));
  const load = Math.min(1,
    0.22 + wave(3.1)
    + (h >= 6 && h <= 9 ? 0.4 : 0)
    + (h >= 17 && h <= 22 ? 0.55 : 0)
    + (h >= 12 && h <= 13 ? 0.18 : 0));
  return { prod, load };
});

/* ── Bibliothek (docs/07 Screens 6–8, docs/08) ── */
let cwSeq = 100; // Weiterschauen-Reihenfolge: zuletzt gespielt zuerst

export function libItem(id: string | null): LibraryItem | undefined {
  return appState.library.items.find((i) => i.id === id);
}

export function epOf(item: LibraryItem, seasonN: number, epN: number): Episode | null {
  return item.seasons?.find((s) => s.n === seasonN)?.episodes.find((e) => e.n === epN) ?? null;
}

export interface ResumeTarget {
  season?: number; ep?: Episode; pos: number; dur: number; resume: boolean;
}

/* Resume-Ziel eines Items: Film = eigener Punkt, Serie = angefangene bzw.
   erste ungesehene Folge (Jellyfin-NextUp-Logik, vereinfacht) */
export function resumeTarget(item: LibraryItem): ResumeTarget {
  if (item.type === 'movie') {
    return { pos: item.pos!, dur: item.runtime!, resume: item.pos! > 0 };
  }
  if (item.lastPlayed) {
    const ep = epOf(item, item.lastPlayed.season, item.lastPlayed.ep);
    if (ep && ep.pos > 0) return { season: item.lastPlayed.season, ep, pos: ep.pos, dur: ep.dur, resume: true };
  }
  const seasons = item.seasons ?? [];
  for (const s of seasons) {
    const ep = s.episodes.find((e) => !e.watched);
    if (ep) return { season: s.n, ep, pos: ep.pos, dur: ep.dur, resume: ep.pos > 0 };
  }
  const s0 = seasons.find((s) => s.episodes.length); // erste Staffel mit Folgen
  if (!s0) {
    // Live-Serie noch nicht hydriert (keine Folgen geladen) — sicheres Ziel
    // ohne Folge; die Detail-Screen zeigt bis dahin einen Ladezustand.
    return { season: seasons[0]?.n ?? item.lastPlayed?.season ?? 1, pos: 0, dur: 0, resume: false };
  }
  return { season: s0.n, ep: s0.episodes[0], pos: 0, dur: s0.episodes[0].dur, resume: false };
}

/* Weiterschauen-Info für die MediaCard: Fortschritts-Anteil + Meta-Zeile */
export function continueInfo(item: LibraryItem): { frac: number; meta: string } | null {
  if (item.type === 'movie') {
    return item.pos! > 0
      ? { frac: item.pos! / item.runtime!, meta: m.library_remaining({ minutes: Math.round((item.runtime! - item.pos!) / 60) }) }
      : null;
  }
  if (!item.lastPlayed) return null;
  const ep = epOf(item, item.lastPlayed.season, item.lastPlayed.ep);
  return ep && ep.pos > 0
    ? { frac: ep.pos / ep.dur, meta: `S${item.lastPlayed.season} · E${ep.n}` }
    : null;
}

/* Media Detail öffnen (docs/07 Screen 7): Staffel-Vorauswahl folgt dem
   Resume-Ziel; Navigation als echter Unter-Screen mit Back (anders als
   das Room Overlay) */
export function openMediaItem(id: string) {
  const item = libItem(id)!;
  appState.library.currentId = id;
  appState.library.season = item.type === 'series' ? resumeTarget(item).season! : 1;
  showScreen('library-detail');
}

/* ── Player (docs/07 Screen 8): Playback-State; das Chrome-Verhalten
   (Auto-Hide) lebt in PlayerLayer.svelte ── */

/* Fortschritt zurück in die Bibliothek schreiben (Fake-Pendant zum
   Progress-Reporting, docs/08) — kurz vor Ende gilt als gesehen */
export function writeThrough(pb: Playback) {
  const nearEnd = pb.position >= pb.duration * 0.97;
  if (pb.ep) {
    pb.ep.pos = nearEnd ? 0 : Math.round(pb.position);
    if (nearEnd) pb.ep.watched = true;
    pb.item.lastPlayed = { season: pb.season!, ep: pb.ep.n };
  } else {
    pb.item.pos = nearEnd ? 0 : Math.round(pb.position);
  }
}

/* Vorherige/nächste Folge über Staffelgrenzen hinweg (Filme: null) */
export function adjacentEpisode(pb: Playback, dir: 1 | -1): { season: number; ep: Episode } | null {
  if (!pb.ep) return null;
  const flat: { season: number; ep: Episode }[] = [];
  pb.item.seasons!.forEach((s) => s.episodes.forEach((e) => flat.push({ season: s.n, ep: e })));
  const idx = flat.findIndex((x) => x.season === pb.season && x.ep.n === pb.ep!.n);
  return flat[idx + dir] ?? null;
}

export function openPlayer(item: LibraryItem, epRef: { season: number; ep: Episode } | null, startPos: number) {
  item.cw = ++cwSeq; // frisch gespielt → vorn im Weiterschauen-Shelf
  const duration = epRef ? epRef.ep.dur : item.runtime!;
  appState.playback = {
    item,
    season: epRef?.season ?? null,
    ep: epRef?.ep ?? null,
    duration,
    position: Math.min(startPos, duration - 1),
    playing: true,
  };
  writeThrough(appState.playback); // „Von vorne" verwirft den alten Punkt sofort
  sendJellyfin('Sessions/Playing', {
    item: item.id,
    episode: epRef ? `S${epRef.season}E${epRef.ep.n}` : null,
    position: Math.round(appState.playback.position),
  });
}

export function closePlayer() {
  const pb = appState.playback;
  if (!pb) return;
  writeThrough(pb);
  sendJellyfin('Sessions/Playing/Stopped', { item: pb.item.id, position: Math.round(pb.position) });
  appState.playback = null;
}

/* ── Ticks (Fake; später: HA-Push) — State-Ebene, kein Animations-Timer.
   Anders als im Clickdummy muss hier niemand prüfen, ob der Screen sichtbar
   ist: Svelte updated nur die DOM-Knoten, die den Wert wirklich zeigen. ── */

/* Der 1-Hz-Fortschritt des Raum-Audios ist lokale Simulation über die gemergte
   Sicht und lebt in state/media.svelte.ts (ADR-017 Addendum) — nicht hier, weil
   media_player jetzt durch den Adapter-Seam läuft. */

/* Fake-Wiedergabe: 1-Hz-Tick; am Ende pausiert der Player und markiert die
   Folge/den Film als gesehen (Chrome-Reaktion: PlayerLayer.svelte) */
setInterval(() => {
  const pb = appState.playback;
  if (!pb || !pb.playing || pb.live) return; // Live: der <video>-Timeupdate treibt die Position
  pb.position = Math.min(pb.duration, pb.position + 1);
  writeThrough(pb);
  if (pb.position >= pb.duration) {
    pb.playing = false;
    sendJellyfin('Sessions/Playing/Stopped', { item: pb.item.id, ended: true });
  }
}, 1000);
