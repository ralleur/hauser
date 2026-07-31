import { describe, expect, it } from 'vitest';
import {
  appearanceHeroPolicy,
  appearanceTheme,
  nextAppearanceMode,
  resolveStoredAppearance,
  type AppearanceMode,
} from './appearance-mode.ts';

describe('five-state appearance mode', () => {
  it('cycles through all five modes and returns to Auto', () => {
    let mode: AppearanceMode = 'auto';
    const visited = [];
    for (let tap = 0; tap < 5; tap++) {
      mode = nextAppearanceMode(mode);
      visited.push(mode);
    }
    expect(visited).toEqual([
      'interface-light',
      'interface-dark',
      'fixed-light',
      'fixed-dark',
      'auto',
    ]);
  });

  it('separates interface theme and hero policy', () => {
    expect(appearanceTheme('auto', true, 'dark')).toBe('light');
    expect(appearanceTheme('auto', false, 'light')).toBe('dark');
    expect(appearanceTheme('interface-light', false, 'dark')).toBe('light');
    expect(appearanceTheme('interface-dark', true, 'light')).toBe('dark');
    expect(appearanceTheme('fixed-light', false, 'dark')).toBe('light');
    expect(appearanceTheme('fixed-dark', true, 'light')).toBe('dark');

    expect(appearanceHeroPolicy('auto')).toBe('auto');
    expect(appearanceHeroPolicy('interface-light')).toBe('auto');
    expect(appearanceHeroPolicy('interface-dark')).toBe('auto');
    expect(appearanceHeroPolicy('fixed-light')).toBe('day');
    expect(appearanceHeroPolicy('fixed-dark')).toBe('evening');
  });

  it('migrates only active valid legacy overrides', () => {
    const now = 1_000;
    expect(resolveStoredAppearance(null, JSON.stringify({ until: now + 1, theme: 'light' }), now))
      .toBe('interface-light');
    expect(resolveStoredAppearance(null, JSON.stringify({ until: now + 1, theme: 'dark' }), now))
      .toBe('interface-dark');
    expect(resolveStoredAppearance(null, JSON.stringify({ until: now, theme: 'dark' }), now))
      .toBe('auto');
    expect(resolveStoredAppearance(null, '{kaputt', now)).toBe('auto');
  });

  it('prefers the new persistent mode over a legacy override', () => {
    expect(resolveStoredAppearance(
      'fixed-dark',
      JSON.stringify({ until: Number.MAX_SAFE_INTEGER, theme: 'light' }),
    )).toBe('fixed-dark');
  });
});
