/* ── Hero-Parallax beim Blättern der Raumauswahl (Paket 4, docs/20) ──
   Die Raumkacheln liegen auf einer horizontal schnappenden Fläche. Während der
   Finger zwischen zwei Seiten steht, folgt das Hero-Bild ein kleines Stück in
   die Gegenrichtung. Bewusst winzig und ausschließlich `transform`: die Ebene
   darunter dekodiert nichts neu, der Compositor schiebt nur.

   Der Zustand ist absichtlich global und nicht per Property durchgereicht —
   Auswahl und Bühne stehen im Layout nebeneinander, nicht ineinander. */

/** Maximaler Versatz in Pixeln bei halb gewischter Seite. */
export const HERO_PARALLAX_PX = 12;

export const heroParallax = $state({ offsetPx: 0 });

/** `fraction` ist der Abstand zur eingerasteten Seite in Seitenbreiten,
    −0,5 … +0,5. Genau eingerastet heißt 0 und damit kein Versatz. */
export function setHeroParallaxFraction(fraction: number): void {
  const clamped = Math.min(0.5, Math.max(-0.5, Number.isFinite(fraction) ? fraction : 0));
  /* `|| 0` fängt die negative Null: sie käme als `-0px` in den Stil und wäre
     zwar wirkungslos, aber unnötig verwirrend. */
  heroParallax.offsetPx = Math.round(-clamped * 2 * HERO_PARALLAX_PX * 10) / 10 || 0;
}

export function resetHeroParallax(): void {
  heroParallax.offsetPx = 0;
}
