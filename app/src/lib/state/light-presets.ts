/* Kuratierte Farb-Swatches für die Licht-Detail-Ebene (Hauser-Tick-Ästhetik).
   Die Hex-Werte sind DATEN — real emittierte Lichtfarben, kein Theme —, daher
   bewusst konkrete Werte (außerhalb der „keine Hex"-Token-Regel, die für
   neutrale Flächen/Ränder/Text gilt). Der Name trägt die a11y-Beschriftung. */
export interface ColorSwatch { name: string; hex: string }

export const LIGHT_COLOR_SWATCHES: readonly ColorSwatch[] = [
  { name: 'Rot', hex: '#ff4d4d' },
  { name: 'Orange', hex: '#ff8c31' },
  { name: 'Bernstein', hex: '#ffb300' },
  { name: 'Grün', hex: '#57d06a' },
  { name: 'Türkis', hex: '#33c7c0' },
  { name: 'Blau', hex: '#4a90e2' },
  { name: 'Indigo', hex: '#6a5cff' },
  { name: 'Violett', hex: '#b06cff' },
  { name: 'Pink', hex: '#ff5db1' },
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
