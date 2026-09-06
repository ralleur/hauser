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

/* Farbtemperatur-Bereich der UI (Kelvin) — warm ↔ kühl (Hauser-Tick-Skala). */
export const COLOR_TEMP_MIN = 2000;
export const COLOR_TEMP_MAX = 6500;

export const appState = $state({
  theme: 'dark' as 'dark' | 'light',
  heroSun: undefined as { day: boolean; elevation?: number | null } | undefined,
  /* Dämmerungs-Fortschritt (Paket 4): 1 Tag, 0 Nacht, dazwischen das Band um
     den Horizont. Ohne Sonnenhöhe bleibt es beim Hartschnitt 1/0. */
  heroDusk: 1,
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
  /* Jellyfin-Bibliothek (docs/07 Screens 6–8, docs/08): leer bis die
     Bibliothek lädt — die Fake-Daten stehen in state/library-seed.ts, die
     echten kommen aus der Jellyfin-API. Beides liegt hinter dem Startpfad
     (ADR-029). */
  library: {
    currentId: null as string | null,
    season: 1, // im Detail ausgewählte Staffel
    items: [] as LibraryItem[],
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
      ? { frac: item.pos! / item.runtime!, meta: `Noch ${Math.round((item.runtime! - item.pos!) / 60)} min` }
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
