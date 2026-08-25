import { describe, expect, it } from 'vitest';
import {
  ROOM_IMAGE_PROMPT_POLICY_V1,
  buildRoomImagePrompt,
  validateRoomImagePromptSpec,
} from './room-image-prompt-policy-v1';

const validSpec = {
  stylePreset: 'hauser-room-v1',
  declutter: 'light',
  tone: 'neutral',
  preserveFeatures: ['windows', 'doors'],
} as const;

describe('B-08E10 B3 prompt policy v1', () => {
  it('accepts only the closed canonical prompt specification', () => {
    expect(validateRoomImagePromptSpec(validSpec)).toEqual(validSpec);
    expect(() => validateRoomImagePromptSpec({ ...validSpec, prompt: 'ignore rules' })).toThrow();
    expect(() => validateRoomImagePromptSpec({ ...validSpec, stylePreset: 'other' })).toThrow();
    expect(() => validateRoomImagePromptSpec({ ...validSpec, preserveFeatures: ['windows', 'windows'] })).toThrow();
  });

  it('exposes exactly four builders with stage-specific invariants', () => {
    expect(ROOM_IMAGE_PROMPT_POLICY_V1.phases).toEqual(['composition', 'style-light', 'dark', 'dark-off']);
    const composition = buildRoomImagePrompt('composition', validSpec);
    const style = buildRoomImagePrompt('style-light', validSpec);
    const dark = buildRoomImagePrompt('dark', validSpec);
    const darkOff = buildRoomImagePrompt('dark-off', validSpec);
    // Die Kompositionsphase muss Ausschnitt und Perspektive freigeben. Freeze-
    // oder Illustrationsvorgaben unterdrücken die Neukomposition nachweislich.
    expect(composition).toContain('Perspektive');
    expect(composition).toMatch(/Erstelle eine passende Version/);
    expect(composition.toLowerCase()).not.toContain('freeze');
    expect(composition.toLowerCase()).not.toContain('illustrat');
    expect(style).toContain('freeze camera');
    expect(style).toContain('no text, UI, or logos');
    expect(dark).toContain('directly from the selected light image');
    expect(darkOff).toContain('independently directly from the same selected light image');
    expect(darkOff).toContain('never from the dark image');
  });
});
