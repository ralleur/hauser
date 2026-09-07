/* ============================================
   Papierfarbe eines Kalenders (R5, docs/23) — der Kalender ist dieselbe Seite
   wie die Pinnwand: ein Termin trägt die Zettelfarbe seines Bewohners, nicht
   die Farbe, die Home Assistant der Quelle gegeben hat. Wessen Kalender zu
   keinem Bewohner gehört, bekommt eine feste Farbe aus dem Namen — gleiche
   Quelle, gleiche Farbe, über Neustarts hinweg.
   ============================================ */

import { POSTIT_COLORS, slugifyPerson, type ReminderPersonConfig } from './reminder-persons.ts';

function stableIndex(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 100_000;
  return hash % POSTIT_COLORS.length;
}

/** Palette-ID (nicht Hex) — die Oberfläche setzt daraus Papier, Tinte und Nebenton. */
export function calendarPaperColorId(
  sourceName: string,
  persons: readonly ReminderPersonConfig[] = [],
): string {
  const slug = slugifyPerson(sourceName);
  if (slug) {
    const person = persons.find((entry) => entry.id === slug
      || (entry.label ? slugifyPerson(entry.label) === slug : false));
    if (person) return person.color;
  }
  return POSTIT_COLORS[stableIndex(sourceName)].id;
}

/* Fünf Kalender, drei Gelbgrüntöne: Der Namenshash allein ließ am Panel alles
   gleich aussehen (R17). Jede Quelle behält ihren Startpunkt aus dem Namen,
   rückt aber auf die nächste freie Farbe, wenn eine Person oder eine früher
   sortierte Quelle sie schon trägt. Sortiert nach Entität, damit das Ergebnis
   über Neustarts hinweg gleich bleibt. */
export function calendarPaperColors(
  sources: ReadonlyArray<{ entityId: string; name: string }>,
  persons: readonly ReminderPersonConfig[] = [],
): Map<string, string> {
  const taken = new Set(persons.map((person) => person.color));
  const result = new Map<string, string>();
  const ordered = [...sources].sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
  for (const source of ordered) {
    const slug = slugifyPerson(source.name);
    const person = slug ? persons.find((entry) => entry.id === slug
      || (entry.label ? slugifyPerson(entry.label) === slug : false)) : undefined;
    if (person) { result.set(source.entityId, person.color); continue; }
    const start = stableIndex(source.name);
    let pick = POSTIT_COLORS[start].id;
    for (let step = 0; step < POSTIT_COLORS.length; step++) {
      const candidate = POSTIT_COLORS[(start + step) % POSTIT_COLORS.length].id;
      if (!taken.has(candidate)) { pick = candidate; break; }
    }
    taken.add(pick);
    result.set(source.entityId, pick);
  }
  return result;
}
