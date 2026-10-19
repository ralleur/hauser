/* Dev-HUD für Hardware-Smoke-Tests (?debug=1 oder 3× Tap auf die Uhr) —
   zeigt Viewport/dpr (ADR-010) und fps (144-Hz-Check).

   Dieselbe Stelle trägt eine zweite versteckte Geste: fünfmal tippen öffnet den
   Werkstatt-Simulator (Dämmerung und Nachdimmen von Hand durchfahren). Der
   dritte Tap schaltet dabei wie gewohnt das HUD um; der fünfte nimmt das
   zurück und öffnet stattdessen den Simulator. So bleibt die alte Geste
   unverzögert — ein Abwarten, ob noch Tipper folgen, würde sie träge machen. */

export const hud = $state({ active: false });
export const simulator = $state({ active: false });

/* Abstand zwischen zwei Tipps, nicht Dauer der ganzen Reihe: fünf Tipps in
   zusammen 800 ms gelangen mit der Maus kaum, der beworbene Simulator blieb
   zu (Postfach, Cpt.Hardy 2026-10-06). */
const TAP_GAP_MS = 600;
const HUD_TAPS = 3;
const SIMULATOR_TAPS = 5;

let taps: number[] = [];

export function hudClockTap() {
  const now = Date.now();
  if (taps.length && now - taps[taps.length - 1] >= TAP_GAP_MS) taps = [];
  taps.push(now);
  if (taps.length === HUD_TAPS) hud.active = !hud.active;
  if (taps.length >= SIMULATOR_TAPS) {
    taps = [];
    hud.active = !hud.active;
    simulator.active = !simulator.active;
  }
}

if (new URLSearchParams(location.search).get('debug')) hud.active = true;
if (new URLSearchParams(location.search).get('sim')) simulator.active = true;
