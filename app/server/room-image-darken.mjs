/* ── Abend, Nacht und trüb ohne Modellaufruf ──
   Wer selbst zeichnet oder mit Cloudflare zeichnet, bekommt die Nacht nicht
   vom Modell, sondern aus dem Tagbild gerechnet — abgedunkelt und gefärbt,
   dadurch sicher deckungsgleich mit dem Tag (Lampen-Glow und Regen im
   Fenster sitzen auf festen Koordinaten). Dieselben Rezepte wie der Rückfall
   der iOS-App (`ImageTools.darken`): Abend warm und gut halb so hell, Nacht
   ohne Licht kühl und dunkel, trüb nur etwas flacher und kühler. */

import { sharp } from './runtime-env.mjs';

/* Faktoren je Kanal (R, G, B): `linear` multipliziert vor dem Gamma, deshalb
   liegen die Werte unter dem, was das Auge als Halbierung sieht. */
const RECIPES = Object.freeze({
  dark: Object.freeze({ gain: [0.62, 0.55, 0.44], saturation: 0.95 }),
  'dark-off': Object.freeze({ gain: [0.20, 0.23, 0.31], saturation: 0.8 }),
  overcast: Object.freeze({ gain: [0.84, 0.88, 0.95], saturation: 0.82 }),
});

export const DARKEN_PHASES = Object.freeze(Object.keys(RECIPES));

/** Eine sharp-Pipeline mit dem Rezept der Phase; Ausgabeformat wählt der Aufrufer. */
export function darkenRoomImage(bytes, phase) {
  const recipe = RECIPES[phase];
  if (!recipe) throw new TypeError(`Unknown darken phase: ${phase}`);
  if (!sharp) throw new Error('sharp unavailable');
  return sharp(Buffer.from(bytes))
    .removeAlpha()
    .toColourspace('srgb')
    .modulate({ saturation: recipe.saturation })
    .linear(recipe.gain, [0, 0, 0]);
}
