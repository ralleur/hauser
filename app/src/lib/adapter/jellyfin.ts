/* ============================================
   JellyfinClient (Schritt 8, ADR-008 / docs/08) — REST-Adapter für die
   Video-Bibliothek. Gleichberechtigt neben dem HA-WebSocket-Adapter: Jellyfin
   ist ein Backend wie HA eines ist. KEINE Einbettung der Jellyfin-Web-App —
   wir sprechen ausschließlich die REST-API an und rendern im HMI-Designsystem.

   Diese Schicht macht Auth + Browse (Views/Resume/Latest/NextUp/Items/Detail/
   Seasons/Episodes) + Artwork-URLs. Sie liefert rohe `BaseItemDto` zurück; die
   Übersetzung in App-Shapes liegt rein in jellyfin-map.ts (analog ha-entities.ts),
   damit der Konsument je Shelf entscheidet (Episode vs. Serie). Die Wiedergabe
   (PlaybackInfo/HLS/Progress) ist Schritt 9 und bewusst NICHT hier.

   Auth-Header (docs/08): `MediaBrowser Client=…, Device=…, DeviceId=…, Version=…`
   plus `Token=…` nach dem Login. DeviceId ist einmalig erzeugt und persistiert
   (stabile Geräte-Identität für Sessions/Resume). Kein Token/Passwort im Repo
   oder Build — Token entsteht zur Laufzeit aus User-Input (Login) und lebt nur
   in localStorage (Leitplanke docs/04, docs/08).
   ============================================ */

import type { BaseItemDto, ItemsResponse } from './jellyfin-map.ts';
import {
  buildDeviceProfile,
  resolveStreamUrl,
  type PlaybackInfoResponse,
  type PlaybackSelection,
} from './jellyfin-playback.ts';
import { sharedStorage } from '../state/shared-config.ts';

const CLIENT_NAME = 'SmartHomeHMI';
const DEVICE_NAME = 'WallTablet';
const DEVICE_KEY = 'hmi:jf-device';
const TOKEN_KEY = 'hmi:jf-token';
const USER_KEY = 'hmi:jf-user';

/* Felder, die Jellyfin nur auf Anfrage mitschickt (Overview/Genres etc.).
   RunTimeTicks + UserData liefern die User-Endpunkte ohnehin mit. */
const BROWSE_FIELDS = 'Overview,Genres,DateCreated,ChildCount,ProviderIds';

/** 401 vom Server: Token abgelaufen/ungültig bzw. Login abgelehnt. Vom
    Netzwerk-/Server-Fehler (Error) unterscheidbar, damit die UI gezielt den
    Login (statt Offline-Banner) zeigt. */
export class JellyfinAuthError extends Error {
  constructor(message = 'Jellyfin-Authentifizierung fehlgeschlagen') {
    super(message);
    this.name = 'JellyfinAuthError';
  }
}

/** Antwort von /Users/AuthenticateByName. */
export interface JellyfinSession {
  AccessToken: string;
  User: { Id: string; Name?: string };
}

export interface ItemsQuery {
  parentId?: string;
  includeItemTypes?: string; // 'Movie' | 'Series' | 'Movie,Series'
  sortBy?: string; // z. B. 'SortName'
  sortOrder?: 'Ascending' | 'Descending';
  limit?: number;
  startIndex?: number;
  recursive?: boolean;
}

export interface ImageQuery {
  type?: 'Primary' | 'Backdrop' | 'Logo' | 'Thumb';
  tag?: string;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

/** Body für /Sessions/Playing[/Progress|/Stopped] (docs/08). PositionTicks in
    Ticks (secondsToTicks aus jellyfin-map). Felder, die Jellyfin für Resume +
    „Now Playing" braucht — der Rest ist optional. */
export interface PlaybackReport {
  ItemId: string;
  PlaySessionId: string;
  MediaSourceId: string;
  PositionTicks: number;
  IsPaused?: boolean;
  PlayMethod?: PlaybackSelection['playMethod'];
  CanSeek?: boolean;
  EventName?: 'timeupdate' | 'pause' | 'unpause' | 'seek';
}

export interface JellyfinClientOptions {
  /** Basis-URL, z. B. `http://jellyfin.local:8096` (ohne Trailing-Slash egal). */
  baseUrl: string;
  /** App-Version für den Auth-Header. */
  version?: string;
  /** DI-Seam für Tests — sonst globales fetch. */
  fetchImpl?: typeof fetch;
  /** Test-/Setup-Override statt localStorage. */
  deviceId?: string;
  token?: string | null;
  userId?: string | null;
}

export class JellyfinClient {
  #base: string;
  #version: string;
  #fetch: typeof fetch;
  #deviceId: string;
  #token: string | null;
  #userId: string | null;
  #onAuth: (() => void) | null = null;

  constructor(opts: JellyfinClientOptions) {
    this.#base = opts.baseUrl.replace(/\/+$/, '');
    this.#version = opts.version ?? '0.3.0';
    this.#fetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#deviceId = opts.deviceId ?? ensureDeviceId();
    this.#token = opts.token !== undefined ? opts.token : readLS(TOKEN_KEY);
    this.#userId = opts.userId !== undefined ? opts.userId : readLS(USER_KEY);
  }

  /* ── Identität & Session ── */

  get deviceId(): string {
    return this.#deviceId;
  }

  get userId(): string | null {
    return this.#userId;
  }

  hasSession(): boolean {
    return !!this.#token && !!this.#userId;
  }

  /** Emby/Jellyfin-Authorization-Header. Token nur, sobald eingeloggt. */
  authHeader(): string {
    let h = `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${this.#deviceId}", Version="${this.#version}"`;
    if (this.#token) h += `, Token="${this.#token}"`;
    return h;
  }

  /** Session-Verlust (Token ungültig) → Login erneut zeigen (docs/04). */
  onAuthError(cb: () => void): void {
    this.#onAuth = cb;
  }

  /** User-Login (docs/08): AccessToken + User.Id. Ein 401 wirft
      JellyfinAuthError (falsche Zugangsdaten), Netz-/Serverfehler Error.
      Im Setup kann die Session geprüft werden, ohne sie vor der atomaren
      Aktivierung zentral oder lokal zu persistieren. */
  async authenticateByName(
    username: string,
    pw: string,
    options: { persist?: boolean } = {},
  ): Promise<JellyfinSession> {
    const res = await this.#fetch(`${this.#base}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader() },
      body: JSON.stringify({ Username: username, Pw: pw }),
    });
    if (res.status === 401) throw new JellyfinAuthError('Benutzername oder Passwort falsch');
    if (!res.ok) throw new Error(`Jellyfin-Login fehlgeschlagen: ${res.status}`);
    const data = (await res.json()) as JellyfinSession;
    this.#token = data.AccessToken;
    this.#userId = data.User.Id;
    if (options.persist !== false) {
      sharedStorage.setItem(TOKEN_KEY, this.#token);
      sharedStorage.setItem(USER_KEY, this.#userId);
    }
    return data;
  }

  /** Abmelden: best-effort Server-Logout, dann lokale Session verwerfen. */
  async logout(): Promise<void> {
    if (this.#token) {
      await this.#fetch(`${this.#base}/Sessions/Logout`, {
        method: 'POST',
        headers: { Authorization: this.authHeader() },
      }).catch(() => {});
    }
    this.#clearSession();
  }

  /* ── Browse (rohe DTOs; Mapping im Konsumenten via jellyfin-map.ts) ──
     Alle User-Endpunkte brauchen die eingeloggte User-Id. */

  /** Bibliotheks-Views (Movies/TV …). */
  async views(): Promise<BaseItemDto[]> {
    const uid = this.#requireUser();
    const r = await this.#get<ItemsResponse>(`/Users/${uid}/Views`);
    return r.Items ?? [];
  }

  /** Weiterschauen. Kann Filme UND Episoden enthalten (MediaTypes=Video) —
      der Konsument mappt je Type (mapItem/mapEpisode). */
  async resume(limit = 12): Promise<BaseItemDto[]> {
    const uid = this.#requireUser();
    const q = qs({ Limit: limit, MediaTypes: 'Video', Fields: BROWSE_FIELDS });
    const r = await this.#get<ItemsResponse>(`/Users/${uid}/Items/Resume?${q}`);
    return r.Items ?? [];
  }

  /** Zuletzt hinzugefügt (Filme + Serien). Sonderfall: nacktes Array, kein `{Items}`. */
  async latest(limit = 16): Promise<BaseItemDto[]> {
    const uid = this.#requireUser();
    const q = qs({ IncludeItemTypes: 'Movie,Series', Limit: limit, Fields: BROWSE_FIELDS });
    return this.#get<BaseItemDto[]>(`/Users/${uid}/Items/Latest?${q}`);
  }

  /** Nächste Folge — liefert Episoden-DTOs (mit SeriesId/SeriesName). */
  async nextUp(limit = 12): Promise<BaseItemDto[]> {
    const uid = this.#requireUser();
    const q = qs({ userId: uid, Limit: limit, Fields: BROWSE_FIELDS });
    const r = await this.#get<ItemsResponse>(`/Shows/NextUp?${q}`);
    return r.Items ?? [];
  }

  /** Bibliothek durchblättern (Grid): Filme oder Serien unter einem ParentId. */
  async items(query: ItemsQuery = {}): Promise<BaseItemDto[]> {
    const uid = this.#requireUser();
    const q = qs({
      ParentId: query.parentId,
      IncludeItemTypes: query.includeItemTypes,
      SortBy: query.sortBy ?? 'SortName',
      SortOrder: query.sortOrder ?? 'Ascending',
      Recursive: query.recursive ?? true,
      Limit: query.limit,
      StartIndex: query.startIndex,
      Fields: BROWSE_FIELDS,
    });
    const r = await this.#get<ItemsResponse>(`/Users/${uid}/Items?${q}`);
    return r.Items ?? [];
  }

  /** Detail eines Items (Film oder Serie). */
  async item(itemId: string): Promise<BaseItemDto> {
    const uid = this.#requireUser();
    return this.#get<BaseItemDto>(`/Users/${uid}/Items/${itemId}?${qs({ Fields: BROWSE_FIELDS })}`);
  }

  /** Staffeln einer Serie. */
  async seasons(seriesId: string): Promise<BaseItemDto[]> {
    const uid = this.#requireUser();
    const r = await this.#get<ItemsResponse>(`/Shows/${seriesId}/Seasons?${qs({ userId: uid })}`);
    return r.Items ?? [];
  }

  /** Folgen einer Staffel. */
  async episodes(seriesId: string, seasonId: string): Promise<BaseItemDto[]> {
    const uid = this.#requireUser();
    const q = qs({ seasonId, userId: uid, Fields: BROWSE_FIELDS });
    const r = await this.#get<ItemsResponse>(`/Shows/${seriesId}/Episodes?${q}`);
    return r.Items ?? [];
  }

  /* ── Artwork ──
     Reine <img>-URL (docs/08: kein JS-Roundtrip). `tag` fürs stabile Caching,
     `maxWidth`/`maxHeight` immer mitgeben (Netz + Speicher schonen). Kein Token
     in der URL — Image-Endpunkte sind ohne Auth erreichbar und bleiben so
     browser-cachebar. */
  imageUrl(itemId: string, opts: ImageQuery = {}): string {
    const q = qs({
      tag: opts.tag,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
      quality: opts.quality,
    });
    const type = opts.type ?? 'Primary';
    return `${this.#base}/Items/${itemId}/Images/${type}${q ? `?${q}` : ''}`;
  }

  /* ── Wiedergabe (Funktionsumfang 9, docs/08 „Wiedergabe") ── */

  /** PlaybackInfo: fragt für ein Item die spielbaren MediaSources ab (DirectPlay
      vs. Transcode-Entscheidung, PlaySessionId). `startPositionTicks` gibt den
      Resume-Punkt an den Server weiter. Body trägt das DeviceProfile. */
  async postPlaybackInfo(
    itemId: string,
    opts: { startPositionTicks?: number; maxStreamingBitrate?: number } = {},
  ): Promise<PlaybackInfoResponse> {
    const uid = this.#requireUser();
    const q = qs({
      userId: uid,
      StartTimeTicks: opts.startPositionTicks,
      MaxStreamingBitrate: opts.maxStreamingBitrate,
      AutoOpenLiveStream: true,
    });
    return this.#post<PlaybackInfoResponse>(`/Items/${itemId}/PlaybackInfo?${q}`, {
      DeviceProfile: buildDeviceProfile(opts.maxStreamingBitrate),
    });
  }

  /** HLS-Master-URL fürs <video>/hls.js. Anders als imageUrl trägt sie den
      Token als api_key (das <video> lädt ohne Authorization-Header). */
  streamUrl(itemId: string, selection: PlaybackSelection): string {
    return resolveStreamUrl({
      base: this.#base,
      itemId,
      selection,
      deviceId: this.#deviceId,
      token: this.#token ?? '',
    });
  }

  /** Wiedergabe-Start melden (Sessions/Playing) — Now-Playing + Resume-Anker. */
  reportStart(report: PlaybackReport): void {
    this.#report('/Sessions/Playing', report);
  }

  /** Fortschritt melden (Sessions/Playing/Progress) — ~alle 10 s + bei Pause/Seek. */
  reportProgress(report: PlaybackReport): void {
    this.#report('/Sessions/Playing/Progress', report);
  }

  /** Wiedergabe-Ende melden (Sessions/Playing/Stopped) — schreibt den finalen
      Resume-Punkt zurück, damit „Weiterschauen" geräteübergreifend stimmt. */
  reportStopped(report: PlaybackReport): void {
    this.#report('/Sessions/Playing/Stopped', report);
  }

  /* ── intern ── */

  #requireUser(): string {
    if (!this.#userId) throw new JellyfinAuthError('Keine aktive Jellyfin-Session');
    return this.#userId;
  }

  async #get<T>(path: string): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      headers: { Authorization: this.authHeader() },
    });
    if (res.status === 401) {
      // Session ungültig → verwerfen + Login anstoßen (kein Retry, kein Spinner).
      this.#clearSession();
      this.#onAuth?.();
      throw new JellyfinAuthError('Jellyfin-Session abgelaufen');
    }
    if (!res.ok) throw new Error(`Jellyfin ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** POST mit JSON-Body + Antwort (PlaybackInfo). 401-Behandlung wie #get. */
  async #post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      this.#clearSession();
      this.#onAuth?.();
      throw new JellyfinAuthError('Jellyfin-Session abgelaufen');
    }
    if (!res.ok) throw new Error(`Jellyfin ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Fire-and-forget-Report (Sessions/Playing*): best-effort wie logout — ein
      verpasster Progress darf die Wiedergabe nie stören. Antwort ist 204 ohne
      Body, wird verworfen. */
  #report(path: string, body: PlaybackReport): void {
    void this.#fetch(`${this.#base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.authHeader() },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  #clearSession(): void {
    this.#token = null;
    this.#userId = null;
    sharedStorage.removeItem(TOKEN_KEY);
    sharedStorage.removeItem(USER_KEY);
  }
}

/* ── localStorage-Kapselung (kein Zugriff in Node/Vitest — try/catch) ── */

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Quota/kein DOM: best-effort */
  }
}

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Stabile DeviceId: einmal erzeugen, persistieren, wiederverwenden. Ohne DOM
    (Node) oder ohne crypto.randomUUID trotzdem eine gültige UUID zurückgeben. */
function ensureDeviceId(): string {
  const existing = readLS(DEVICE_KEY);
  if (existing) return existing;
  const id = randomUuid();
  writeLS(DEVICE_KEY, id);
  return id;
}

function randomUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback (sehr alte Umgebungen): RFC-4122-artig aus Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Query-String aus definierten Werten (undefined/null werden übersprungen). */
function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  return p.toString();
}

/* ── Singleton (analog runtime/backend) ──
   Basis-URL: Geräte-Override (Einstellungen → Bibliothek, localStorage) vor
   Env vor Default (Mac-Ethernet aus der Heimnetz-Doku). Keine Secrets hier —
   nur der Endpunkt. Ein Override greift wie der Backend-Wechsel erst nach dem
   Neuladen (Singleton entsteht beim App-Start). */
const JELLYFIN_URL_KEY = 'hmi:jf-url';

export const JELLYFIN_URL_DEFAULT: string =
  (import.meta.env?.VITE_JELLYFIN_URL as string | undefined) ?? 'http://jellyfin.local:8096';

export const JELLYFIN_URL: string = readLS(JELLYFIN_URL_KEY) ?? JELLYFIN_URL_DEFAULT;

export const jellyfin = new JellyfinClient({ baseUrl: JELLYFIN_URL });

// Dev-Handle für den Smoke-Test im Preview-Browser:
//   window.__hmi.jellyfin.authenticateByName('sam', '…') → dann .resume()/.latest()
if (typeof window !== 'undefined') {
  const w = window as unknown as { __hmi?: Record<string, unknown> };
  w.__hmi = { ...(w.__hmi ?? {}), jellyfin };
}
