/* ============================================
   Bewohner der Erinnerungs-Pinnwand — pures Datenmodell + Persistenz.
   Die drei Voreinstellungen (Alex, Sam, Beide) bleiben als Startpunkt,
   sind aber frei umbenennbar; weitere Personen kommen über den Notizen-Screen
   dazu. Die Farbe eines Zettels kommt aus einer festen Palette, damit Papier,
   Schrift und Nebentext zueinander passen.
   ============================================ */

import { m } from '../../paraglide/messages.js';
import { PERSON_LABELS, type ReminderPerson } from './reminders.ts';
import { sharedStorage } from './shared-config.ts';

export interface PostitColor {
  id: string;
  paper: string;
  ink: string;
  muted: string;
}

export interface ReminderPersonConfig {
  id: ReminderPerson;
  /* null = Voreinstellung verwenden (bei „beide" die übersetzte Bezeichnung). */
  label: string | null;
  color: string;
}

export const REMINDER_PERSONS_KEY = 'hmi:reminder-persons:v1';

/* Die ersten drei Einträge sind exakt die bisherigen Post-it-Farben. */
export const POSTIT_COLORS: readonly PostitColor[] = [
  { id: 'gelb', paper: '#fde68a', ink: '#3f3406', muted: '#7a6712' },
  { id: 'gruen', paper: '#bce29e', ink: '#263d10', muted: '#567433' },
  { id: 'gelbgruen', paper: '#dde579', ink: '#383b0a', muted: '#6f7420' },
  { id: 'blau', paper: '#bfdbfe', ink: '#10294f', muted: '#3c5f96' },
  { id: 'rosa', paper: '#fbcfe8', ink: '#4a1030', muted: '#8b3f68' },
  { id: 'orange', paper: '#fed7aa', ink: '#452209', muted: '#8a5322' },
  { id: 'flieder', paper: '#ddd6fe', ink: '#291552', muted: '#5f4b9b' },
  { id: 'grau', paper: '#e2e8f0', ink: '#1f2937', muted: '#556172' },
];

export const DEFAULT_REMINDER_PERSONS: readonly ReminderPersonConfig[] = [
  { id: 'alex', label: null, color: 'gruen' },
  { id: 'sam', label: null, color: 'gelb' },
  { id: 'beide', label: null, color: 'gelbgruen' },
];

export function postitColor(id: string): PostitColor {
  return POSTIT_COLORS.find((color) => color.id === id) ?? POSTIT_COLORS[0];
}

/** Inline-Custom-Properties eines Zettels — dieselben Namen wie .postit-*. */
export function postitStyle(colorId: string): string {
  const color = postitColor(colorId);
  return `--postit-paper:${color.paper};--postit-ink:${color.ink};--postit-muted:${color.muted}`;
}

export function personLabel(person: ReminderPersonConfig): string {
  if (person.label) return person.label;
  if (person.id === 'beide') return m.reminders_person_both();
  return PERSON_LABELS[person.id] ?? person.id;
}

export function slugifyPerson(label: string): string {
  return label.trim().toLocaleLowerCase('de-DE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalize(raw: unknown): ReminderPersonConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_REMINDER_PERSONS.map((person) => ({ ...person }));
  const seen = new Set<string>();
  const persons = raw.flatMap((entry): ReminderPersonConfig[] => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Partial<ReminderPersonConfig>;
    const id = typeof candidate.id === 'string' ? slugifyPerson(candidate.id) : '';
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const label = typeof candidate.label === 'string' && candidate.label.trim()
      ? candidate.label.trim().slice(0, 40)
      : null;
    const color = typeof candidate.color === 'string' && POSTIT_COLORS.some((entry) => entry.id === candidate.color)
      ? candidate.color
      : POSTIT_COLORS[0].id;
    return [{ id, label, color }];
  });
  return persons.length ? persons : DEFAULT_REMINDER_PERSONS.map((person) => ({ ...person }));
}

export function loadReminderPersons(): ReminderPersonConfig[] {
  try { return normalize(JSON.parse(sharedStorage.getItem(REMINDER_PERSONS_KEY) ?? 'null')); }
  catch { return DEFAULT_REMINDER_PERSONS.map((person) => ({ ...person })); }
}

export function saveReminderPersons(persons: readonly ReminderPersonConfig[]): ReminderPersonConfig[] {
  const normalized = normalize(persons);
  try { sharedStorage.setItem(REMINDER_PERSONS_KEY, JSON.stringify(normalized)); }
  catch { /* Storage blockiert/voll: best-effort */ }
  return normalized;
}

/** Neue Person aus einem Anzeigenamen; null bei leerem oder belegtem Namen. */
export function createReminderPerson(
  label: string,
  color: string,
  existing: readonly ReminderPersonConfig[],
): ReminderPersonConfig | null {
  const clean = label.trim().slice(0, 40);
  const base = slugifyPerson(clean);
  if (!clean || !base) return null;
  let id = base;
  let suffix = 2;
  const ids = new Set(existing.map((person) => person.id));
  while (ids.has(id)) id = `${base}-${suffix++}`;
  return { id, label: clean, color: postitColor(color).id };
}
