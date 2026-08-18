import { m } from '../../paraglide/messages.js';
import { intlLocale } from './locale.svelte.ts';
import type { CalendarEvent } from './calendar.ts';

export interface PhoneAgendaEvent {
  id: string;
  renderKey: string;
  title: string;
  time: string;
  location: string | null;
  running: boolean;
  multiDay: boolean;
  span: string | null;
}

export interface PhoneAgendaDay {
  key: string;
  label: string;
  today: boolean;
  events: PhoneAgendaEvent[];
}

const dayKeyFormatter = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric', month: '2-digit', day: '2-digit',
});
/* Wochentag, Monat und Uhrzeit folgen der Oberfläche. Die Formatierer dürfen
   deshalb nicht beim Import einfrieren — ein Sprachwechsel ohne Neuladen muss
   durchschlagen. Gecacht wird je Sprache, damit die Projektion sie nicht pro
   Termin neu baut. `dayKeyFormatter` bleibt bewusst bei sv-SE: das ist ein
   sortierbarer Schlüssel, keine Anzeige. */
interface AgendaFormatters {
  dayLabel: Intl.DateTimeFormat;
  spanDate: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
}

const formatterCache = new Map<string, AgendaFormatters>();

function agendaFormatters(): AgendaFormatters {
  const tag = intlLocale();
  const cached = formatterCache.get(tag);
  if (cached) return cached;
  const built: AgendaFormatters = {
    dayLabel: new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long' }),
    spanDate: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long' }),
    time: new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }),
  };
  formatterCache.set(tag, built);
  return built;
}

export function projectPhoneAgenda(
  events: readonly CalendarEvent[] | null | undefined,
  now = new Date(),
): PhoneAgendaDay[] {
  const todayKey = localDayKey(now);
  const projected = (events ?? [])
    .map((item, index) => projectEvent(item, index, now, todayKey))
    .filter((item): item is ProjectedEvent => item !== null)
    .sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.start.getTime() - b.start.getTime());

  const days = new Map<string, PhoneAgendaDay>();
  for (const item of projected) {
    const day = days.get(item.groupKey) ?? {
      key: item.groupKey,
      label: agendaFormatters().dayLabel.format(item.groupDate),
      today: item.groupKey === todayKey,
      events: [],
    };
    day.events.push(item.event);
    days.set(item.groupKey, day);
  }
  return [...days.values()];
}

interface ProjectedEvent {
  groupKey: string;
  groupDate: Date;
  start: Date;
  event: PhoneAgendaEvent;
}

function projectEvent(item: CalendarEvent, index: number, now: Date, todayKey: string): ProjectedEvent | null {
  const start = new Date(item.start);
  const end = new Date(item.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end <= now) return null;

  const running = start <= now;
  const groupDate = running ? startOfLocalDay(now) : startOfLocalDay(start);
  const groupKey = running ? todayKey : localDayKey(start);
  const lastDate = item.allDay ? new Date(end.getTime() - 1) : end;
  const multiDay = localDayKey(start) !== localDayKey(lastDate);

  return {
    groupKey,
    groupDate,
    start,
    event: {
      id: item.id,
      renderKey: `${item.id}\u001f${item.start}\u001f${item.end}\u001f${index}`,
      title: item.title,
      time: item.allDay
        ? m.phone_all_day()
        : `${agendaFormatters().time.format(start)}–${agendaFormatters().time.format(end)}`,
      location: item.location,
      running,
      multiDay,
      span: multiDay
        ? `${agendaFormatters().spanDate.format(start)}–${agendaFormatters().spanDate.format(lastDate)}`
        : null,
    },
  };
}

function localDayKey(date: Date): string {
  return dayKeyFormatter.format(date);
}

function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
