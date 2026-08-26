import { intlLocale } from './locale.svelte.ts';
import { m } from '../../paraglide/messages.js';
/* ── Uhr (tnum — kein Wackeln beim Minutenwechsel) ──
   10-s-Tick wie im Clickdummy; Status-Bar und Ambient lesen dieselben Werte.
   Safari darf Timer in inaktiven Tabs anhalten. Sichtbarkeit, Fokus und
   Page-Resume ziehen die Anzeige deshalb sofort auf die echte Zeit nach. */

const CLOCK_TICK_MS = 10_000;

function now() {
  const d = new Date();
  return {
    time: d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }),
    date: d.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }),
    hours: d.getHours(),
  };
}

export const clock = $state(now());

function refreshClock(): void {
  Object.assign(clock, now());
}

if (typeof window !== 'undefined') {
  window.setInterval(refreshClock, CLOCK_TICK_MS);
  window.addEventListener('focus', refreshClock);
  window.addEventListener('pageshow', refreshClock);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshClock();
  });
}

export function greetingForHour(h: number): string {
  if (h >= 5 && h < 11) return m.greeting_morning();
  if (h >= 11 && h < 18) return m.greeting_day();
  if (h >= 18 && h < 23) return m.greeting_evening();
  return m.greeting_night();
}
