import { describe, expect, it } from 'vitest';
import { ambientRequest, requestAmbient, requestDeepNightPreview } from './ambient.svelte.ts';

describe('ambient requests', () => {
  it('unterscheidet normalen Standby und Deep-Night-Vorschau', () => {
    const initialSeq = ambientRequest.seq;

    requestDeepNightPreview();
    expect(ambientRequest).toMatchObject({ seq: initialSeq + 1, mode: 'deep-night-preview' });

    requestAmbient();
    expect(ambientRequest).toMatchObject({ seq: initialSeq + 2, mode: 'normal' });
  });
});