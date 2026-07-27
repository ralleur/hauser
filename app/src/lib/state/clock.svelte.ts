import { intlLocale } from './locale.svelte.ts';
import { m } from '../../paraglide/messages.js';
/* ── Uhr (tnum — kein Wackeln beim Minutenwechsel) ──
   10-s-Tick wie im Clickdummy; Status-Bar und Ambient lesen dieselben Werte. */

function now() {
  const d = new Date();
  return {
    time: d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }),
    date: d.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }),
    hours: d.getHours(),
  };
}

export const clock = $state(now());

setInterval(() => {
  Object.assign(clock, now());
}, 10_000);

export function greetingForHour(h: number): string {
  if (h >= 5 && h < 11) return m.greeting_morning();
  if (h >= 11 && h < 18) return m.greeting_day();
  if (h >= 18 && h < 23) return m.greeting_evening();
  return m.greeting_night();
}
