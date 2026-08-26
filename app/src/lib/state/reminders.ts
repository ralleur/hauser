/* ============================================
   iCloud-Erinnerungen (Apple Reminders) — pures Datenmodell + Projektionen.
   In Home Assistant erscheinen Erinnerungslisten desselben CalDAV/iCloud-Kontos
   (B-10) als `todo.*`-Entitäten; einzelne Einträge liest der offizielle
   WS-Befehl `todo/item/list`. Analog zu calendar.ts: hier nur reine Logik
   (Auswahl, Filter, Formatierung), der reaktive Zustand lebt in
   reminders.svelte.ts.
   ============================================ */

import { m } from '../../paraglide/messages.js';

export interface ReminderSource {
  entityId: string; // todo.*
  name: string;
  color?: string | null;
}

export interface Reminder {
  id: string;
  title: string;
  /* Fälligkeit: ISO-Zeitpunkt, reines Datum `YYYY-MM-DD` (ganztägig) oder null
     (ohne Termin). HA liefert bei CalDAV-VTODO beides. */
  due: string | null;
  completed: boolean;
  description: string | null;
  /* Farbe der Quell-Liste — beim Merge angeheftet, tönt später das Post-it. */
  color?: string | null;
  /* HMI-Zeitstempel (ISO): Erstellung und letzte Bearbeitung. HA-Quellen
     liefern beides nicht. */
  created?: string | null;
  edited?: string | null;
}

export function reminderListMessage(entityId: string) {
  return { type: 'todo/item/list' as const, entity_id: entityId };
}

/* Listen-Auswahl (Einstellungen → Kalender → Erinnerungen). Erinnerungen sind
   Opt-in: ohne gespeicherte Auswahl (null) wird keine Liste angezeigt — die
   Post-its sollen bewusst aktiviert werden, nicht ungefragt erscheinen. Eine
   gespeicherte Auswahl filtert auf existierende Entitäten; verschwundene Listen
   fallen still weg. */
export function selectReminderLists(
  sources: readonly ReminderSource[],
  selectedIds: readonly string[] | null,
): ReminderSource[] {
  if (!selectedIds) return [];
  const wanted = new Set(selectedIds);
  return sources.filter((source) => wanted.has(source.entityId));
}

/* Offene Erinnerungen für die Anzeige: erledigte fallen weg, sortiert nach
   Fälligkeit (ohne Termin ans Ende), gleichauf alphabetisch nach Titel. */
export function openReminders(reminders: readonly Reminder[]): Reminder[] {
  return reminders
    .filter((item) => !item.completed)
    .sort((a, b) => {
      const da = a.due ? new Date(a.due).getTime() : Infinity;
      const db = b.due ? new Date(b.due).getTime() : Infinity;
      if (da !== db) return da - db;
      return a.title.localeCompare(b.title, 'de-DE');
    });
}

/* Überfällig = Fälligkeit liegt vor jetzt. Reine Datumsangaben (ganztägig)
   gelten bis zum Ende ihres Tages als nicht überfällig. */
export function reminderOverdue(item: Reminder, now = new Date()): boolean {
  if (!item.due) return false;
  const deadline = reminderDeadline(item.due);
  return deadline.getTime() < now.getTime();
}

/* ── Personen-Zuordnung: die Familie präfixt Aufgaben mit „Alex - …" /
   „Sam - …" (die HMI legt neue Aufgaben genauso an, „Beide - …" für
   gemeinsame). Alles ohne Personen-Präfix gilt als gemeinsam. Die Person
   bestimmt die Post-it-Farbe: Sam gelb, Alex grün, Beide gelbgrün. ── */
export type ReminderPerson = 'alex' | 'sam' | 'beide';

export const PERSON_ORDER: readonly ReminderPerson[] = ['alex', 'sam', 'beide'];
export const PERSON_LABELS: Readonly<Record<ReminderPerson, string>> = {
  alex: 'Alex',
  sam: 'Sam',
  beide: 'Beide',
};

/* PERSON_LABELS ist das Präfix im gespeicherten Titel und bleibt deshalb
   unverändert. Für die Anzeige sind die Vornamen Eigennamen, „Beide" dagegen
   ein normales Wort — nur das wird übersetzt. */
export function personDisplayLabel(person: ReminderPerson): string {
  return person === 'beide' ? m.reminders_person_both() : PERSON_LABELS[person];
}

const PERSON_PREFIX = /^(alex|sam|beide)\s*[-–:]\s*/i;

export function reminderPerson(title: string): ReminderPerson {
  const match = PERSON_PREFIX.exec(title.trim());
  const name = match?.[1].toLowerCase();
  return name === 'alex' || name === 'sam' ? name : 'beide';
}

/* Anzeige-Titel ohne Personen-Präfix — Farbe bzw. Sektions-Überschrift
   übernehmen die Zuordnung. */
export function reminderDisplayTitle(title: string): string {
  return title.trim().replace(PERSON_PREFIX, '') || title.trim();
}

/* ── Post-it-Reihe der Notizen-Seite: pro Person EINE horizontal scrollbare
   Zeile. Links die offenen Zettel nach Alter (älteste zuerst — was am längsten
   wartet, steht vorn), rechts daran die erledigten, ausgegraut, nach
   Erledigungszeitpunkt (frisch Erledigtes direkt neben den offenen). ── */
export interface ReminderRow {
  open: Reminder[];
  done: Reminder[];
}

const DONE_ROW_MAX = 12;

function timeOf(value: string | null | undefined): number {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : NaN;
}

export function reminderRowsByPerson(
  items: readonly Reminder[],
  doneMax = DONE_ROW_MAX,
): Record<ReminderPerson, ReminderRow> {
  const rows: Record<ReminderPerson, ReminderRow> = {
    alex: { open: [], done: [] },
    sam: { open: [], done: [] },
    beide: { open: [], done: [] },
  };
  for (const item of items) {
    const row = rows[reminderPerson(item.title)];
    (item.completed ? row.done : row.open).push(item);
  }
  for (const row of Object.values(rows)) {
    /* Offen: ältester Zettel zuerst; ohne created-Stempel (HA) ans Ende. */
    row.open.sort((a, b) => {
      const ta = timeOf(a.created), tb = timeOf(b.created);
      const da = Number.isNaN(ta) ? Infinity : ta;
      const db = Number.isNaN(tb) ? Infinity : tb;
      if (da !== db) return da - db;
      return a.title.localeCompare(b.title, 'de-DE');
    });
    /* Erledigt: zuletzt erledigte zuerst, gedeckelt — die Reihe ist ein
       kurzes Gedächtnis, kein Archiv. */
    row.done.sort((a, b) => {
      const ta = timeOf(a.edited), tb = timeOf(b.edited);
      const da = Number.isNaN(ta) ? -Infinity : ta;
      const db = Number.isNaN(tb) ? -Infinity : tb;
      if (da !== db) return db - da;
      return a.title.localeCompare(b.title, 'de-DE');
    });
    row.done = row.done.slice(0, doneMax);
  }
  return rows;
}

/* ── Projektion für die Post-its auf dem Standby-Screen ──
   Offene Erinnerungen, gedeckelt auf wenige Zettel (der Rest zählt als „+N"),
   jeweils mit einem knappen Fälligkeits-Label. */
export interface Postit {
  id: string;
  title: string;
  person: ReminderPerson;
  personLabel: string;
  color: string | null;
  dueLabel: string | null;
  overdue: boolean;
}

const POSTIT_MAX = 4;

const postitTimeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const postitWeekdayFormatter = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const postitDateFormatter = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });

export function projectPostits(
  items: readonly Reminder[],
  now = new Date(),
  max = POSTIT_MAX,
): { items: Postit[]; more: number } {
  const open = openReminders(items).filter((item) => {
    if (!item.id.startsWith('hmi:family-reminders:') || !item.due) return true;
    return new Date(`${item.due}T00:00:00`).getTime() <= startOfDay(now).getTime();
  });
  const shown = open.slice(0, max).map((item) => {
    const person = reminderPerson(item.title);
    return {
      id: item.id,
      title: reminderDisplayTitle(item.title),
      person,
      personLabel: personDisplayLabel(person),
      color: item.color ?? null,
      dueLabel: postitDueLabel(item, now),
      overdue: reminderOverdue(item, now),
    };
  });
  return { items: shown, more: Math.max(0, open.length - shown.length) };
}

/* Knappes Fälligkeits-Label: „Überfällig" schlägt alles; heute mit Uhrzeit die
   Zeit, sonst „Heute"/„Morgen"; die kommende Woche der Wochentag; darüber hinaus
   ein kurzes Datum. Ohne Termin: kein Label. */
export function postitDueLabel(item: Reminder, now = new Date()): string | null {
  if (!item.due) return null;
  if (reminderOverdue(item, now)) return 'Überfällig';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(item.due);
  const due = new Date(item.due);
  const diffDays = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY_MS);
  if (diffDays <= 0) return dateOnly ? 'Heute' : postitTimeFormatter.format(due);
  if (diffDays === 1) return 'Morgen';
  if (diffDays < 7) return postitWeekdayFormatter.format(due).replace(/\./g, '');
  return postitDateFormatter.format(due).replace(/\./g, '');
}

const DAY_MS = 24 * 60 * 60 * 1000;

function reminderDeadline(due: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(due);
  return dateOnly ? new Date(new Date(due).setHours(23, 59, 59, 999)) : new Date(due);
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
