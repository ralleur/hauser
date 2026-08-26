import { m } from '../../paraglide/messages.js';
import { intlLocale } from './locale.svelte.ts';

export interface CalendarSource {
  entityId: string;
  name: string;
  color?: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  /* Farbe des Quell-Kalenders — von calendar.svelte.ts beim Merge mehrerer
     Kalender angeheftet, damit die Agenda pro Termin den Ursprung zeigt. */
  color?: string | null;
}

export interface AgendaDay {
  key: string;
  label: string;
  today: boolean;
  events: CalendarEvent[];
}

export function calendarEventsMessage(entityId: string, start: Date, end: Date) {
  return {
    type: 'call_service' as const,
    domain: 'calendar',
    service: 'get_events',
    target: { entity_id: entityId },
    service_data: {
      start_date_time: start.toISOString(),
      end_date_time: end.toISOString(),
    },
    return_response: true,
  };
}

export interface AmbientWeekEvent {
  id: string;
  time: string;
  title: string;
  emphasis: 'now' | 'next' | null;
}

export interface AmbientWeekDay {
  key: string;
  weekday: string;
  dayOfMonth: number;
  events: AmbientWeekEvent[];
  more: number;
}

export interface AmbientTodayItem {
  id: string;
  time: string | null;
  title: string;
  now: boolean;
}

export interface CalendarDayEvent {
  id: string;
  time: string | null; // null = ganztägig
  title: string;
  allDay: boolean;
  now: boolean;
  isNext: boolean;
  color: string | null;
}

export interface CalendarMonthDay {
  key: string;
  dayOfMonth: number;
  monthShort: string | null; // gesetzt am Monatsersten — orientiert im Raster
  isToday: boolean;
  isPast: boolean;
  events: CalendarDayEvent[];
  more: number;
}

/* Ein mehrtägiger Termin, auf eine einzelne Woche zugeschnitten: ein Balken, der
   über `span` Spalten ab `startCol` (0 = Mo) läuft. Über Wochengrenzen hinweg
   zerfällt der Termin in mehrere Segmente; `continuesLeft/Right` steuern die
   abgeflachten Kanten. `lane` stapelt überlappende Balken untereinander. */
export interface CalendarBarSegment {
  id: string;
  title: string;
  color: string | null;
  lane: number;
  startCol: number; // 0–6
  span: number; // 1–7
  continuesLeft: boolean;
  continuesRight: boolean;
  now: boolean;
  isPast: boolean;
}

export interface CalendarMonthWeek {
  key: string; // Montags-Tageskey
  monthKey: string; // Repräsentativmonat (Do der Woche) für die Kopfzeile
  monthLabel: string;
  isCurrent: boolean; // enthält heute
  days: CalendarMonthDay[];
  bars: CalendarBarSegment[]; // mehrtägige Termine als gespannte Balken
  laneCount: number; // belegte Balken-Reihen — die Tagestermine beginnen darunter
}

const dayKeyFormatter = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit',
});
/* Datum und Uhrzeit folgen der Oberflächensprache (ADR-021). Die Formatter
   werden je Sprache einmal gebaut und behalten — `new Intl.DateTimeFormat` pro
   Aufruf wäre im Wochenraster teuer. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = intlLocale();
  const cacheKey = `${locale}|${key}`;
  let cached = formatters.get(cacheKey);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    formatters.set(cacheKey, cached);
  }
  return cached;
}

const dayLabelFormatter = () => formatter('dayLabel', { weekday: 'long', day: 'numeric', month: 'long' });
const weekdayFormatter = () => formatter('weekday', { weekday: 'short' });
const timeFormatter = () => formatter('time', { hour: '2-digit', minute: '2-digit' });
const monthHeadingFormatter = () => formatter('monthHeading', { month: 'long', year: 'numeric' });
const monthShortFormatter = () => formatter('monthShort', { month: 'short' });

/* Wochentagskürzel Mo–So (Woche beginnt montags) — einmal aus dem Formatter
   abgeleitet, damit die Kalender-Kopfzeile und die Projektion dieselbe
   Schreibweise teilen. Als Funktion, weil die Sprache zur Laufzeit wechselt. */
export function weekdayLabels(): readonly string[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const day = startOfWeek(new Date(2026, 0, 5)); // 5. Jan 2026 ist ein Montag
    day.setDate(day.getDate() + offset);
    return weekdayFormatter().format(day).replace('.', '');
  });
}

export function selectFamilyCalendar(sources: readonly CalendarSource[]): CalendarSource | null {
  return sources.find((source) => source.name.trim().toLocaleLowerCase('de-DE') === 'familie') ?? null;
}

/* Kalender-Auswahl (Einstellungen → Kalender): `null` = Automatik — der
   Kalender namens „Familie" (bisheriges Verhalten). Eine gespeicherte Auswahl
   filtert auf existierende Entitäten; verschwundene Kalender fallen still
   weg, statt die Anzeige zu brechen. */
export function selectCalendars(
  sources: readonly CalendarSource[],
  selectedIds: readonly string[] | null,
): CalendarSource[] {
  if (selectedIds === null) {
    const family = selectFamilyCalendar(sources);
    return family ? [family] : [];
  }
  const wanted = new Set(selectedIds);
  return sources.filter((source) => wanted.has(source.entityId));
}

/* Scroll-Fenster des Kalender-Screens: ganze Wochen (montags beginnend) einige
   Wochen in die Vergangenheit und weiter in die Zukunft — genug, damit man sich
   im Monatsraster auf und ab bewegen kann. Deckt zugleich das 7-Tage-Fenster der
   Ambient-Projektionen ab, die selbst filtern. */
export const CALENDAR_PAST_WEEKS = 8;
export const CALENDAR_FUTURE_WEEKS = 20;
const CALENDAR_DAY_EVENTS_MAX = 3;

export function calendarWindow(now = new Date()): { start: Date; end: Date } {
  const start = startOfWeek(now);
  start.setDate(start.getDate() - CALENDAR_PAST_WEEKS * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + (CALENDAR_PAST_WEEKS + 1 + CALENDAR_FUTURE_WEEKS) * 7);
  return { start, end };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/* Abgedeckte Kalendertage eines Termins. Das Ende ist exklusiv (HA-Konvention:
   ein Ganztagestermin „10.–12." endet am 13. um 00:00), darum zählt der letzte
   berührte Tag über `end − 1 ms`. dayCount ≥ 2 heißt mehrtägig → Balken. */
function eventDaySpan(item: CalendarEvent): { startDay: Date; lastDay: Date; dayCount: number } {
  const startDay = startOfLocalDay(eventStart(item));
  const lastMoment = new Date(Math.max(eventEnd(item).getTime() - 1, eventStart(item).getTime()));
  const lastDay = startOfLocalDay(lastMoment);
  const dayCount = Math.round((lastDay.getTime() - startDay.getTime()) / DAY_MS) + 1;
  return { startDay, lastDay, dayCount };
}

/* Wochenraster für den Kalender-Screen: eine Zeile je Woche (Mo–So). Eintägige
   Termine hängen im Stil des Ambient-Wochenbands unter ihrem Tag; mehrtägige
   laufen als Balken über ihren Zeitraum und brechen an der Wochengrenze um. Der
   Repräsentativmonat einer Woche ist der Monat ihres Donnerstags (ISO) — daran
   hängt die mitscrollende Monats-Überschrift. */
export function projectCalendarWeeks(
  events: readonly CalendarEvent[],
  now = new Date(),
): CalendarMonthWeek[] {
  const first = startOfWeek(now);
  first.setDate(first.getDate() - CALENDAR_PAST_WEEKS * 7);
  const totalWeeks = CALENDAR_PAST_WEEKS + 1 + CALENDAR_FUTURE_WEEKS;
  const today = startOfLocalDay(now);
  const todayKey = localDayKey(now);

  /* Eintägige Termine nach Tag bündeln; mehrtägige separat als Balkenquellen. */
  const byDay = new Map<string, CalendarEvent[]>();
  const spanning: { item: CalendarEvent; startDay: Date; lastDay: Date }[] = [];
  for (const item of events) {
    const { startDay, lastDay, dayCount } = eventDaySpan(item);
    if (dayCount >= 2) spanning.push({ item, startDay, lastDay });
    else {
      const bucket = byDay.get(localDayKey(startDay)) ?? [];
      bucket.push(item);
      byDay.set(localDayKey(startDay), bucket);
    }
  }

  const running = events.some((item) => eventIsRunning(item, now));
  const nextId = running ? null : [...events]
    .filter((item) => eventStart(item) > now)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())[0]?.id ?? null;

  return Array.from({ length: totalWeeks }, (_, weekIndex) => {
    const weekStart = new Date(first);
    weekStart.setDate(first.getDate() + weekIndex * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6); // Sonntag (inklusiv)

    const days: CalendarMonthDay[] = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + dayIndex);
      const key = localDayKey(date);
      const dayEvents = (byDay.get(key) ?? [])
        .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
      const shown = dayEvents.slice(0, CALENDAR_DAY_EVENTS_MAX);
      return {
        key,
        dayOfMonth: date.getDate(),
        monthShort: date.getDate() === 1 ? monthShortFormatter().format(date).replace('.', '') : null,
        isToday: key === todayKey,
        isPast: key < todayKey,
        events: shown.map((item) => ({
          id: item.id,
          time: item.allDay ? null : timeFormatter().format(eventStart(item)),
          title: item.title,
          allDay: item.allDay,
          now: eventIsRunning(item, now),
          isNext: item.id === nextId,
          color: item.color ?? null,
        })),
        more: Math.max(0, dayEvents.length - shown.length),
      };
    });

    /* Balken dieser Woche: jeden mehrtägigen Termin auf [Mo, So] zuschneiden. */
    const clipped = spanning
      .filter(({ startDay, lastDay }) => startDay <= weekEnd && lastDay >= weekStart)
      .map(({ item, startDay, lastDay }) => {
        const segStart = startDay < weekStart ? weekStart : startDay;
        const segEnd = lastDay > weekEnd ? weekEnd : lastDay;
        return {
          item,
          startCol: Math.round((segStart.getTime() - weekStart.getTime()) / DAY_MS),
          span: Math.round((segEnd.getTime() - segStart.getTime()) / DAY_MS) + 1,
          continuesLeft: startDay < weekStart,
          continuesRight: lastDay > weekEnd,
          isPast: lastDay < today,
        };
      })
      .sort((a, b) => a.startCol - b.startCol || b.span - a.span);

    /* Lane-Zuweisung: niedrigste freie Reihe, in der sich der Balken nicht mit
       einem bereits platzierten überschneidet. laneEnds[l] = erste freie Spalte. */
    const laneEnds: number[] = [];
    const bars: CalendarBarSegment[] = clipped.map((seg) => {
      let lane = laneEnds.findIndex((end) => end <= seg.startCol);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = seg.startCol + seg.span;
      return {
        id: seg.item.id,
        title: seg.item.title,
        color: seg.item.color ?? null,
        lane,
        startCol: seg.startCol,
        span: seg.span,
        continuesLeft: seg.continuesLeft,
        continuesRight: seg.continuesRight,
        now: eventIsRunning(seg.item, now),
        isPast: seg.isPast,
      };
    });

    const thursday = new Date(weekStart);
    thursday.setDate(weekStart.getDate() + 3);
    return {
      key: days[0].key,
      monthKey: `${thursday.getFullYear()}-${thursday.getMonth()}`,
      monthLabel: monthHeadingFormatter().format(thursday),
      isCurrent: days.some((day) => day.isToday),
      days,
      bars,
      laneCount: laneEnds.length,
    };
  });
}

export function groupAgendaDays(events: readonly CalendarEvent[], now = new Date()): AgendaDay[] {
  const today = localDayKey(now);
  const groups = new Map<string, CalendarEvent[]>();
  for (const item of [...events].sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())) {
    const key = localDayKey(eventStart(item));
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: dayLabelFormatter().format(eventStart(items[0])),
    today: key === today,
    events: items,
  }));
}

export function formatAgendaTime(item: CalendarEvent): string {
  if (item.allDay) return m.calendar_all_day();
  return `${timeFormatter().format(eventStart(item))}–${timeFormatter().format(eventEnd(item))}`;
}

const AMBIENT_WEEK_DAYS = 7;
const AMBIENT_WEEK_EVENTS_PER_DAY = 2;
const AMBIENT_TODAY_MAX = 3;

/* Hero-Zeile des Ambient-Screens: die heutigen Termine ersetzen die
   Tagesbegrüßung. Vergangenes fällt weg; laufende Termine — auch mehrtägige
   Ganztages-Einträge mit Start vor heute — stehen vorn und tragen „Jetzt". */
export function projectAmbientToday(
  events: readonly CalendarEvent[],
  now = new Date(),
): { items: AmbientTodayItem[]; more: number } {
  const today = localDayKey(now);
  const todays = [...events]
    .filter((item) => eventEnd(item) > now)
    .filter((item) => {
      const start = eventStart(item);
      return localDayKey(start <= now ? now : start) === today;
    })
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  const items = todays.slice(0, AMBIENT_TODAY_MAX).map((item) => ({
    id: item.id,
    time: item.allDay ? null : timeFormatter().format(eventStart(item)),
    title: item.title,
    now: eventIsRunning(item, now),
  }));
  return { items, more: Math.max(0, todays.length - items.length) };
}

/* Wochenband des Ambient-Screens: 6 Spalten ab morgen — heute lebt in der
   Hero-Zeile (projectAmbientToday). Genau ein Termin trägt die Betonung:
   der nächste anstehende der Woche, sofern heute nichts läuft oder ansteht. */
export function projectAmbientWeek(
  events: readonly CalendarEvent[],
  now = new Date(),
): AmbientWeekDay[] {
  const upcoming = [...events]
    .filter((item) => eventEnd(item) > now)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime());
  const nextId = upcoming.some((item) => eventIsRunning(item, now))
    ? null
    : upcoming.find((item) => eventStart(item) > now)?.id ?? null;

  const windowStart = startOfLocalDay(now);
  return Array.from({ length: AMBIENT_WEEK_DAYS }, (_, offset) => {
    const day = new Date(windowStart);
    day.setDate(day.getDate() + offset);
    const key = localDayKey(day);
    const dayEvents = upcoming.filter((item) => localDayKey(eventStart(item)) === key);
    return {
      key,
      weekday: weekdayFormatter().format(day).replace('.', ''),
      dayOfMonth: day.getDate(),
      events: dayEvents.slice(0, AMBIENT_WEEK_EVENTS_PER_DAY).map((item) => ({
        id: item.id,
        time: item.allDay ? m.calendar_all_day() : timeFormatter().format(eventStart(item)),
        title: item.title,
        emphasis: item.id === nextId ? 'next' as const : null,
      })),
      more: Math.max(0, dayEvents.length - AMBIENT_WEEK_EVENTS_PER_DAY),
    };
  });
}

export function eventIsRunning(item: CalendarEvent, now = new Date()): boolean {
  return eventStart(item) <= now && eventEnd(item) > now;
}

export function eventIsNext(item: CalendarEvent, events: readonly CalendarEvent[], now = new Date()): boolean {
  if (events.some((candidate) => eventIsRunning(candidate, now))) return false;
  return [...events]
    .filter((candidate) => eventStart(candidate) > now)
    .sort((a, b) => eventStart(a).getTime() - eventStart(b).getTime())[0]?.id === item.id;
}

function eventStart(item: CalendarEvent): Date { return new Date(item.start); }
function eventEnd(item: CalendarEvent): Date { return new Date(item.end); }
export function localDayKey(date: Date): string { return dayKeyFormatter.format(date); }
function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
function startOfWeek(date: Date): Date {
  const result = startOfLocalDay(date);
  const offset = (result.getDay() + 6) % 7; // Mo=0 … So=6
  result.setDate(result.getDate() - offset);
  return result;
}
