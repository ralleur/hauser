import { describe, expect, it, vi } from 'vitest';
import {
  energyAssetUrl,
  energyFrameUrl,
  exteriorAssetUrl,
  exteriorHeroFrame,
  placeFrame,
  loadEnergyHeroFrame,
  parseEnergyHeroFrame,
  selectEnergyVariant,
} from './energy-hero-assets.ts';

const fallbackTheme = 'light' as const;

describe('energy hero asset selection', () => {
  it('uses the day energy image when sun.sun is above the horizon', () => {
    expect(selectEnergyVariant({ day: true }, 'dark')).toBe('day');
    expect(energyAssetUrl({ baseUrl: '/', sun: { day: true }, fallbackTheme: 'dark' }))
      .toBe('/energy/day.avif');
  });

  it('uses the night energy image when sun.sun is below the horizon', () => {
    expect(selectEnergyVariant({ day: false }, fallbackTheme)).toBe('night');
    expect(energyAssetUrl({ baseUrl: '/app/', sun: { day: false }, fallbackTheme }))
      .toBe('/app/energy/night.avif');
  });

  it('does not let a manual UI theme override change the sun-driven image', () => {
    expect(energyAssetUrl({ baseUrl: '/', sun: { day: false }, fallbackTheme: 'light' }))
      .toBe('/energy/night.avif');
    expect(energyAssetUrl({ baseUrl: '/', sun: { day: true }, fallbackTheme: 'dark' }))
      .toBe('/energy/day.avif');
  });

  it('falls back to the UI theme until sun.sun has delivered a state', () => {
    expect(selectEnergyVariant(undefined, 'light')).toBe('day');
    expect(selectEnergyVariant(undefined, 'dark')).toBe('night');
  });
});

const anchor = { point: { x: 88, y: 42 }, note: { x: 72, y: 24 }, tilt: -1.1 };
const frame = { ratio: 1.5, sun: anchor, house: anchor, grid: anchor };

describe('energy hero frame (R14a: anchors live next to the image)', () => {
  it('derives the anchor file from the image file', () => {
    expect(energyFrameUrl('/energy/day.avif')).toBe('/energy/day.json');
    expect(energyFrameUrl('/app/energy/night.avif')).toBe('/app/energy/night.json');
  });

  it('accepts only the exact frame shape', () => {
    expect(parseEnergyHeroFrame(frame)).toEqual(frame);
    expect(parseEnergyHeroFrame({ ...frame, ratio: 0 })).toBeNull();
    expect(parseEnergyHeroFrame({ ...frame, grid: undefined })).toBeNull();
    expect(parseEnergyHeroFrame({ ...frame, sun: { ...anchor, point: { x: 120, y: 1 } } })).toBeNull();
    expect(parseEnergyHeroFrame(null)).toBeNull();
  });

  it('loads a frame once per url and yields no frame without a file', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => (
      String(url).endsWith('day.json')
        ? new Response(JSON.stringify(frame), { status: 200 })
        : new Response('', { status: 404 })
    )) as unknown as typeof fetch;
    await expect(loadEnergyHeroFrame('/t/day.json', fetchImpl)).resolves.toEqual(frame);
    await expect(loadEnergyHeroFrame('/t/day.json', fetchImpl)).resolves.toEqual(frame);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(loadEnergyHeroFrame('/t/none.json', fetchImpl)).resolves.toBeNull();
  });
});

describe('exterior hero frame (R14b: the own house)', () => {
  const rect = (x: number, y: number, w: number, h: number, kind: string) => ({
    kind, points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
  });

  it('pins generation to the largest solar area and load to a window', () => {
    const frame = exteriorHeroFrame([
      rect(0.6, 0.25, 0.1, 0.05, 'solar'),
      rect(0.5, 0.2, 0.3, 0.1, 'solar'),
      rect(0.7, 0.5, 0.1, 0.1, 'window'),
    ]);
    expect(frame.ratio).toBeCloseTo(1.5);
    expect(frame.sun.point).toEqual({ x: 65, y: 25 });
    expect(frame.house.point).toEqual({ x: 75, y: 55 });
    expect(frame.sun.note.x).toBeLessThan(frame.sun.point.x);
    expect(frame.grid.point.x).toBeGreaterThan(90);
  });

  it('falls back to the template where nothing was detected', () => {
    const frame = exteriorHeroFrame([]);
    expect(frame.sun.point).toEqual({ x: 88, y: 18 });
    expect(frame.house.point).toEqual({ x: 60, y: 62 });
    expect(exteriorAssetUrl('abc', 'night')).toBe('/assets/room-images/abc/dark.avif');
  });
});

describe('note placement (R21: notes stay on screen and off the summary)', () => {
  const bounds = {
    visible: { x0: 0, y0: 8, x1: 100, y1: 92 },
    blocked: [{ x0: 0, y0: 8, x1: 36, y1: 40 }],
    note: { w: 10, h: 8 },
  };
  const anchor = (x: number, y: number) => ({ point: { x, y }, note: { x, y }, tilt: 0 });

  it('pulls a note that hangs over the crop back into the visible picture', () => {
    const placed = placeFrame({ ratio: 1.5, sun: anchor(98, 2), house: anchor(50, 50), grid: anchor(50, 99) }, bounds);
    expect(placed.sun.note).toEqual({ x: 93.5, y: 13.5 });
    expect(placed.sun.point).toEqual({ x: 98, y: 9 });
    expect(placed.grid.note.y).toBeLessThanOrEqual(92 - 4 - 1.5);
    expect(placed.house.note).toEqual({ x: 50, y: 50 });
  });

  it('moves a note off the summary by the shortest way', () => {
    const placed = placeFrame({ ratio: 1.5, sun: anchor(30, 38), house: anchor(50, 50), grid: anchor(50, 50) }, bounds);
    expect(placed.sun.note.y).toBeGreaterThanOrEqual(40 + 1.5 + 4);
    expect(placed.sun.note.x).toBe(30);
  });

  it('leaves everything untouched without bounds', () => {
    const frame = { ratio: 1.5, sun: anchor(98, 2), house: anchor(50, 50), grid: anchor(50, 99) };
    expect(placeFrame(frame, null)).toBe(frame);
  });
});
