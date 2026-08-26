/* Reaktiver Spiegel der Bewohner-Konfiguration (siehe reminder-persons.ts).
   Umbenennen und Anlegen wirken sofort auf Pinnwand, Tabelle und Standby. */
import {
  createReminderPerson,
  loadReminderPersons,
  personLabel,
  postitColor,
  saveReminderPersons,
  type ReminderPersonConfig,
} from './reminder-persons.ts';

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
export function addReminderPerson(label: string, color: string): boolean {
  const person = createReminderPerson(label, color, reminderPersons.list);
  if (!person) return false;
  persist([...reminderPersons.list, person]);
  return true;
}
