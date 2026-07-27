import { runtime } from '../adapter/runtime.svelte.ts';
import {
  calendarWindow,
  selectCalendars,
  type CalendarEvent,
  type CalendarSource,
} from './calendar.ts';
import { connection } from './connection.svelte.ts';
import { sharedStorage } from './shared-config.ts';

const CACHE_KEY = 'hmi:calendar-familie-cache';
const SELECTION_KEY = 'hmi:calendar-selected';
const REFRESH_MS = 5 * 60 * 1000;

interface CalendarCache {
  sources: CalendarSource[];
  events: CalendarEvent[];
  updatedAt: number;
}

export const familyCalendar = $state({
  sources: [] as CalendarSource[],
  events: [] as CalendarEvent[],
  updatedAt: 0,
  loading: false,
  error: null as string | null,
  initialized: false,
});

/* Alle Kalender-Entitäten des Backends — für die Auswahl in den Einstellungen.
   Wird beim Öffnen der Kalender-Sektion frisch geladen. */
export const availableCalendars = $state({
  sources: [] as CalendarSource[],
  loading: false,
  loaded: false,
});

let refreshPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function initFamilyCalendar(): void {
  if (familyCalendar.initialized) return;
  familyCalendar.initialized = true;
  restoreCache();
  void refreshFamilyCalendar();
  refreshTimer = setInterval(() => void refreshFamilyCalendar(), REFRESH_MS);
}

export async function refreshFamilyCalendar(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/* ── Kalender-Auswahl (Einstellungen): null = Automatik („Familie") ── */

export function selectedCalendarIds(): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null') as unknown;
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : null;
  } catch { return null; }
}

export function setSelectedCalendarIds(ids: readonly string[] | null): void {
  try {
    if (ids === null) sharedStorage.removeItem(SELECTION_KEY);
    else sharedStorage.setItem(SELECTION_KEY, JSON.stringify(ids));
  } catch { /* best-effort */ }
  void refreshFamilyCalendar();
}

export async function loadAvailableCalendars(): Promise<void> {
  availableCalendars.loading = true;
  try {
    availableCalendars.sources = await runtime.listCalendarSources();
    availableCalendars.loaded = true;
  } catch { /* Backend nicht verbunden: Liste bleibt leer. */ }
  availableCalendars.loading = false;
}

async function refresh(): Promise<void> {
  familyCalendar.loading = true;
  try {
    const selectedIds = selectedCalendarIds();
    const allSources = await runtime.listCalendarSources();
    if (
      !allSources.length
      && connection().status !== 'connected'
      && selectedIds?.length !== 0
      && familyCalendar.sources.length
    ) {
      familyCalendar.error = 'Kalender konnte offline nicht aktualisiert werden.';
      return;
    }
    const sources = selectCalendars(allSources, selectedIds);
    if (!sources.length) {
      familyCalendar.sources = [];
      familyCalendar.events = [];
      familyCalendar.error = null;
      clearCache();
      return;
    }
    const { start, end } = calendarWindow();
    /* Ein Abruf pro Kalender; jeder Termin trägt die Farbe seiner Quelle.
       Gemeinsam sortiert — die Projektionen (Agenda/Ambient) sortieren zwar
       selbst, aber der Cache soll deterministisch sein. */
    const perSource = await Promise.all(sources.map(async (source) => {
      const events = await runtime.getCalendarEvents(source.entityId, start, end);
      return events.map((event) => ({ ...event, id: `${source.entityId}:${event.id}`, color: source.color ?? null }));
    }));
    familyCalendar.sources = sources;
    familyCalendar.events = perSource.flat()
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    familyCalendar.updatedAt = Date.now();
    familyCalendar.error = null;
    saveCache();
  } catch (error) {
    familyCalendar.error = error instanceof Error ? error.message : 'Kalender konnte nicht aktualisiert werden.';
  } finally {
    familyCalendar.loading = false;
  }
}

function restoreCache(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as CalendarCache | null;
    // Alte Cache-Form (einzelnes `source`-Feld) fällt hier durch und wird beim
    // nächsten erfolgreichen Refresh überschrieben.
    if (!Array.isArray(parsed?.sources) || !Array.isArray(parsed.events) || !Number.isFinite(parsed.updatedAt)) return;
    familyCalendar.sources = parsed.sources;
    familyCalendar.events = parsed.events;
    familyCalendar.updatedAt = parsed.updatedAt;
  } catch { /* Cache ist best-effort. */ }
}

function saveCache(): void {
  if (typeof localStorage === 'undefined' || !familyCalendar.sources.length) return;
  try {
    const value: CalendarCache = {
      sources: familyCalendar.sources,
      events: familyCalendar.events,
      updatedAt: familyCalendar.updatedAt,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch { /* Storage blockiert/voll: Live-Daten funktionieren weiter. */ }
}

function clearCache(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}
