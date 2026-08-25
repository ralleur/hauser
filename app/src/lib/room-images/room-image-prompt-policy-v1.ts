export const ROOM_IMAGE_PROMPT_POLICY_V1 = Object.freeze({
  id: 'room-image-prompt-policy-v1',
  phases: Object.freeze(['composition', 'style-light', 'dark', 'dark-off'] as const),
  stylePresets: Object.freeze(['hauser-room-v1'] as const),
  declutter: Object.freeze(['none', 'light', 'strong'] as const),
  tones: Object.freeze(['neutral', 'warm'] as const),
  preserveFeatures: Object.freeze([
    'windows', 'doors', 'built_ins', 'signature_furniture', 'wall_art',
  ] as const),
} as const);

export type RoomImagePromptPhase = (typeof ROOM_IMAGE_PROMPT_POLICY_V1.phases)[number];
export type RoomImagePromptSpec = {
  stylePreset: 'hauser-room-v1';
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

/** Erprobter Wortlaut der Vorlage, unverändert. Jede Ergänzung — auch gut
    gemeinte Schutzklauseln — unterdrückt nachweislich die freie Neukomposition,
    auf die es in dieser Phase ankommt. Nicht erweitern ohne Gegentest über
    app/scripts/room-image-prompt-baseline.mjs. */
const COMPOSITION_PROMPT = 'Ich habe in meinem Smarthome Dashboard Kacheln für alle Räume. '
  + 'Hier ein Foto vom Wohnzimmer. Ich brauche ein background Bild für die Kachel Wohnzimmer '
  + 'aber das Foto ist bei weitem nicht professionell genug. Ausschnitt , Perspektive alles '
  + 'suboptimal. Erstelle eine passende Version';

export function buildCompositionRoomImagePrompt(specification: unknown): string {
  validateRoomImagePromptSpec(specification);
  return COMPOSITION_PROMPT;
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
  validateRoomImagePromptSpec(specification);
  return [
    STYLE_PROMPT,
    '',
    'Strictly freeze camera, perspective, geometry, crop, architecture, furniture identity, layout, and every object position; no text, UI, or logos.',
  ].join('\n');
}

export function buildDarkRoomImagePrompt(specification: unknown): string {
  validateRoomImagePromptSpec(specification);
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
  validateRoomImagePromptSpec(specification);
  return [
    'Create the coherent night variant with room lights switched off independently directly from the same selected light image, never from the dark image.',
    'Keep the identical illustration style of the supplied light image.',
    HAUSER_STYLE_DIRECTION,
    'Light the room only by dim ambient night light from outside, keeping shapes and contours readable rather than sinking them into black.',
    'Keep camera, perspective, geometry, crop, architecture, furniture identity, layout, and object positions unchanged; no text, UI, or logos.',
    HAUSER_STYLE_AVOID,
  ].join(' ');
}

export const ROOM_IMAGE_PROMPT_BUILDERS_V1 = Object.freeze({
  composition: buildCompositionRoomImagePrompt,
  'style-light': buildStyleLightRoomImagePrompt,
  dark: buildDarkRoomImagePrompt,
  'dark-off': buildDarkOffRoomImagePrompt,
});

export function buildRoomImagePrompt(phase: RoomImagePromptPhase, specification: unknown): string {
  const builder = ROOM_IMAGE_PROMPT_BUILDERS_V1[phase];
  if (!builder) throw new TypeError('Invalid room-image prompt phase');
  return builder(specification);
}
