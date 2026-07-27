import { describe, expect, it } from 'vitest';
import { computeLoadBreakdown, type LoadInput } from './energy-load.ts';

describe('computeLoadBreakdown (B-19)', () => {
  it('leere/nur-null/nur-0-Eingaben → total 0, keine Segmente', () => {
    expect(computeLoadBreakdown([])).toEqual({ total: 0, segments: [] });
    expect(computeLoadBreakdown([{ label: 'A', value: null }, { label: 'B', value: 0 }]))
      .toEqual({ total: 0, segments: [] });
  });

  it('ignoriert null/unavailable und negative Werte (keine Fake-Werte)', () => {
    const bd = computeLoadBreakdown([
      { label: 'A', value: 3 },
      { label: 'B', value: null },
      { label: 'C', value: -2 },
    ]);
    expect(bd.total).toBe(3);
    expect(bd.segments.map((s) => s.label)).toEqual(['A']);
  });

  it('berechnet Anteile und kumulierte Offsets, sortiert absteigend', () => {
    const bd = computeLoadBreakdown([
      { label: 'Klein', value: 1 },
      { label: 'Groß', value: 3 },
    ]);
    expect(bd.total).toBe(4);
    expect(bd.segments.map((s) => s.label)).toEqual(['Groß', 'Klein']);
    expect(bd.segments[0]).toMatchObject({ fraction: 0.75, offset: 0 });
    expect(bd.segments[1]).toMatchObject({ fraction: 0.25, offset: 0.75 });
  });

  it('Anteile summieren sich zu 1, Offsets sind lückenlos kumulativ', () => {
    const bd = computeLoadBreakdown([
      { label: 'A', value: 2 },
      { label: 'B', value: 5 },
      { label: 'C', value: 3 },
    ]);
    const sum = bd.segments.reduce((acc, s) => acc + s.fraction, 0);
    expect(sum).toBeCloseTo(1, 10);
    let running = 0;
    for (const s of bd.segments) {
      expect(s.offset).toBeCloseTo(running, 10);
      running += s.fraction;
    }
  });

  it('fasst gleiche group zu einem Segment zusammen', () => {
    const bd = computeLoadBreakdown([
      { label: 'Kanal 1', value: 2, group: 'Shelly' },
      { label: 'Kanal 2', value: 3, group: 'Shelly' },
      { label: 'Solo', value: 5 },
    ]);
    expect(bd.total).toBe(10);
    const shelly = bd.segments.find((s) => s.label === 'Shelly');
    expect(shelly?.value).toBe(5);
    expect(bd.segments).toHaveLength(2);
  });

  it('bündelt ≥2 kleine Verbraucher zu „Sonstige" (ans Ende sortiert)', () => {
    const bd = computeLoadBreakdown([
      { label: 'Groß', value: 100 },
      { label: 'Winzig 1', value: 2 },
      { label: 'Winzig 2', value: 1 },
    ]); // Schwelle 4 %: 2 und 1 von 103 liegen darunter
    const other = bd.segments.find((s) => s.key === 'other');
    expect(other).toBeDefined();
    expect(other?.label).toBe('Sonstige');
    expect(other?.value).toBe(3);
    expect(bd.segments.at(-1)?.key).toBe('other');
    expect(bd.segments).toHaveLength(2);
  });

  it('ein einzelner kleiner Verbraucher bleibt eigenständig (nicht „Sonstige")', () => {
    const bd = computeLoadBreakdown([
      { label: 'Groß', value: 100 },
      { label: 'Winzig', value: 1 },
    ]);
    expect(bd.segments.some((s) => s.key === 'other')).toBe(false);
    expect(bd.segments.map((s) => s.label)).toEqual(['Groß', 'Winzig']);
  });

  it('respektiert eine konfigurierbare Schwelle/Label', () => {
    const inputs: LoadInput[] = [
      { label: 'A', value: 50 },
      { label: 'B', value: 30 },
      { label: 'C', value: 20 },
    ];
    // Schwelle 40 %: B (30 %) und C (20 %) fallen in den Sammeltopf.
    const bd = computeLoadBreakdown(inputs, { otherThreshold: 0.4, otherLabel: 'Rest' });
    const rest = bd.segments.find((s) => s.key === 'other');
    expect(rest?.label).toBe('Rest');
    expect(rest?.value).toBe(50);
  });
});
