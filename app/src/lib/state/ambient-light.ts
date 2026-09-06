/* ============================================
   Umgebungslicht (Paket 9) — reine Umrechnung
   --------------------------------------------
   Aus Lux wird eine Deckkraft: der dunkle Schleier über der Oberfläche.
   Zwei Tokens spannen den Bereich auf, dazwischen ist es stufenlos.
   ============================================ */

/** Ab hier gilt der Raum als dunkel — voller Schleier. */
export const DARK_LUX = 8;
/** Ab hier gilt der Raum als hell — kein Schleier. */
export const BRIGHT_LUX = 220;

/** Lux → Deckkraft des Schleiers (0 = ungedimmt, `max` = so dunkel wie erlaubt).
    Unbekannte Messwerte lassen die Oberfläche unangetastet. */
export function dimFromLux(lux: number | null, max: number): number {
  if (typeof lux !== 'number' || !Number.isFinite(lux) || lux < 0) return 0;
  if (lux >= BRIGHT_LUX) return 0;
  if (lux <= DARK_LUX) return max;
  /* Logarithmisch, weil das Auge Helligkeit so wahrnimmt — linear würde die
     halbe Skala im ersten Dämmerungsmoment verbraucht. */
  const span = Math.log(BRIGHT_LUX) - Math.log(DARK_LUX);
  const position = (Math.log(lux) - Math.log(DARK_LUX)) / span;
  return Math.round(max * (1 - position) * 1000) / 1000;
}

/** Träges Nachziehen: ein einzelner Wolkenschatten soll die Wand nicht
    umschalten. Der neue Wert zieht anteilig nach. */
export function smoothDim(previous: number, next: number, weight = 0.25): number {
  return Math.round((previous + (next - previous) * weight) * 1000) / 1000;
}
