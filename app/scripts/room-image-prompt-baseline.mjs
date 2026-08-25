/* Isolierter Baseline-Test: Sams Prompts 1:1 gegen die API, ohne Wizard-Crop
   und ohne jede Prompt-Ergaenzung. Gleicher Provider-Codepfad wie der Wizard.
   Schreibt die Ergebnisse als PNG in den Ausgabeordner. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createChatGptRoomImageProvider, createRoomImageCredentialStore } from './server.mjs';

const OUT = process.argv[2] || '/tmp/hauser-baseline';
const SOURCE = process.argv[3] || '/tmp/hauser-room-images/sources/source-ntCtd7FV1gIIbRAEf63WQoLZRGuefw4u9dw1stfaIik.jpg';

const PROMPT_1 = 'Ich habe in meinem Smarthome Dashboard Kacheln für alle Räume. Hier ein Foto vom Wohnzimmer. Ich brauche ein background Bild für die Kachel Wohnzimmer aber das Foto ist bei weitem nicht professionell genug. Ausschnitt , Perspektive alles suboptimal. Erstelle eine passende Version';

const PROMPT_2 = `Transform the image into a clearly stylized, polished digital interior illustration.

Preserve the original room layout, architecture, furniture placement, perspective, proportions, objects, and overall composition exactly. Do not redesign or reinterpret the room.

The result must look unmistakably illustrated rather than photographed or rendered.

STYLE DIRECTION

Create a premium contemporary editorial interior illustration with:

- clearly simplified shapes
- softly stylized forms
- clean, controlled dark outlines
- smooth but simplified shading
- slightly flattened material detail
- rich but natural colors
- soft, cozy, balanced lighting
- polished digital illustration quality

The image should sit between clean cel-shaded illustration and soft editorial painting.

It should NOT look photorealistic, like an architectural render, or like a photograph with a filter applied.

OUTLINES

Use clearly visible dark warm-gray or dark-brown contour lines around furniture, cushions, plants, windows and doors, lamps, tables and chairs, decor, and important architectural edges.

Outlines should be moderately strong and consistent. They should be more visible than in a realistic digital painting, but softer and more elegant than comic-book or ink-drawing outlines. Use slightly thicker outlines around major silhouettes and slightly finer lines for internal detail. Do not allow important object edges to disappear into realistic shading.

SHAPE SIMPLIFICATION

Stylize and simplify real-world detail. Reduce small photographic details and merge them into cleaner illustrated shapes. Furniture should retain its exact recognizable geometry, but simplify tiny seams, fabric wrinkles, complex surface texture, small reflections, plant foliage into readable grouped shapes, and distant exterior details. Avoid photographic micro-detail. The viewer should immediately perceive the scene as a digital illustration.

SHADING

Use simplified tonal modeling rather than continuous photorealistic rendering. Prefer approximately 3-5 broad tonal levels per major surface: base color, light side, soft highlight, shadow side, occasional deeper contact shadow. Transitions may be softly blended, but the underlying tonal structure should remain simple and graphic. Avoid highly realistic global illumination and complex light simulation. Shadows should be broad, soft-edged, understated, visually clean, and slightly stylized. Do not create strong geometric sunlight patches or dramatic cast shadows.

COLOR

Use richer, moderately saturated colors while remaining tasteful and natural. Avoid pale, washed-out, beige-dominated rendering. Maintain clear color separation between sofa, wood, plants, cushions, wall art, decor, and exterior greenery. Use warm-neutral whites and creams. Keep wood warm but natural. Keep plants visibly green. Allow accent colors to remain slightly richer and more expressive than in a photograph. Do not apply a heavy yellow, orange, or sepia cast. The overall white balance should be warm-neutral rather than golden.

LIGHTING

Use soft, diffuse daylight and gentle ambient interior light. The room should feel bright, cozy, calm, and inviting. Lighting should support the illustration rather than dominate it. Avoid dramatic cinematic lighting, golden-hour orange glow, strong directional sunlight, strong wall shadows, blown highlights, and realistic HDR rendering. Use gentle luminous highlights and soft atmospheric warmth without making the whole image orange.

MATERIAL RENDERING

Wood: simplified grain, warm flat color, subtle tonal variation, minimal reflections. Fabric: soft broad folds, simplified texture, no highly realistic weave or tiny wrinkles. Plants: grouped leaf shapes, clear silhouettes, rich natural greens, reduced botanical micro-detail. Glass and metal: simplified highlights, clean reflections, no photographic specular complexity. Walls: mostly smooth, subtle tonal variation, no strong texture.

EXTERIOR VIEW

Keep the exterior recognizable but simplify it slightly more than the interior. Buildings, foliage, balconies, and distant objects should use cleaner shapes, reduced detail, softer contrast, and simplified shading. Do not make the exterior photorealistic.

TARGET AESTHETIC

The final result should feel like a professionally illustrated lifestyle or interior-design editorial image: soft, cozy, clean, colorful, gently graphic, clearly outlined, rich but restrained, high-end, and unmistakably illustrated. It should have more stylistic simplification than a realistic digital painting, while retaining more depth and softness than flat vector art.

PRIORITY ORDER

1. Preserve original composition and geometry.
2. Make the result unmistakably illustrated.
3. Simplify photographic material detail.
4. Use clearly visible, moderately thick dark contours.
5. Use simplified soft cel-style tonal modeling.
6. Keep colors rich but natural.
7. Keep lighting warm-neutral and soft.
8. Avoid both photorealism and sketch-like line art.

AVOID

photorealism, architectural-render appearance, 3D-render appearance, photo-filter appearance, realistic HDR lighting, realistic material microtexture, excessive fabric detail, detailed wood grain, complex reflections, washed-out colors, beige monochrome rendering, heavy orange cast, golden-hour lighting, hard sunlight, dramatic shadows, thin scratchy linework, architectural sketch aesthetics, comic-book styling, flat vector clip-art, poster graphics, heavy painterly brush texture.`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const credentialStore = createRoomImageCredentialStore({});
  const status = credentialStore.status();
  console.log('Zugang:', status.configured ? `konfiguriert (${status.mode})` : 'FEHLT');
  if (!status.configured) return;

  const provider = createChatGptRoomImageProvider({ credentialStore });
  const source = readFileSync(SOURCE);
  console.log('Quelle:', SOURCE, source.length, 'bytes');

  console.log('\n--- Schritt 1: Perspektive/Ausschnitt (Prompt 1 wörtlich) ---');
  const step1 = await provider.edit({ prompt: PROMPT_1, input: new Uint8Array(source) });
  if (!step1.image) {
    console.log('FEHLGESCHLAGEN:', JSON.stringify({ status: step1.status, errorCode: step1.errorCode }));
    return;
  }
  const file1 = join(OUT, '1-perspektive.png');
  writeFileSync(file1, Buffer.from(step1.image));
  console.log('OK ->', file1, step1.image.byteLength, 'bytes');

  console.log('\n--- Schritt 2: Stil (Prompt 2 wörtlich, auf Ergebnis 1) ---');
  const step2 = await provider.edit({ prompt: PROMPT_2, input: new Uint8Array(step1.image) });
  if (!step2.image) {
    console.log('FEHLGESCHLAGEN:', JSON.stringify({ status: step2.status, errorCode: step2.errorCode }));
    return;
  }
  const file2 = join(OUT, '2-stil.png');
  writeFileSync(file2, Buffer.from(step2.image));
  console.log('OK ->', file2, step2.image.byteLength, 'bytes');
}

main().catch((error) => console.error('FEHLER:', error.message));
