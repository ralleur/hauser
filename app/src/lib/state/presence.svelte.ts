/* ============================================
   Präsenz und Person (Paket 8) — reaktiver Teil
   --------------------------------------------
   Fragt die zugeordneten `person.*` in Ruhe ab (alle 30 s) und hält daraus
   zwei Aussagen bereit: ist niemand mehr zuhause, und wem gilt gerade die
   Begrüßung. Läuft nur, solange eine der beiden Funktionen eingeschaltet ist
   — ohne Zuordnung passiert gar nichts.
   ============================================ */

import { runtime } from '../adapter/runtime.svelte.ts';
import type { PersonValue } from '../adapter/types.ts';
import { reminderPersons } from './reminder-persons.svelte.ts';
import { everyoneAway, homeIds, nextArrival, type Arrival, type PersonPresence } from './presence.ts';

export const PRESENCE_POLL_MS = 30_000;

export const presence = $state<{ persons: PersonPresence[]; arrival: Arrival | null }>({
  persons: [],
  arrival: null,
});

let watchers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lastHome: string[] = [];

/** Zuordnung Bewohner → `person.*` aus den Erinnerungs-Einstellungen. */
export function assignedPersonEntityIds(): string[] {
  return [...new Set(reminderPersons.list
    .map((person) => person.personEntityId)
    .filter((entityId): entityId is string => !!entityId))];
}

export function everyoneOut(): boolean {
  return everyoneAway(presence.persons);
}

/** Bewohner-Id (nicht die Entity-Id) der aktuellen Begrüßung, sonst null. */
export function greetedPersonId(): string | null {
  const entityId = presence.arrival?.entityId;
  if (!entityId) return null;
  return reminderPersons.list.find((person) => person.personEntityId === entityId)?.id ?? null;
}

async function poll(): Promise<void> {
  const ids = assignedPersonEntityIds();
  if (ids.length === 0) {
    presence.persons = [];
    presence.arrival = null;
    lastHome = [];
    return;
  }
  const states = await runtime.readStates(ids).catch(() => ({} as Record<string, unknown>));
  const persons = ids
    .filter((entityId) => entityId in states)
    .map((entityId) => ({ entityId, home: (states[entityId] as PersonValue).home === true }));
  if (persons.length === 0) return; // nichts gelesen — den letzten Stand behalten
  presence.persons = persons;
  const current = homeIds(persons);
  presence.arrival = nextArrival(lastHome, current, presence.arrival, Date.now());
  lastHome = current;
}

/** Startet die Abfrage; der Rückgabewert beendet sie wieder (Effekt-Cleanup). */
export function watchPresence(): () => void {
  watchers += 1;
  if (!timer) {
    void poll();
    timer = setInterval(() => void poll(), PRESENCE_POLL_MS);
  }
  return () => {
    watchers -= 1;
    if (watchers > 0 || !timer) return;
    clearInterval(timer);
    timer = undefined;
  };
}
