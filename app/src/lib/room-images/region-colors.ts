/* Eine feste Farbe je erkannter Art (Paket 13). Zwei Ansichten zeigen dieselben
   Flächen — die Diagnose als Liste aller Bildsets, der Simulator direkt über
   dem Raumbild. Beide greifen hier zu, damit ein Fenster nicht in der einen
   Ansicht blau und in der anderen grün ist.

   Die Artnamen bleiben englische Schlüssel: das ist das Vokabular des
   Katalogs, kein Produkttext. */

export const REGION_COLOR: Readonly<Record<string, string>> = Object.freeze({
  window: '#4e9cd0',
  floor: '#a0713a',
  seating: '#f5b03c',
  table: '#6fcf97',
  desk: '#bb6bd9',
  bed: '#eb5757',
  tv: '#2d9cdb',
  mirror: '#56ccf2',
  bath: '#00b8a9',
  appliance: '#f2994a',
  bin: '#828282',
  solar: '#1f3a93',
  toy: '#ff7ac8',
});

/** Farbe einer Art; unbekannte Arten bekommen ein neutrales Grau. */
export function regionColor(kind: string): string {
  return REGION_COLOR[kind] ?? '#9aa7b4';
}
