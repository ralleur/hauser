/* ── Dämmerung (Paket 4, docs/20) ──
   Tag und Nacht wechseln nicht in einem Sprung, sondern über ein Band um den
   Horizont. Maßstab ist die Sonnenhöhe aus `sun.sun`: sie läuft in
   mitteleuropäischen Breiten mit rund 0,2° pro Minute über den Horizont, ein
   Band von ±2° entspricht damit etwa zwanzig Minuten.

   Der Fortschritt ist absichtlich rein: er kennt weder Uhrzeit noch DOM und
   ist deshalb ohne Zeitgeber testbar. Fehlt die Sonnenhöhe (Demo-Backend,
   fixierter Erscheinungsmodus, alter Stand aus dem Speicher), bleibt es beim
   Hartschnitt — 1 für Tag, 0 für Nacht. */

/** Halbe Breite des Dämmerungsbandes in Grad Sonnenhöhe. */
export const DUSK_BAND_DEG = 2;

/** 1 = voller Tag, 0 = volle Nacht, dazwischen die Dämmerung. */
export function duskProgress(elevation: number | null | undefined, day: boolean): number {
  if (typeof elevation !== 'number' || !Number.isFinite(elevation)) return day ? 1 : 0;
  const progress = (elevation + DUSK_BAND_DEG) / (DUSK_BAND_DEG * 2);
  return Math.min(1, Math.max(0, progress));
}

/** Nur innerhalb des Bandes existieren zwei Bilder gleichzeitig. */
export function inDuskBand(progress: number): boolean {
  return progress > 0 && progress < 1;
}
