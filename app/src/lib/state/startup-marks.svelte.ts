/* ============================================
   B-27 E1: Warm-Resume-Metrik.

   docs/03 fordert seit Langem „Warm Resume <500 ms bis reagierend", ohne dass
   irgendetwas es misst. Die bestehenden `hmi:`-Marken enden bei `hmi:interactive`
   (die Oberfläche reagiert auf Eingaben) und `hmi:ha-connected` (der Socket
   steht) — beides sagt noch nicht, ab wann ein Tap auf eine Kachel wirklich
   schaltet. Genau das ist hier die Marke: `connection().online === true`, also
   der Moment, ab dem `runtime.dispatch()` einen Command nicht mehr verwirft
   (docs/02).

   Bewusst nicht DEV-only, anders als die Marken in main.ts: gemessen werden
   soll die installierte PWA auf dem Gerät, nicht der Devserver. Die Kosten sind
   zwei `performance.mark`-Aufrufe.
   ============================================ */

const APP_START = 'hmi:app-start';
export const OPERABLE_MARK = 'hmi:operable';
export const RESUME_MARK = 'hmi:resume';
export const RESUME_OPERABLE_MARK = 'hmi:resume-operable';

function marks(): Performance | null {
  return typeof performance !== 'undefined' && typeof performance.mark === 'function'
    ? performance
    : null;
}

function has(api: Performance, name: string): boolean {
  return api.getEntriesByName(name, 'mark').length > 0;
}

function report(api: Performance, from: string, to: string, label: string): void {
  if (!has(api, from)) return;
  try { api.measure(`${from}->${to}`, from, to); } catch { /* Marke fehlt: nichts zu messen */ }
  if (!import.meta.env.DEV) return;
  const duration = api.getEntriesByName(`${from}->${to}`, 'measure').at(-1)?.duration;
  if (duration !== undefined) console.debug(`[startup] ${label}: ${duration.toFixed(1)} ms`);
}

/**
 * Erste bedienbare Kontrolle nach dem Kaltstart. Genau einmal pro Dokument —
 * spätere Verbindungswechsel sind Reconnects, kein Start.
 */
export function markOperable(): void {
  const api = marks();
  if (!api || has(api, OPERABLE_MARK)) return;
  api.mark(OPERABLE_MARK);
  report(api, APP_START, OPERABLE_MARK, 'Erste bedienbare Kontrolle');
}

/**
 * Beginn eines Resumes. Jedes Sichtbarwerden öffnet ein neues Messfenster,
 * deshalb werden die Marken des vorherigen verworfen.
 */
export function markResumeStart(): void {
  const api = marks();
  if (!api) return;
  api.clearMarks(RESUME_MARK);
  api.clearMarks(RESUME_OPERABLE_MARK);
  api.clearMeasures(`${RESUME_MARK}->${RESUME_OPERABLE_MARK}`);
  api.mark(RESUME_MARK);
}

/** Wieder bedienbar nach einem Resume — der Wert, den docs/03 begrenzt. */
export function markResumeOperable(): void {
  const api = marks();
  if (!api || !has(api, RESUME_MARK) || has(api, RESUME_OPERABLE_MARK)) return;
  api.mark(RESUME_OPERABLE_MARK);
  report(api, RESUME_MARK, RESUME_OPERABLE_MARK, 'Warm Resume bis bedienbar');
}
