/* ============================================
   Versteckte Gesten (Paket 10, docs/20)
   --------------------------------------------
   Zwei Griffe ohne Menüeintrag, dokumentiert nur im Komponentenkatalog:
     • Uhr lange drücken  → Sekunden und Datum groß, Loslassen beendet.
     • Logo dreimal tippen → Diagnoseansicht.
   Hier lebt nur der Zustand; beide Ansichten werden erst bei Bedarf geladen,
   damit der Startpfad unberührt bleibt.
   ============================================ */

export const clockZoom = $state({ active: false });
export const diagnostics = $state({ active: false });

const TAP_WINDOW_MS = 800;
const LOGO_TAPS = 3;

let taps: number[] = [];

export function logoTap(): void {
  const now = Date.now();
  taps = taps.filter((at) => now - at < TAP_WINDOW_MS);
  taps.push(now);
  if (taps.length < LOGO_TAPS) return;
  taps = [];
  diagnostics.active = !diagnostics.active;
}

export function showClockZoom(): void {
  clockZoom.active = true;
}

export function hideClockZoom(): void {
  clockZoom.active = false;
}

if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === '1') {
  diagnostics.active = true;
}
