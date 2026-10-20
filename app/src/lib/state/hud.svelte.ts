/* Dev-HUD für Hardware-Smoke-Tests (?debug=1) — zeigt Viewport/dpr (ADR-010)
   und fps (144-Hz-Check).

   Fünfmal auf die Uhr tippen öffnet den Werkstatt-Simulator (Dämmerung und
   Nachdimmen von Hand durchfahren). Früher schaltete schon der dritte Tipp das
   HUD: wer gemächlich tippte, blieb dort hängen und sah ein unerklärtes Fenster
   unten links statt des Simulators (simon42, Cpt.Hardy, 2026-10-19). Das HUD
   gibt es deshalb nur noch über ?debug=1. */

export const hud = $state({ active: false });
export const simulator = $state({ active: false });

/* Abstand zwischen zwei Tipps, nicht Dauer der ganzen Reihe: mit der Maus
   gelingen fünf Klicks im Abstand unter 0,6 s nicht zuverlässig (Postfach und
   simon42, Cpt.Hardy 2026-10-06 und 2026-10-19). */
const TAP_GAP_MS = 1000;
const SIMULATOR_TAPS = 5;

let taps: number[] = [];

export function hudClockTap() {
  const now = Date.now();
  if (taps.length && now - taps[taps.length - 1] >= TAP_GAP_MS) taps = [];
  taps.push(now);
  if (taps.length >= SIMULATOR_TAPS) {
    taps = [];
    simulator.active = !simulator.active;
  }
}

if (new URLSearchParams(location.search).get('debug')) hud.active = true;
if (new URLSearchParams(location.search).get('sim')) simulator.active = true;
