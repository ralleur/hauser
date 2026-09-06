/* Reaktiver Spiegel der Bewohner-Konfiguration (siehe reminder-persons.ts).
   Umbenennen und Anlegen wirken sofort auf Pinnwand, Tabelle und Standby. */
import {
  adoptHaPersons,
  createReminderPerson,
  hasStoredReminderPersons,
  loadReminderPersons,
  personLabel,
  postitColor,
  saveReminderPersons,
  type ReminderPersonConfig,
} from './reminder-persons.ts';
import { runtime } from '../adapter/runtime.svelte.ts';

export const reminderPersons = $state({ list: loadReminderPersons() });

export function rehydrateReminderPersons(): void {
  reminderPersons.list = loadReminderPersons();
}

function persist(list: ReminderPersonConfig[]): void {
  reminderPersons.list = saveReminderPersons(list);
}

/** Anzeigename einer Person-ID — unbekannte IDs bleiben lesbar. */
export function personDisplayLabel(id: string): string {
  const person = reminderPersons.list.find((entry) => entry.id === id);
  return person ? personLabel(person) : id;
}

export function personColorId(id: string): string {
  return reminderPersons.list.find((entry) => entry.id === id)?.color ?? postitColor('').id;
}

export function renameReminderPerson(id: string, label: string, color: string): void {
  const clean = label.trim().slice(0, 40);
  if (!clean) return;
  persist(reminderPersons.list.map((person) => person.id === id
    ? { ...person, label: clean, color: postitColor(color).id }
    : person));
}

/** true, wenn die Person angelegt wurde (leerer Name = keine Person). */
export function addReminderPerson(
  label: string,
  color: string,
  personEntityId: string | null = null,
): boolean {
  const person = createReminderPerson(label, color, reminderPersons.list);
  if (!person) return false;
  persist([...reminderPersons.list, { ...person, personEntityId }]);
  return true;
}

/* Zuordnung zu Home Assistant (Paket 8): eine `person.*` gehört höchstens
   einem Bewohner — sonst grüßt der Standby zwei Namen für dieselbe Person. */
export function assignReminderPersonEntity(id: string, personEntityId: string | null): void {
  persist(reminderPersons.list.map((person) => {
    if (person.id === id) return { ...person, personEntityId };
    if (personEntityId && person.personEntityId === personEntityId) {
      return { ...person, personEntityId: null };
    }
    return person;
  }));
}

/* ── Einmalige Übernahme aus Home Assistant (Paket 8) ──
   Läuft im Hintergrund nach dem Start und nur, solange der Haushalt seine
   Bewohner noch nie selbst festgelegt hat. Ohne Verbindung oder ohne
   `person.*` passiert nichts; die drei Voreinstellungen bleiben dann stehen. */
export async function adoptHaPersonsOnce(): Promise<void> {
  if (hasStoredReminderPersons()) return;
  const sources = await runtime.listPersonSources().catch(() => []);
  if (sources.length === 0) return;
  const next = adoptHaPersons(reminderPersons.list, sources);
  if (next.length === reminderPersons.list.length
    && next.every((person, index) => person.personEntityId === reminderPersons.list[index]?.personEntityId)) {
    return; // nichts zuzuordnen — dann auch nichts schreiben
  }
  persist(next);
}
