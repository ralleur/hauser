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

function preservation(spec: RoomImagePromptSpec): string {
  const selected = spec.preserveFeatures.length ? spec.preserveFeatures.join(', ') : 'none selected';
  return `Always preserve room identity, architecture, openings, built-ins, signature furniture, spatial relations, and selected features: ${selected}.`;
}

export function buildCompositionRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  return [
    'Create a professional realistic interior composition from the supplied cropped room photograph.',
    'Correct lens distortion and verticals, moderately reframe inside the fixed crop, and improve exposure.',
    `Apply only the confirmed ${spec.declutter} decluttering level and a ${spec.tone} tone.`,
    preservation(spec),
    'do not invent rooms, openings, furniture, exterior views, decorations, or other content.',
    'Do not use an illustration style in this composition phase.',
  ].join(' ');
}

export function buildStyleLightRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  return [
    'Transform the supplied validated composition into the versioned Hauser light style.',
    'Use a clean modern semi-realistic vector illustration, clear contours, calm color fields, subtle gradients, stylized shadows, accurate simplified detail, cinematic interior lighting, and a premium editorial automotive look.',
    `Use a ${spec.tone} tone.`,
    preservation(spec),
    'Strictly freeze camera, perspective, geometry, crop, architecture, furniture identity, layout, and every object position.',
    'Do not add landscapes, graphic suns, openings, furniture, decorations; no text, UI, or logos.',
  ].join(' ');
}

export function buildDarkRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  return [
    'Create the coherent night variant with room lights switched on directly from the selected light image.',
    preservation(spec),
    'Keep camera, perspective, geometry, crop, architecture, furniture identity, layout, and object positions unchanged; no text, UI, or logos.',
  ].join(' ');
}

export function buildDarkOffRoomImagePrompt(specification: unknown): string {
  const spec = validateRoomImagePromptSpec(specification);
  return [
    'Create the coherent night variant with room lights switched off independently directly from the same selected light image, never from the dark image.',
    preservation(spec),
    'Keep camera, perspective, geometry, crop, architecture, furniture identity, layout, and object positions unchanged; no text, UI, or logos.',
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
