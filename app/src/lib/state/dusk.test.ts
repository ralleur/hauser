import { describe, expect, it } from 'vitest';
import { DUSK_BAND_DEG, duskProgress, inDuskBand } from './dusk.ts';

describe('duskProgress', () => {
  it('ohne Sonnenhöhe bleibt es beim Hartschnitt', () => {
    expect(duskProgress(null, true)).toBe(1);
    expect(duskProgress(undefined, false)).toBe(0);
    expect(duskProgress(Number.NaN, true)).toBe(1);
  });

  it('außerhalb des Bandes voller Tag beziehungsweise volle Nacht', () => {
    expect(duskProgress(DUSK_BAND_DEG + 0.1, true)).toBe(1);
    expect(duskProgress(-DUSK_BAND_DEG - 0.1, false)).toBe(0);
  });

  it('am Horizont steht die Überblendung genau in der Mitte', () => {
    expect(duskProgress(0, true)).toBeCloseTo(0.5, 6);
  });

  it('läuft linear durch das Band', () => {
    expect(duskProgress(DUSK_BAND_DEG / 2, true)).toBeCloseTo(0.75, 6);
    expect(duskProgress(-DUSK_BAND_DEG / 2, false)).toBeCloseTo(0.25, 6);
  });
});

describe('inDuskBand', () => {
  it('nur echte Zwischenwerte zählen als Dämmerung', () => {
    expect(inDuskBand(0)).toBe(false);
    expect(inDuskBand(1)).toBe(false);
    expect(inDuskBand(0.5)).toBe(true);
  });
});
