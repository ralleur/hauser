/* ============================================
   Bibliotheks-Zustand (Schritt 8-Verdrahtung, docs/08) — der Gate zwischen
   Fake-Bibliothek (Phase 2) und echter Jellyfin-API. Analog state/auth zum
   HaBackend: im Fake-Modus bleibt alles wie gehabt (appState.library.items,
   keine Anmeldung); im Live-Modus liefert der JellyfinClient Shelves + Detail.

   Der Fortschritts-/Playback-Write-Through an Jellyfin (Sessions/Playing…,
   Funktionsumfang 9) ist NICHT hier — das ist der Wiedergabe-Schritt. Diese
   Schicht ist reiner Lese-/Browse-Pfad: Shelves + Detail-Hydration + Login.
   ============================================ */

import { m } from '../../paraglide/messages.js';
import { appState, libItem, resumeTarget, continueInfo, type LibraryItem } from './app.svelte.ts';
import { backend } from '../adapter/runtime.svelte.ts';
import { FakeBackend } from '../adapter/fake-backend.ts';
import { jellyfin, JellyfinAuthError } from '../adapter/jellyfin.ts';
import { buildLiveLibrary, type LiveShelf } from '../adapter/jellyfin-shelves.ts';
import { mapSeasons } from '../adapter/jellyfin-map.ts';

export type LibraryStatus = 'ready' | 'loading' | 'needs-login' | 'error';

/** Live nur, wenn nicht das FakeBackend läuft (gleiche Weiche wie state/auth) —
    ABER mit Dev-Override entkoppelbar: Jellyfin ist ein eigenständiges Backend
    (docs/08) und braucht das HA-Backend nicht. Der Override `hmi:library` erlaubt,
    die echte Wiedergabe zu testen, ohne HA live zu schalten (und damit ohne das
    HA-Login-Gate): `hmi:library=live` erzwingt Live-Bibliothek auch bei Fake-HA,
    `hmi:library=fake` erzwingt die Mock-Bibliothek auch bei Live-HA. Ohne Flag
    folgt die Bibliothek unverändert dem HA-Backend-Modus (Produktivverhalten). */
export const usingLiveLibrary = resolveLibraryMode();

function resolveLibraryMode(): boolean {
  try {
    const flag = localStorage.getItem('hmi:library');
    if (flag === 'live') return true;
    if (flag === 'fake') return false;
  } catch {
    /* kein DOM (Vitest/Node) → Default */
  }
  return !(backend instanceof FakeBackend);
}

interface LibraryLive {
  status: LibraryStatus;
  shelves: LiveShelf[];
  error: string | null;
  loggingIn: boolean;
  hydrating: string | null; // aktuell im Detail nachgeladene Serien-Id
}

const live: LibraryLive = $state({
  status: usingLiveLibrary ? (jellyfin.hasSession() ? 'loading' : 'needs-login') : 'ready',
  shelves: [],
  error: null,
  loggingIn: false,
  hydrating: null,
});

if (usingLiveLibrary) {
  // Session-Verlust (Token ungültig) → zurück zum Login (docs/04).
  jellyfin.onAuthError(() => { live.status = 'needs-login'; });
  if (jellyfin.hasSession()) void load();
}

/* ── Lesen ── */

export function libraryStatus(): LibraryStatus {
  return usingLiveLibrary ? live.status : 'ready';
}

export function libraryError(): string | null {
  return live.error;
}

export function isLoggingIn(): boolean {
  return live.loggingIn;
}

/** Wird gerade der Detail-Inhalt (Folgen) dieser Serie nachgeladen? */
export function isHydrating(id: string | null): boolean {
  return !!id && live.hydrating === id;
}

/** Shelves für den Screen — im Fake-Modus aus den Fake-Items abgeleitet
    (unverändertes Phase-2-Verhalten), im Live-Modus aus der API. */
export function libraryShelves(): LiveShelf[] {
  return usingLiveLibrary ? live.shelves : fakeShelves();
}

function fakeShelves(): LiveShelf[] {
  const items = appState.library.items;
  const cont = items.filter((i) => continueInfo(i)).sort((a, b) => b.cw - a.cw);
  const latest = [...items].sort((a, b) => a.added - b.added).slice(0, 6);
  const series = items.filter((i) => i.type === 'series');
  const movies = items.filter((i) => i.type === 'movie');
  return [
    { label: m.library_continue(), list: cont },
    { label: m.library_recent(), list: latest },
    { label: m.library_shelf_series({ count: series.length }), list: series },
    { label: m.library_shelf_movies({ count: movies.length }), list: movies },
  ];
}

/* ── Laden (Live) ── */

async function load(): Promise<void> {
  live.status = 'loading';
  live.error = null;
  try {
    const [resume, latest, series, movies] = await Promise.all([
      // Vollansicht darf nicht am kompakten Shelf-Limit enden. 200 hält die
      // Antwort begrenzt, deckt aber realistisch alle offenen Resume-Punkte ab.
      jellyfin.resume(200),
      jellyfin.latest(16),
      jellyfin.items({ includeItemTypes: 'Series', sortBy: 'SortName' }),
      jellyfin.items({ includeItemTypes: 'Movie', sortBy: 'SortName' }),
    ]);
    const built = buildLiveLibrary({ resume, latest, movies, series });
    appState.library.items = built.items; // Detail/Player finden Items über libItem(id)
    live.shelves = built.shelves;
    live.status = 'ready';
  } catch (err) {
    if (err instanceof JellyfinAuthError) { live.status = 'needs-login'; return; }
    live.error = 'Bibliothek konnte nicht geladen werden';
    live.status = 'error';
    console.warn('[library] Laden fehlgeschlagen:', err);
  }
}

export function retryLoad(): void {
  if (usingLiveLibrary && jellyfin.hasSession()) void load();
}

/* ── Login ── */

export async function jellyfinLogin(username: string, password: string): Promise<void> {
  if (!usingLiveLibrary) return;
  live.loggingIn = true;
  live.error = null;
  try {
    await jellyfin.authenticateByName(username, password);
    await load();
  } catch (err) {
    live.error = err instanceof JellyfinAuthError
      ? 'Benutzername oder Passwort falsch'
      : 'Anmeldung fehlgeschlagen — Server erreichbar?';
    live.status = 'needs-login';
  } finally {
    live.loggingIn = false;
  }
}

/* ── Detail-Hydration (Live) ──
   Die Shelf-Items einer Serie tragen vorab keine bzw. nur Resume-Staffeln. Beim
   Öffnen des Details laden wir die echten Staffeln + Folgen nach und ersetzen
   die seasons; die Staffel-Vorauswahl folgt dem Resume-Ziel. Idempotent —
   die LibraryDetailScreen triggert es reaktiv über die aktuelle Id. */
export async function hydrateDetail(id: string | null): Promise<void> {
  if (!usingLiveLibrary || !id) return;
  const item = libItem(id);
  if (!item || item.type !== 'series') return;
  live.hydrating = id;
  try {
    const seasonDtos = await jellyfin.seasons(id);
    const episodesBySeasonId: Record<string, Awaited<ReturnType<typeof jellyfin.episodes>>> = {};
    await Promise.all(
      seasonDtos.map(async (s) => { episodesBySeasonId[s.Id] = await jellyfin.episodes(id, s.Id); }),
    );
    item.seasons = mapSeasons(seasonDtos, episodesBySeasonId);
    appState.library.season = resumeTarget(item).season ?? item.seasons[0]?.n ?? 1;
  } catch (err) {
    console.warn('[library] Detail-Hydration fehlgeschlagen:', err);
  } finally {
    live.hydrating = null;
  }
}

export type { LibraryItem };
