import { describe, expect, it } from 'vitest';
import { heroAssetUrl, normalizeHeroRoom, selectHeroVariant } from './room-hero-assets.ts';

const fallbackTheme = 'light' as const;

describe('room hero asset selection', () => {
  it('uses the day hero variant when sun.sun is above the horizon', () => {
    expect(selectHeroVariant({ day: true }, 'dark')).toBe('light');
    expect(heroAssetUrl({ baseUrl: '/', roomId: 'wohnzimmer', sun: { day: true }, fallbackTheme: 'dark' }))
      .toBe('/hero/wohnzimmer-light.avif');
  });

  it('uses the evening/night hero variant when sun.sun is below the horizon', () => {
    expect(selectHeroVariant({ day: false }, 'light')).toBe('dark');
    expect(heroAssetUrl({ baseUrl: '/', roomId: 'kueche', sun: { day: false }, fallbackTheme }))
      .toBe('/hero/kueche-dark.avif');
  });

  it('uses the lights-off night asset only when assigned room lights are all off', () => {
    expect(selectHeroVariant({ day: false }, fallbackTheme, true)).toBe('dark-off');
    expect(heroAssetUrl({
      baseUrl: '/', roomId: 'wohnzimmer', sun: { day: false }, fallbackTheme, allAssignedLightsOff: true,
    })).toBe('/hero/wohnzimmer-dark-off.avif');
    expect(heroAssetUrl({
      baseUrl: '/', roomId: 'wohnzimmer', sun: { day: true }, fallbackTheme, allAssignedLightsOff: true,
    })).toBe('/hero/wohnzimmer-light.avif');
  });

  it('does not let a manual UI theme override change the sun-driven hero variant', () => {
    expect(heroAssetUrl({ baseUrl: '/app/', roomId: 'bad', sun: { day: false }, fallbackTheme: 'light' }))
      .toBe('/app/hero/bad-dark.avif');
    expect(heroAssetUrl({ baseUrl: '/app/', roomId: 'bad', sun: { day: true }, fallbackTheme: 'dark' }))
      .toBe('/app/hero/bad-light.avif');
  });

  it('falls back to the UI theme until sun.sun has delivered a state', () => {
    expect(selectHeroVariant(undefined, 'light')).toBe('light');
    expect(selectHeroVariant(undefined, 'dark')).toBe('dark');
  });

  it('falls back to the all-room collage for missing or unknown room ids', () => {
    expect(normalizeHeroRoom(null)).toBe('all');
    expect(normalizeHeroRoom('garage')).toBe('all');
    expect(heroAssetUrl({ baseUrl: '/', roomId: 'garage', sun: { day: false }, fallbackTheme }))
      .toBe('/hero/all-dark.avif');
  });
});
