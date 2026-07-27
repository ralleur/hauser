/* Dev-HUD für Hardware-Smoke-Tests (?debug=1 oder 3× Tap auf die Uhr) —
   zeigt Viewport/dpr (ADR-010) und fps (144-Hz-Check). */

export const hud = $state({ active: false });

let taps: number[] = [];

export function hudClockTap() {
  const now = Date.now();
  taps = taps.filter((t) => now - t < 800);
  taps.push(now);
  if (taps.length >= 3) {
    taps = [];
    hud.active = !hud.active;
  }
}

if (new URLSearchParams(location.search).get('debug')) hud.active = true;
