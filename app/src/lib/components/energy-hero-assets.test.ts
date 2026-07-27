import { describe, expect, it } from 'vitest';
import { energyAssetUrl, selectEnergyVariant } from './energy-hero-assets.ts';

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
      .toBe('/app/energy/night.png');
  });

  it('does not let a manual UI theme override change the sun-driven image', () => {
    expect(energyAssetUrl({ baseUrl: '/', sun: { day: false }, fallbackTheme: 'light' }))
      .toBe('/energy/night.png');
    expect(energyAssetUrl({ baseUrl: '/', sun: { day: true }, fallbackTheme: 'dark' }))
      .toBe('/energy/day.avif');
  });

  it('falls back to the UI theme until sun.sun has delivered a state', () => {
    expect(selectEnergyVariant(undefined, 'light')).toBe('day');
    expect(selectEnergyVariant(undefined, 'dark')).toBe('night');
  });
});
