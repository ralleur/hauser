import { runtime } from '../adapter/runtime.svelte.ts';
import {
  calendarWindow,
  selectCalendars,
  type CalendarEvent,
  type CalendarSource,
} from './calendar.ts';
import { connection } from './connection.svelte.ts';
import { sharedStorage } from './shared-config.ts';
import { createSnapshotStore } from '../data/query-cache.ts';
import { registerRevalidation } from '../data/revalidation.ts';

const CACHE_KEY = 'hmi:calendar-familie-cache';
const SELECTION_KEY = 'hmi:calendar-selected';
const REFRESH_MS = 5 * 60 * 1000;

interface CalendarSnapshot {
  sources: CalendarSource[];
  events: CalendarEvent[];
}

function isCalendarSnapshot(value: unknown): value is CalendarSnapshot {
  const candidate = value as Partial<CalendarSnapshot> | null;
  return Array.isArray(candidate?.sources) && Array.isArray(candidate?.events);
}

const snapshot = createSnapshotStore<CalendarSnapshot>({
  key: CACHE_KEY,
  maxAgeMs: REFRESH_MS,
  validate: isCalendarSnapshot,
  migrateLegacy: (raw) => {
    const legacy = raw as (CalendarSnapshot & { updatedAt?: number }) | null;
    return isCalendarSnapshot(legacy) && Number.isFinite(legacy.updatedAt)
      ? { v: 1, updatedAt: legacy.updatedAt as number, value: { sources: legacy.sources, events: legacy.events } }
      : null;
  },
});

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
  registerRevalidation({ name: 'calendar', isStale: () => snapshot.isStale(), revalidate: refreshFamilyCalendar });
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
  const restored = snapshot.restoreSync();
  if (!restored) return;
  familyCalendar.sources = restored.value.sources;
  familyCalendar.events = restored.value.events;
  familyCalendar.updatedAt = restored.updatedAt;
}

function saveCache(): void {
  if (!familyCalendar.sources.length) return;
  void snapshot.save({ sources: familyCalendar.sources, events: familyCalendar.events }, familyCalendar.updatedAt);
}

function clearCache(): void {
  void snapshot.clear();
}
