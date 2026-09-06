/* Kalendermomente im Browser: laden, zeigen, wegtippen.

   Was ein Moment ist, entscheidet der Server (`/api/moments`). Hier steht nur,
   welchen Moment dieses Gerät heute schon gesehen und welchen es weggetippt
   hat — beides bleibt lokal, damit Panel und Telefon sich nicht gegenseitig
   die Freude wegklicken. */
import { apiRequest } from '../api/client.ts';
import type { DayMoment, MomentsResponse } from '../api/types.ts';
import { localDayKey } from './calendar.ts';

const DISMISSED_KEY = 'hmi:moment-dismissed-v1';
const CELEBRATED_KEY = 'hmi:moment-celebrated-v1';
const REFRESH_MS = 30 * 60 * 1000;
/* Konfetti gehört in den Morgen; wer mittags nach Hause kommt, bekommt die
   Zeile im Standby, aber keine Party mehr. */
const CELEBRATION_UNTIL_HOUR = 12;

export const moments = $state({
  day: '',
  items: [] as DayMoment[],
  dismissed: [] as string[],
  loaded: false,
});

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function readDayList(key: string, day: string): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = JSON.parse(store.getItem(key) ?? 'null') as { day?: string; ids?: unknown } | null;
    if (raw?.day !== day || !Array.isArray(raw.ids)) return [];
    return raw.ids.filter((id): id is string => typeof id === 'string');
  } catch { return []; }
}

function writeDayList(key: string, day: string, ids: string[]): void {
  const store = storage();
  if (!store) return;
  try { store.setItem(key, JSON.stringify({ day, ids })); } catch { /* privater Modus: dann eben flüchtig */ }
}

export async function loadMoments(): Promise<void> {
  const result = await apiRequest<'moments', MomentsResponse>('moments');
  if (!result.ok || !Array.isArray(result.data?.moments)) return;
  moments.day = result.data.day;
  moments.items = result.data.moments;
  moments.dismissed = readDayList(DISMISSED_KEY, result.data.day);
  moments.loaded = true;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function initMoments(): void {
  if (refreshTimer !== null) return;
  void loadMoments();
  refreshTimer = setInterval(() => { void loadMoments(); }, REFRESH_MS);
}

/** Der Moment, den dieses Gerät heute noch sehen soll — oder `null`. */
export function currentMoment(): DayMoment | null {
  if (moments.day !== localDayKey(new Date())) return null;
  return moments.items.find((moment) => !moments.dismissed.includes(moment.id)) ?? null;
}

export function dismissMoment(id: string): void {
  if (moments.dismissed.includes(id)) return;
  moments.dismissed = [...moments.dismissed, id];
  writeDayList(DISMISSED_KEY, moments.day, moments.dismissed);
}

/** Einmal am Morgen, einmal pro Gerät: danach bleibt es bei der Textzeile. */
export function celebrationDue(now = new Date()): boolean {
  const moment = currentMoment();
  if (!moment || now.getHours() >= CELEBRATION_UNTIL_HOUR) return false;
  return !readDayList(CELEBRATED_KEY, moments.day).includes(moment.id);
}

export function markCelebrated(id: string): void {
  const seen = readDayList(CELEBRATED_KEY, moments.day);
  if (seen.includes(id)) return;
  writeDayList(CELEBRATED_KEY, moments.day, [...seen, id]);
}
