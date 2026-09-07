import { m } from '../../paraglide/messages.js';
/* Kuratierte Farb-Swatches für die Licht-Detail-Ebene (Hauser-Tick-Ästhetik).
   Die Hex-Werte sind DATEN — real emittierte Lichtfarben, kein Theme —, daher
   bewusst konkrete Werte (außerhalb der „keine Hex"-Token-Regel, die für
   neutrale Flächen/Ränder/Text gilt). Der Name trägt die a11y-Beschriftung. */
export interface ColorSwatch { name: string; hex: string }

export const LIGHT_COLOR_SWATCHES: readonly ColorSwatch[] = [
  { get name() { return m.light_color_red(); }, hex: '#ff4d4d' },
  { get name() { return m.light_color_orange(); }, hex: '#ff8c31' },
  { get name() { return m.light_color_amber(); }, hex: '#ffb300' },
  { get name() { return m.light_color_green(); }, hex: '#57d06a' },
  { get name() { return m.light_color_turquoise(); }, hex: '#33c7c0' },
  { get name() { return m.light_color_blue(); }, hex: '#4a90e2' },
  { get name() { return m.light_color_indigo(); }, hex: '#6a5cff' },
  { get name() { return m.light_color_violet(); }, hex: '#b06cff' },
  { get name() { return m.light_color_pink(); }, hex: '#ff5db1' },
];

/* Tick-Farbe der Farbtemperatur-Skala: Positionsanteil 0 (warm) → 1 (kühl).
   Interpoliert in CSS zwischen den Verlauf-Tokens, damit es dem Theme folgt. */
export function tempTint(pf: number): string {
  const cool = Math.round(pf * 100);
  return `color-mix(in srgb, var(--light-temp-cool) ${cool}%, var(--light-temp-warm))`;
}

/* Tick-Farbe der Zieltemperatur-Skala (temp-Overlay): Positionsanteil
   0 (16 °C, kühl/blau) → 1 (26 °C, warm/rot) — Farbcodierung wie das
   Klima-Dock (blau = kälter, rot = wärmer). */
export function climateTint(pf: number): string {
  const warm = Math.round(pf * 100);
  return `color-mix(in srgb, var(--color-error) ${warm}%, var(--color-accent-cool))`;
}

/* Symbolfarbe einer dimmbaren Lampe: die Helligkeit soll am Piktogramm
   ablesbar sein, nicht nur an der Zahl. Der Anteil läuft von 0,35 (kleinste
   Stufe — noch klar „an") bis 1 (volle Stufe). `null` = keine Stufe im Spiel
   (aus, nicht dimmbar oder noch kein Wert), dann bleibt alles wie bisher. */
export function lightLevel(brightness: number | undefined, on: boolean, dimmable: boolean): string | null {
  if (!on || !dimmable || typeof brightness !== 'number') return null;
  const pct = Math.max(0, Math.min(100, brightness));
  return (0.35 + (pct / 100) * 0.65).toFixed(3);
}
