// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import viteConfigSource from '../../../vite.config.ts?raw';

const appCss = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');

const visibleHeroRooms = ['wohnzimmer', 'kinderzimmer', 'schlafzimmer', 'bad', 'kueche', 'flur'];
/* B-27 D5: Vorgehalten werden nur noch die Phone-Ableitungen. `dark-off` und
   `all-*` fragt der Phone-Resolver nie an (PhoneHeroVariant, PHONE_HERO_ROOMS);
   die Vollbilder uebernimmt der Runtime-Cache. */
const expectedHeroAssets = [
  ...visibleHeroRooms.flatMap((room) => [
    `hero/${room}-dark-phone.avif`,
    `hero/${room}-light-phone.avif`,
  ]),
].sort();
/* Die Vollfassungen duerfen NICHT mehr im Precache liegen — sonst waere der
   Gewinn von 14,31 MB auf 674 KB wieder weg. */
const fullSizeHeroAssets = [
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

  it('precaches only the phone hero derivations and leaves the full images to the runtime cache', async () => {
    const config = await import('../../../vite.config.ts') as typeof import('../../../vite.config.ts') & {
      START_SCREEN_HERO_ASSETS?: readonly string[];
      START_SCREEN_PRECACHE_ASSETS?: readonly string[];
    };

    expect(config.START_SCREEN_HERO_ASSETS).toEqual(expectedHeroAssets);
    expect(config.START_SCREEN_PRECACHE_ASSETS?.filter((asset) => asset.startsWith('hero/')))
      .toEqual(expectedHeroAssets);
    /* Die Ableitungen entstehen deterministisch im prebuild und sind bewusst
       nicht eingecheckt (siehe .gitignore) — in einem frischen Checkout gibt es
       sie noch nicht. Geprueft wird deshalb ihre Quelle: fehlt eine der
       eingecheckten Vollfassungen, erzeugt der prebuild die Ableitung still
       nicht und der Precache liefe ins Leere. */
    expect(fullSizeHeroAssets.every((asset) => existsSync(new URL(`../../../public/${asset}`, import.meta.url))))
      .toBe(true);
    expect(viteConfigSource).toContain('-phone.avif');
    expect(config.START_SCREEN_PRECACHE_ASSETS?.some((asset) => asset.startsWith('rooms/'))).toBe(false);
    expect(config.START_SCREEN_PRECACHE_ASSETS?.some((asset) => asset.startsWith('api/'))).toBe(false);
    expect(expectedHeroAssets).toHaveLength(12);
    for (const asset of fullSizeHeroAssets) {
      expect(config.START_SCREEN_PRECACHE_ASSETS).not.toContain(asset);
    }
    expect(viteConfigSource).toMatch(/urlPattern: \/\\\/\(\?:hero\|rooms\|room-images\|mdi-icons\)\\\/\//);
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
