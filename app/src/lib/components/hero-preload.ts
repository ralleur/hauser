/* ── Nachbarräume vorladen (Paket 5, docs/20) ──

   Wer eine Raumkachel antippt, wechselt als Nächstes meist in den Raum daneben
   — auf dem Panel per Wisch, auf dem Telefon über die nächste Kachel. Beim
   Antippen holt der Decode-Worker deshalb die Hero-Bilder der beiden Nachbarn;
   der Wechsel findet sie dann im Cache. Fehler sind bedeutungslos: es bleibt
   beim normalen Laden im Moment des Wechsels. */

import { decodeHeroImageOffThread } from './hero-image-decoder.ts';
import type { RoomHeroResolution } from './room-hero-assets.ts';

/** Die Räume links und rechts vom gewählten — in Anzeigereihenfolge. */
export function neighbourRoomIds(rooms: readonly string[], roomId: string): string[] {
  const index = rooms.indexOf(roomId);
  if (index < 0) return [];
  return [rooms[index - 1], rooms[index + 1]].filter((id): id is string => typeof id === 'string');
}

/** Lädt je Auflösung den Kandidaten, der beim Wechsel als Erster gezeigt würde. */
export function preloadHeroes(
  resolutions: Iterable<RoomHeroResolution | Promise<RoomHeroResolution>>,
): void {
  for (const pending of resolutions) {
    void Promise.resolve(pending).then((resolution) => {
      const candidate = resolution.userCandidate ?? resolution.projectFallback;
      if (candidate) return decodeHeroImageOffThread(candidate.url);
    }).catch(() => { /* Vorladen ist best-effort. */ });
  }
}
