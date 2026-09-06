/* ============================================
   Präsenz und Person (Paket 8, docs/20) — reine Logik
   --------------------------------------------
   Zwei Fragen beantwortet dieses Modul, beide allein aus `person.*`:
     • Ist niemand mehr zuhause? Dann darf das Panel ganz dunkel werden.
     • Wer ist als Erster nach Hause gekommen? Dem gilt die Begrüßung.

   Der Auslöser bleibt bei Home Assistant — hier wird nur gelesen und
   verglichen. Keine Runes, damit die Fälle testbar bleiben.
   ============================================ */

export interface PersonPresence {
  entityId: string;
  home: boolean;
}

/** Wer wann heimgekommen ist — Grundlage der persönlichen Begrüßung. */
export interface Arrival {
  entityId: string;
  at: number;
}

/** Solange gilt eine Begrüßung; danach ist das Heimkommen kein Ereignis mehr. */
export const GREETING_TTL_MS = 30 * 60 * 1000;

export function homeIds(states: readonly PersonPresence[]): string[] {
  return states.filter((person) => person.home).map((person) => person.entityId);
}

/** true nur, wenn überhaupt jemand zugeordnet ist und niemand davon zuhause. */
export function everyoneAway(states: readonly PersonPresence[]): boolean {
  return states.length > 0 && states.every((person) => !person.home);
}

/* Begrüßt wird, wer ein leeres Haus wieder füllt: der Übergang von „niemand
   da" auf „jemand da". Wer dazukommt, während schon jemand zuhause ist, löst
   nichts aus — die Zeile gilt dem Heimkommen, nicht der Anwesenheit. */
export function nextArrival(
  previousHome: readonly string[],
  currentHome: readonly string[],
  previous: Arrival | null,
  now: number,
  ttlMs: number = GREETING_TTL_MS,
): Arrival | null {
  const arrived = currentHome.filter((id) => !previousHome.includes(id));
  if (previousHome.length === 0 && arrived.length > 0) {
    return { entityId: arrived[0], at: now };
  }
  if (previous && now - previous.at < ttlMs && currentHome.includes(previous.entityId)) {
    return previous;
  }
  return null;
}
