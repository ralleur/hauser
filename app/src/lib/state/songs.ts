/* Modell, mit dem der Server (server.mjs, SONG_LYRICS_MODEL) die Songtexte
   schreibt. Hier nur zur Anzeige in den Einstellungen — die Wahrheit liegt im
   Server; bei einer Änderung dort muss dieser Wert mitgezogen werden. */
export const SONG_LYRICS_MODEL = 'gpt-5.6-luna';

export const SONG_STYLES = [
  'Pop', 'Rock', 'Disco', 'Jazz', 'Hip-Hop', 'Metal', 'Indie', 'Britpop',
  'Electronic', 'House', 'Funk', 'Soul', 'Country', 'Reggae', 'Classical',
] as const;

export const SONG_ERAS = ['Heute', '2000er', '1990er', '1980er', '1970er', '1960er'] as const;
export const SONG_VOICES = ['Weiblich', 'Männlich', 'Duett', 'Instrumental'] as const;
export interface SongDraft {
  idea: string;
  style: typeof SONG_STYLES[number];
  era: typeof SONG_ERAS[number];
  voice: typeof SONG_VOICES[number];
  experimental: number;
}

export interface GeneratedSong {
  id: string;
  title: string;
  idea: string;
  style: string;
  era: string;
  voice: string;
  duration: number;
  audioUrl: string;
  createdAt: string;
}

export const HOME_POD_TARGETS = {
  wohnzimmer: { entityId: 'media_player.wohnzimmer_speaker', label: 'Wohnzimmer' },
  kueche: { entityId: 'media_player.kueche_speaker', label: 'Küche' },
} as const;

export type HomePodTarget = keyof typeof HOME_POD_TARGETS | 'both';

const HMI_LAN_ORIGIN = 'http://localhost:4173';
const STORAGE_KEY = 'hmi:generated-songs:v1';
const DB_NAME = 'hmi-song-library';
const DB_STORE = 'audio';
const MAX_SONGS = 12;

export function normalizeGeneratedSongs(value: unknown): GeneratedSong[] {
  if (!Array.isArray(value)) return [];
  return value.filter((song): song is GeneratedSong => Boolean(
    song && typeof song === 'object'
    && typeof song.id === 'string'
    && typeof song.title === 'string'
    && typeof song.idea === 'string'
    && typeof song.audioUrl === 'string'
    && (song.audioUrl.startsWith('/api/songs/audio?path=') || /^\/api\/songs\/library\/[0-9a-f-]{36}\/audio$/i.test(song.audioUrl))
    && typeof song.createdAt === 'string',
  ));
}

export function loadGeneratedSongs(storage: Pick<Storage, 'getItem'> = localStorage): GeneratedSong[] {
  try { return normalizeGeneratedSongs(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')).slice(0, MAX_SONGS); }
  catch { return []; }
}

export function saveGeneratedSongs(songs: GeneratedSong[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(songs.slice(0, MAX_SONGS))); }
  catch { /* Private Mode / voller Speicher: Jukebox bleibt für die Sitzung nutzbar. */ }
}

export async function fetchCentralSongs(fetcher: typeof fetch = fetch): Promise<GeneratedSong[]> {
  const response = await fetcher('/api/songs/library', { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || 'Zentrale Jukebox konnte nicht geladen werden.');
  return normalizeGeneratedSongs(payload?.songs);
}

export async function registerCentralSong(song: GeneratedSong, fetcher: typeof fetch = fetch): Promise<GeneratedSong> {
  const response = await fetcher('/api/songs/library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...song, sourceAudioUrl: song.audioUrl }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.song) throw new Error(payload?.error || 'Song konnte nicht zentral gespeichert werden.');
  return payload.song as GeneratedSong;
}

export async function deleteCentralSong(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`/api/songs/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error || 'Song konnte nicht zentral gelöscht werden.');
}

export async function renameCentralSong(id: string, title: string, fetcher: typeof fetch = fetch): Promise<GeneratedSong> {
  const response = await fetcher(`/api/songs/library/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.song) throw new Error(payload?.error || 'Song konnte nicht umbenannt werden.');
  return payload.song as GeneratedSong;
}

function openSongDb(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('Lokales Speichern wird von diesem Browser nicht unterstützt.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Lokaler Speicher konnte nicht geöffnet werden.'));
  });
}

async function readLocalBlob(id: string): Promise<Blob | null> {
  const db = await openSongDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readonly');
    const request = transaction.objectStore(DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function localSongUrl(song: GeneratedSong): Promise<string | null> {
  const blob = await readLocalBlob(song.id);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function downloadSong(song: GeneratedSong, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(song.audioUrl);
  if (!response.ok) throw new Error('Song konnte nicht auf dieses Gerät geladen werden.');
  const blob = await response.blob();
  const db = await openSongDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readwrite');
    transaction.objectStore(DB_STORE).put(blob, song.id);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
  return URL.createObjectURL(blob);
}

export async function removeLocalSong(song: GeneratedSong): Promise<void> {
  const db = await openSongDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readwrite');
    transaction.objectStore(DB_STORE).delete(song.id);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function pruneLocalSongs(songs: GeneratedSong[]): Promise<void> {
  const valid = new Set(songs.map((song) => song.id));
  const db = await openSongDb();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const stale = keys.filter((key) => !valid.has(String(key)));
  if (!stale.length) { db.close(); return; }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readwrite');
    for (const key of stale) transaction.objectStore(DB_STORE).delete(key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}

export function audioProxyUrl(file: string): string | null {
  try {
    const parsed = new URL(file, 'http://ace.local');
    if (parsed.pathname !== '/v1/audio') return null;
    const path = parsed.searchParams.get('path');
    return path ? `/api/songs/audio?path=${encodeURIComponent(path)}` : null;
  } catch { return null; }
}

export function songTitle(idea: string): string {
  const compact = idea.trim().replace(/\s+/g, ' ');
  return compact.length > 42 ? `${compact.slice(0, 39)}…` : compact;
}

export function homePodAudioUrl(audioUrl: string): string | null {
  if (!audioUrl.startsWith('/api/songs/audio?path=') && !/^\/api\/songs\/library\/[0-9a-f-]{36}\/audio$/i.test(audioUrl)) return null;
  return `${HMI_LAN_ORIGIN}${audioUrl}`;
}

export function homePodEntityIds(target: HomePodTarget): string[] {
  if (target === 'both') return Object.values(HOME_POD_TARGETS).map(({ entityId }) => entityId);
  return [HOME_POD_TARGETS[target].entityId];
}
