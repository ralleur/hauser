import { describe, expect, it } from 'vitest';
import { ambientRequest, requestAmbient, requestAmbientEdit, requestDeepNightPreview } from './ambient.svelte.ts';

describe('ambient requests', () => {
  it('unterscheidet normalen Standby und Deep-Night-Vorschau', () => {
    const initialSeq = ambientRequest.seq;

    requestDeepNightPreview();
    expect(ambientRequest).toMatchObject({ seq: initialSeq + 1, mode: 'deep-night-preview' });

    requestAmbient();
    expect(ambientRequest).toMatchObject({ seq: initialSeq + 2, mode: 'normal' });
  });

  it('„Sperrbildschirm anpassen" ist eine eigene Anfrage ohne Ursprungspunkt', () => {
    const initialSeq = ambientRequest.seq;
    requestAmbientEdit();
    expect(ambientRequest).toMatchObject({ seq: initialSeq + 1, mode: 'edit', origin: null });
  });
});
