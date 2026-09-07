export const ROOM_IMAGE_PROMPT_POLICY_V1 = Object.freeze({
  id: 'room-image-prompt-policy-v1',
  phases: Object.freeze(['composition', 'style-light', 'dark', 'dark-off', 'overcast'] as const),
  stylePresets: Object.freeze(['hauser-room-v1', 'hauser-exterior-v1'] as const),
  declutter: Object.freeze(['none', 'light', 'strong'] as const),
  tones: Object.freeze(['neutral', 'warm'] as const),
  preserveFeatures: Object.freeze([
    'windows', 'doors', 'built_ins', 'signature_furniture', 'wall_art',
  ] as const),
} as const);

export type RoomImagePromptPhase = (typeof ROOM_IMAGE_PROMPT_POLICY_V1.phases)[number];
export type RoomImageStylePreset = (typeof ROOM_IMAGE_PROMPT_POLICY_V1.stylePresets)[number];
export type RoomImagePromptSpec = {
  stylePreset: RoomImageStylePreset;
  declutter: 'none' | 'light' | 'strong';
  tone: 'neutral' | 'warm';
  preserveFeatures: Array<'windows' | 'doors' | 'built_ins' | 'signature_furniture' | 'wall_art'>;
};

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function validateRoomImagePromptSpec(value: unknown): RoomImagePromptSpec {
  if (!exactObject(value, ['stylePreset', 'declutter', 'tone', 'preserveFeatures'])
      || !ROOM_IMAGE_PROMPT_POLICY_V1.stylePresets.includes(value.stylePreset as never)
      || !ROOM_IMAGE_PROMPT_POLICY_V1.declutter.includes(value.declutter as never)
      || !ROOM_IMAGE_PROMPT_POLICY_V1.tones.includes(value.tone as never)
      || !Array.isArray(value.preserveFeatures)
      || value.preserveFeatures.some((entry) => (
        typeof entry !== 'string'
        || !ROOM_IMAGE_PROMPT_POLICY_V1.preserveFeatures.includes(entry as never)
      ))
      || new Set(value.preserveFeatures).size !== value.preserveFeatures.length) {
    throw new TypeError('Invalid room-image prompt specification');
  }
  return {
    stylePreset: value.stylePreset as RoomImagePromptSpec['stylePreset'],
    declutter: value.declutter as RoomImagePromptSpec['declutter'],
    tone: value.tone as RoomImagePromptSpec['tone'],
    preserveFeatures: [...value.preserveFeatures] as RoomImagePromptSpec['preserveFeatures'],
  };
}

/** Gemeinsame Stilvorgabe für style-light, dark und dark-off, damit das Set
    einheitlich bleibt. Der Nachtmodus erbt denselben Illustrationscharakter. */
const HAUSER_STYLE_DIRECTION = [
  'The result must look unmistakably illustrated, never photographed, filtered, or 3D-rendered.',
  'Aim for a premium contemporary editorial interior illustration between clean cel-shaded illustration and soft editorial painting.',
  'Draw clearly visible dark warm-gray to dark-brown contour lines around furniture, cushions, plants, windows, doors, lamps, tables, chairs, decor, and important architectural edges;',
  'use slightly thicker lines on major silhouettes and finer lines for internal detail, and never let important edges dissolve into realistic shading.',
  'Simplify photographic micro-detail: merge small details into clean illustrated shapes, simplify seams, fabric wrinkles, surface texture, small reflections, and wood grain, and group plant foliage into readable shapes.',
  'Shade with simplified tonal modelling of roughly three to five broad tonal levels per major surface; keep shadows broad, soft-edged, understated, and slightly stylized.',
  'Avoid global illumination, HDR rendering, hard directional sunlight, dramatic cast shadows, and geometric sunlight patches.',
  'Keep colors rich but natural with clear separation between sofa, wood, plants, cushions, wall art, decor, and exterior greenery; keep whites warm-neutral, wood warm but natural, plants visibly green.',
  'Never produce washed-out beige monochrome rendering and never apply a heavy yellow, orange, golden-hour, or sepia cast.',
  'Simplify the exterior view slightly more than the interior while keeping it recognizable.',
].join(' ');

const HAUSER_STYLE_AVOID = [
  'Avoid photorealism, architectural-render and 3D-render appearance, photo-filter appearance, realistic material microtexture,',
  'excessive fabric detail, detailed wood grain, complex reflections, thin scratchy linework, architectural sketch aesthetics,',
  'comic-book styling, flat vector clip-art, poster graphics, and heavy painterly brush texture.',
].join(' ');

/** Erprobter Wortlaut der Vorlage, bis auf den Raumbezug unverändert. Jede
    Ergänzung — auch gut gemeinte Schutzklauseln — unterdrückt nachweislich die
    freie Neukomposition, auf die es in dieser Phase ankommt. Nicht erweitern
    ohne Gegentest über app/scripts/room-image-prompt-baseline.mjs.

    Der Wortlaut entstand an einem Wohnzimmerfoto und nannte das Wohnzimmer
    zweimal beim Namen. Für jeden anderen Raum stand damit eine Falschaussage
    im Prompt — und das Modell folgt dem Text: Ein Schlafzimmerfoto ergab am
    2026-09-06 ein frei erfundenes Wohnzimmer mit Sofa und Fernseher, das mit
    der Vorlage nur noch Lampe und Fensterblick gemeinsam hatte. Der Raum
    bleibt deshalb ungenannt; welcher es ist, steht im Bild. */
const COMPOSITION_PROMPT = 'Ich habe in meinem Smarthome Dashboard Kacheln für alle Räume. '
  + 'Hier ein Foto von einem dieser Räume. Ich brauche ein background Bild für dessen Kachel '
  + 'aber das Foto ist bei weitem nicht professionell genug. Ausschnitt , Perspektive alles '
  + 'suboptimal. Erstelle eine passende Version';

/* ── Das Haus von außen (R14b, docs/23) ──
   Dasselbe Foto-Rezept, aber die Vorlage sagt, wo Himmel, Haus und Wiese
   hingehören (docs/energy-hero-safe-area-template.svg): der Energie-Screen
   legt seine Zahlen in den Himmel links, seine Linie auf die Wiese unten. Ein
   Hausfoto durch das Raumrezept ergab am 2026-09-07 ein Zimmer — der Prompt
   sprach von einem Raum, und das Modell glaubte ihm. */
const EXTERIOR_COMPOSITION_PROMPT = 'Ich habe in meinem Smarthome Dashboard einen Energie-Bildschirm, '
  + 'dessen Hintergrund mein Haus von außen zeigt. Hier ein Foto meines Hauses von außen. Ich brauche '
  + 'ein background Bild dafür, aber das Foto ist bei weitem nicht professionell genug. Ausschnitt, '
  + 'Perspektive alles suboptimal. Erstelle eine passende Version: das Haus von außen, so wie es ist, '
  + 'in der rechten Bildhälfte; links darüber ruhiger, freier Himmel; unten ein ruhiger Streifen Garten '
  + 'oder Straße ohne Objekte. Dach, Fenster, Haustür und Solarmodule bleiben erkennbar, wo sie sind. '
  + 'Keine Personen, keine Autos, kein Text.';

const EXTERIOR_STYLE_PROMPT = `Transform the image into a clearly stylized, polished digital exterior illustration of this house.

Preserve the house exactly: its geometry, roof shape, facade, windows, doors, balconies, solar modules, garden, trees and the overall composition. Do not redesign or reinterpret the building.

The result must look unmistakably illustrated rather than photographed or rendered.

STYLE DIRECTION

Create a premium contemporary editorial exterior illustration with clearly simplified shapes, softly stylized forms, clean controlled dark outlines, smooth but simplified shading, slightly flattened material detail, rich but natural colors, soft late-morning daylight, and polished digital illustration quality. It should sit between clean cel-shaded illustration and soft editorial painting.

OUTLINES

Use clearly visible dark warm-gray or dark-brown contour lines around the roof, walls, windows, doors, solar modules, hedges, trees and important architectural edges. Slightly thicker on major silhouettes, finer for internal detail. Do not let important edges dissolve into shading.

SHAPE SIMPLIFICATION

Merge photographic micro-detail into clean illustrated shapes: roof tiles as a few readable rows, facade texture smooth, foliage grouped into readable clumps, lawn as a calm surface. Solar modules stay a clean dark-blue grid.

SHADING AND COLOR

Three to five broad tonal levels per major surface, soft-edged shadows, no HDR, no dramatic cast shadows, no lens effects. Warm-neutral whites and creams, natural greens, a clear blue sky with a soft gradient; never a golden-hour orange or sepia cast.

CALM ZONES

The sky in the upper left stays calm and empty with at most one faint cloud. The bottom strip of the picture stays a calm lawn, hedge or path without objects.

AVOID

photorealism, architectural-render appearance, 3D-render appearance, photo-filter appearance, realistic HDR lighting, realistic material microtexture, complex reflections, washed-out colors, heavy orange cast, hard sunlight, dramatic shadows, thin scratchy linework, comic-book styling, flat vector clip-art, poster graphics, heavy painterly brush texture, people, cars, text, logos.`;

const EXTERIOR_DIRECTION = [
  'Keep the identical illustration style of the supplied daylight image: clean dark contours, simplified shapes, three to five tonal levels per surface.',
  'Keep camera, perspective, geometry, crop, house, windows, doors, solar modules, garden and every object position unchanged; no text, UI, or logos.',
].join(' ');

function isExterior(specification: RoomImagePromptSpec): boolean {
  return specification.stylePreset === 'hauser-exterior-v1';
}

export function buildCompositionRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  return isExterior(spec) ? EXTERIOR_COMPOSITION_PROMPT : COMPOSITION_PROMPT;
}

/** Erprobter Wortlaut der Vorlage, unverändert. Ergänzt wird ausschließlich die
    Freeze-Zeile am Ende, damit light, dark und dark-off deckungsgleich bleiben. */
const STYLE_PROMPT = `Transform the image into a clearly stylized, polished digital interior illustration.

Preserve the original room layout, architecture, furniture placement, perspective, proportions, objects, and overall composition exactly. Do not redesign or reinterpret the room.

The result must look unmistakably illustrated rather than photographed or rendered.

STYLE DIRECTION

Create a premium contemporary editorial interior illustration with clearly simplified shapes, softly stylized forms, clean controlled dark outlines, smooth but simplified shading, slightly flattened material detail, rich but natural colors, soft cozy balanced lighting, and polished digital illustration quality.

The image should sit between clean cel-shaded illustration and soft editorial painting. It should NOT look photorealistic, like an architectural render, or like a photograph with a filter applied.

OUTLINES

Use clearly visible dark warm-gray or dark-brown contour lines around furniture, cushions, plants, windows and doors, lamps, tables and chairs, decor, and important architectural edges. Outlines should be moderately strong and consistent. They should be more visible than in a realistic digital painting, but softer and more elegant than comic-book or ink-drawing outlines. Use slightly thicker outlines around major silhouettes and slightly finer lines for internal detail. Do not allow important object edges to disappear into realistic shading.

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

export function buildStyleLightRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  if (isExterior(spec)) return EXTERIOR_STYLE_PROMPT;
  return [
    STYLE_PROMPT,
    '',
    'Strictly freeze camera, perspective, geometry, crop, architecture, furniture identity, layout, and every object position; no text, UI, or logos.',
  ].join('\n');
}

export function buildDarkRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  if (isExterior(spec)) {
    return [
      'Create the coherent night variant of this house directly from the selected daylight image.',
      EXTERIOR_DIRECTION,
      'Deep blue night sky with a handful of small stars; if there is a sun, replace it with a small moon in the same place.',
      'Warm lamp light in two or three windows and a soft light at the front door; the solar modules read dark and matte; lawn, hedge and trees sink into dim blue ambient light but keep readable contours.',
      HAUSER_STYLE_AVOID,
    ].join(' ');
  }
  return [
    'Create the coherent night variant with room lights switched on directly from the selected light image.',
    'Keep the identical illustration style of the supplied light image.',
    HAUSER_STYLE_DIRECTION,
    'Replace the daylight with warm interior lamp light against a dark exterior, keeping the glow soft and the shadows broad.',
    'Keep camera, perspective, geometry, crop, architecture, furniture identity, layout, and object positions unchanged; no text, UI, or logos.',
    HAUSER_STYLE_AVOID,
  ].join(' ');
}

export function buildDarkOffRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  if (isExterior(spec)) {
    return [
      'Create the coherent night variant of this house with every window dark, directly from the selected daylight image, never from the lit night image.',
      EXTERIOR_DIRECTION,
      'Deep blue night sky with a handful of small stars; light the house only by dim moonlight and a faint glow from the sky, keeping shapes and contours readable rather than sinking them into black.',
      HAUSER_STYLE_AVOID,
    ].join(' ');
  }
  return [
    'Create the coherent night variant with room lights switched off independently directly from the same selected light image, never from the dark image.',
    'Keep the identical illustration style of the supplied light image.',
    HAUSER_STYLE_DIRECTION,
    'Light the room only by dim ambient night light from outside, keeping shapes and contours readable rather than sinking them into black.',
    'Keep camera, perspective, geometry, crop, architecture, furniture identity, layout, and object positions unchanged; no text, UI, or logos.',
    HAUSER_STYLE_AVOID,
  ].join(' ');
}

/* ── Trübe Variante (Paket 13) ──
   Derselbe Raum bei bedecktem Himmel. Das ist ausdrücklich KEIN Nachtbild und
   kein Filter: Geometrie, Möbel und Stil bleiben, nur das Licht kommt von
   einem grauen Himmel statt von der Sonne. Der Ton bleibt bewohnbar — ein
   Regentag ist kein Trauerfall, und ein Zimmer, das plötzlich blaugrau
   erscheint, wäre eine schlechtere Lüge als das ewige Nachmittagslicht. */
export function buildOvercastRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  if (isExterior(spec)) {
    return [
      'Create the coherent overcast-daylight variant of this house directly from the selected daylight image.',
      EXTERIOR_DIRECTION,
      'Replace the blue sky with a uniformly clouded grey sky and the sunlight with flat, even light: no cast shadows, muted contrast, greens and creams kept in their own colours, nothing blue-grey.',
      'This is a dull day, not dusk: the house stays clearly lit and inviting.',
      HAUSER_STYLE_AVOID,
    ].join(' ');
  }
  return [
    'Create the coherent overcast-daylight variant directly from the selected light image.',
    'Keep the identical illustration style of the supplied light image.',
    HAUSER_STYLE_DIRECTION,
    'Replace the sunny daylight with the flat, even light of a grey overcast sky:',
    'cool down the exterior view behind the windows, mute its contrast, and let the sky read as uniformly clouded;',
    'inside, reduce the warm sunlit accents, flatten the shading further, and let shadows become softer, shallower, and less directional.',
    'Keep the room clearly lit and inviting — this is a dull day, not dusk and not a switched-off room;',
    'keep whites warm-neutral rather than blue, and keep wood, plants and textiles in their own colours.',
    'Keep camera, perspective, geometry, crop, architecture, furniture identity, layout, and object positions unchanged; no text, UI, or logos.',
    HAUSER_STYLE_AVOID,
  ].join(' ');
}

export const ROOM_IMAGE_PROMPT_BUILDERS_V1 = Object.freeze({
  composition: buildCompositionRoomImagePrompt,
  'style-light': buildStyleLightRoomImagePrompt,
  dark: buildDarkRoomImagePrompt,
  'dark-off': buildDarkOffRoomImagePrompt,
  overcast: buildOvercastRoomImagePrompt,
});

export function buildRoomImagePrompt(phase: RoomImagePromptPhase, specification: unknown): string {
  const builder = ROOM_IMAGE_PROMPT_BUILDERS_V1[phase];
  if (!builder) throw new TypeError('Invalid room-image prompt phase');
  return builder(specification);
}
