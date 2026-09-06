import { describe, expect, it, vi } from 'vitest';
import { buildRoomImagePrompt } from './room-image-prompt-policy-v1.ts';
// @ts-expect-error Serverquellen sind JavaScript ohne Typdeklarationen.
import { assetsWithoutOvercast, deriveOvercastVariant } from '../../../server/room-image-overcast-service.mjs';

/* Paket 13: Die trübe Variante entsteht nachträglich aus dem fertigen Tagbild
   — ein Anbieteraufruf, ruhig und außerhalb des Wizard-Laufs. */

const spec = {
  stylePreset: 'hauser-room-v1' as const,
  declutter: 'none' as const,
  tone: 'neutral' as const,
  preserveFeatures: ['windows', 'doors', 'built_ins', 'signature_furniture', 'wall_art'] as const,
};

describe('Overcast-Prompt', () => {
  const prompt = buildRoomImagePrompt('overcast', { ...spec, preserveFeatures: [...spec.preserveFeatures] });

  it('geht vom ausgewählten Tagbild aus und behält den Stil', () => {
    expect(prompt).toContain('directly from the selected light image');
    expect(prompt).toContain('Keep the identical illustration style');
  });

  it('sagt, was sich ändert — grauer Himmel, flaches Licht', () => {
    expect(prompt).toContain('overcast sky');
    expect(prompt.toLowerCase()).toContain('softer');
  });

  it('grenzt gegen Nacht und Dunkelheit ab', () => {
    expect(prompt).toContain('not dusk');
    expect(prompt).toContain('clearly lit');
  });

  it('friert Kamera und Möbel ein wie die anderen Varianten', () => {
    expect(prompt).toContain('Keep camera, perspective, geometry, crop, architecture, furniture identity');
  });
});

describe('Ableitung der trüben Variante', () => {
  const entry = { assetId: 'abc', status: 'active', files: {} };
  const store = (overrides = {}) => ({
    activeEntry: () => entry,
    variantBytes: () => new Uint8Array([1, 2, 3]),
    list: () => [{ assetId: 'abc', variants: {} }],
    addOptionalVariant: vi.fn(),
    ...overrides,
  });
  const passthrough = async (bytes: Uint8Array) => bytes;

  it('legt das Ergebnis als optionale Variante dazu', async () => {
    let seenPhase: string | null = null;
    const assetStore = store();
    const edit = vi.fn(async (options: { phase: string }) => {
      seenPhase = options.phase;
      return { image: new Uint8Array([7]) };
    });
    const provider = { available: true, edit };
    const result = await deriveOvercastVariant('abc', {
      assetStore, provider, toProviderInput: passthrough, toFinal: passthrough,
    });
    expect(result).toMatchObject({ ok: true, status: 'written' });
    expect(assetStore.addOptionalVariant).toHaveBeenCalledWith('abc', 'overcast', expect.any(Uint8Array));
    expect(seenPhase).toBe('overcast');
  });

  it('erzeugt nichts doppelt', async () => {
    const assetStore = store({ activeEntry: () => ({ ...entry, files: { overcast: { sha256: 'x' } } }) });
    const provider = { available: true, edit: vi.fn() };
    const result = await deriveOvercastVariant('abc', { assetStore, provider });
    expect(result).toMatchObject({ ok: true, status: 'already' });
    expect(provider.edit).not.toHaveBeenCalled();
  });

  it('lässt das Bildset in Ruhe, wenn der Anbieter nichts liefert', async () => {
    const assetStore = store();
    const provider = { available: true, edit: async () => ({ errorCode: 'PROVIDER_FORBIDDEN', status: 403 }) };
    const result = await deriveOvercastVariant('abc', {
      assetStore, provider, toProviderInput: passthrough, toFinal: passthrough,
    });
    expect(result).toMatchObject({ ok: false, code: 'PROVIDER_FORBIDDEN' });
    expect(assetStore.addOptionalVariant).not.toHaveBeenCalled();
  });

  it('verlangt einen eingerichteten Anbieter', async () => {
    const result = await deriveOvercastVariant('abc', { assetStore: store(), provider: { available: false } });
    expect(result).toMatchObject({ ok: false, code: 'PROVIDER_CREDENTIAL_MISSING' });
  });

  it('kennt den Arbeitsvorrat der Nacht', () => {
    const assetStore = store({
      list: () => [
        { assetId: 'ohne', variants: { light: 'x' } },
        { assetId: 'mit', variants: { light: 'x', overcast: 'y' } },
      ],
    });
    expect(assetsWithoutOvercast(assetStore)).toEqual(['ohne']);
  });
});
