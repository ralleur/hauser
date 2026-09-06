/* ── „Der Assistent arbeitet" (Paket 13) ──

   Ein Bildset entsteht in Minuten, im Hintergrund, ohne offenes Fenster. Damit
   das Haus nicht stumm wirkt, dreht sich in der Kopfzeile das Zeichen und
   daneben steht knapp, was gerade läuft.

   Bewusst ein eigenes, winziges Modul: Die Kopfzeile liegt im Startpfad und
   soll dafür nicht den ganzen Wächter mitziehen. Gefüttert wird es von zwei
   Seiten — vom Assistenten, der den Auftrag startet und es sofort weiß, und
   vom Wächter, der es nach einem Neuladen wiederfindet. */

export type RoomImageStage = 'set' | 'regions';

export const roomImageActivity = $state({
  /** `null` heißt: gerade entsteht nichts. */
  stage: null as RoomImageStage | null,
});

export function setRoomImageStage(stage: RoomImageStage | null): void {
  roomImageActivity.stage = stage;
}
