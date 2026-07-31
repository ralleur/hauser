// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import viteConfigSource from '../../../vite.config.ts?raw';

const appCss = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

const visibleHeroRooms = ['wohnzimmer', 'kinderzimmer', 'schlafzimmer', 'bad', 'kueche', 'flur'];
const expectedHeroAssets = [
  ...visibleHeroRooms.flatMap((room) => [
    `hero/${room}-dark.avif`,
    `hero/${room}-dark-off.avif`,
    `hero/${room}-light.avif`,
  ]),
  'hero/all-dark.avif',
  'hero/all-light.avif',
].sort();

const expectedMdiAssets = [
  'archive-outline',
  'calendar',
  'ceiling-light',
  'check',
  'chevron-down',
  'chevron-up',
  'cog',
  'fire',
  'home',
  'library',
  'lightbulb',
  'lightning-bolt',
  'music-note-plus',
  'note-text-outline',
  'playlist-music',
  'power-standby',
  'shield',
  'snowflake',
  'umbrella-beach',
  'weather-night',
  'white-balance-sunny',
  'window-closed',
].map((name) => `mdi-icons/${name}.svg`).sort();

describe('offline start shell assets', () => {
  it('renders both local fonts without a blocking FOIT period', () => {
    expect(appCss.split('font-display: swap;')).toHaveLength(3);
    expect(appCss).not.toContain('font-display: block;');
  });

  it('precaches every reachable room hero variant and both all-room fallbacks', async () => {
    const config = await import('../../../vite.config.ts') as typeof import('../../../vite.config.ts') & {
      START_SCREEN_HERO_ASSETS?: readonly string[];
      START_SCREEN_PRECACHE_ASSETS?: readonly string[];
    };

    expect(config.START_SCREEN_HERO_ASSETS).toEqual(expectedHeroAssets);
    expect(config.START_SCREEN_PRECACHE_ASSETS?.filter((asset) => asset.startsWith('hero/')))
      .toEqual(expectedHeroAssets);
    expect(expectedHeroAssets.every((asset) => existsSync(new URL(`../../../public/${asset}`, import.meta.url))))
      .toBe(true);
    expect(config.START_SCREEN_PRECACHE_ASSETS?.some((asset) => asset.startsWith('rooms/'))).toBe(false);
    expect(config.START_SCREEN_PRECACHE_ASSETS?.some((asset) => asset.startsWith('api/'))).toBe(false);
    expect(expectedHeroAssets).toHaveLength(20);
    expect(viteConfigSource).toMatch(/clientsClaim:\s*false/);
    expect(viteConfigSource).toMatch(/skipWaiting:\s*false/);
  });

  it('precaches the fixed MDI shell controls without pulling in the icon catalog', async () => {
    const config = await import('../../../vite.config.ts') as typeof import('../../../vite.config.ts') & {
      START_SCREEN_MDI_ASSETS?: readonly string[];
      START_SCREEN_PRECACHE_ASSETS?: readonly string[];
    };

    expect(config.START_SCREEN_MDI_ASSETS).toEqual(expectedMdiAssets);
    expect(config.START_SCREEN_PRECACHE_ASSETS?.filter((asset) => asset.startsWith('mdi-icons/')))
      .toEqual(expectedMdiAssets);
    expect(config.START_SCREEN_MDI_ASSETS).toHaveLength(22);
    expect(viteConfigSource).toContain('...START_SCREEN_PRECACHE_ASSETS');
    expect(viteConfigSource).not.toMatch(/mdi-icons\/\*|mdi-icons\/\*\*/);
  });
});
