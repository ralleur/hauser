// @ts-expect-error Build tooling runs in Node; production app types intentionally exclude Node modules.
import { execFileSync } from 'node:child_process';
// @ts-expect-error Build tooling runs in Node; production app types intentionally exclude Node modules.
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';
import { buildProvenanceProblems, resolveBuildInfo } from './src/lib/config/build-info.ts';

// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
const BUILD_ENV: Record<string, string | undefined> = process.env;

const CI_TEST_TIMEOUT = BUILD_ENV.CI === 'true' ? 60_000 : 5_000;

/* Herkunft der gebauten Fassung (AGPL §13): die vollständige Commit-SHA wird
   eingebettet, damit die Oberfläche auf den Corresponding Source genau dieser
   Revision zeigen kann. Im Container gibt es kein `.git`, dort liefert der
   Build-Arg `HAUSER_REVISION` den Wert. */
function gitRevision(): string {
  try {
    return String(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })).trim();
  } catch {
    return '';
  }
}

const packageVersion = JSON.parse(
  String(readFileSync(new URL('./package.json', import.meta.url), 'utf8')),
).version;

const BUILD_INFO = resolveBuildInfo({
  version: packageVersion,
  revision: BUILD_ENV.HAUSER_REVISION || gitRevision(),
  sourceUrl: BUILD_ENV.HMI_SOURCE_URL,
});

/* Ein publizierbares Artefakt ohne vollständige Revision oder ohne öffentliche
   Source-URL wäre AGPL-widrig — der Build bricht dann ab, statt eine erfundene
   Upstream-Herkunft auszuliefern. Entwicklungsbuilds laufen ohne
   `HAUSER_RELEASE` weiter und zeigen einfach weniger an. */
if (BUILD_ENV.HAUSER_RELEASE === '1') {
  const problems = buildProvenanceProblems(BUILD_INFO);
  if (problems.length > 0) {
    throw new Error(
      `Release-Build ohne belastbare Herkunft: ${problems.join(', ')}. `
      + 'HAUSER_REVISION (vollständige Commit-SHA) und HMI_SOURCE_URL (https) setzen.',
    );
  }
}

const START_SCREEN_HERO_ROOMS = [
  'wohnzimmer',
  'kinderzimmer',
  'schlafzimmer',
  'bad',
  'kueche',
  'flur',
] as const;

/* Beide normalen Varianten werden schon im Phone-Home für alle sechs Karten
   angefordert. RoomHero kann außerdem jeden navigierbaren Raum bei Nacht mit
   ausgeschalteten Lichtern zeigen; deshalb ist auch dark-off vollständig. */
export const START_SCREEN_HERO_ASSETS = [
  ...START_SCREEN_HERO_ROOMS.flatMap((room) => [
    `hero/${room}-dark.avif`,
    `hero/${room}-dark-off.avif`,
    `hero/${room}-light.avif`,
  ]),
  'hero/all-dark.avif',
  'hero/all-light.avif',
].sort();

/* Feste Masken der beiden Start-Shells. Geräte-spezifische Picker-Symbole und
   der 7.447 Einträge große MDI-Katalog bleiben absichtlich Runtime-Cache. */
export const START_SCREEN_MDI_ASSETS = [
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

export const START_SCREEN_PRECACHE_ASSETS = [
  ...START_SCREEN_HERO_ASSETS,
  ...START_SCREEN_MDI_ASSETS,
];

/* Diese Quellmodule werden auf dem produktiven Pfad zwingend vor dem ersten
   Phone-Mount geladen. Das Plugin markiert jedes Modul eindeutig und schreibt
   zusätzlich die von Rollup erzeugte dynamische Facade sowie den tatsächlichen
   Marker-Chunk in deterministische Build-Metadaten. */
export const REQUIRED_PRE_MOUNT_MODULE_SUFFIXES = [
  '/src/lib/config/household-config-runtime.ts',
  '/src/lib/shells/minimal-shell-loader.ts',
  '/src/lib/shells/MinimalAppShell.svelte',
  '/src/lib/state/standalone.svelte.ts',
  '/src/App.svelte',
  '/src/lib/state/ui-mode.svelte.ts',
  '/src/lib/state/nav.svelte.ts',
  '/src/lib/state/app.svelte.ts',
] as const;

const PRE_MOUNT_METADATA_FILE = 'hmi-performance-budget.json';

function cleanModuleId(id: string): string {
  return id.split('?', 1)[0].replaceAll('\\', '/');
}

function preMountSourceModule(suffix: string): string {
  return suffix.startsWith('/') ? suffix.slice(1) : suffix;
}

function preMountMarker(sourceModule: string): string {
  return `hmi-premount:required:${sourceModule}`;
}

const requiredPreMountMetadataPlugin: Plugin = {
  name: 'hmi-required-pre-mount-metadata',
  apply: 'build' as const,
  renderChunk(code, chunk) {
    const moduleIds = new Set(Object.keys(chunk.modules).map(cleanModuleId));
    const markers = REQUIRED_PRE_MOUNT_MODULE_SUFFIXES.flatMap((suffix, index) => {
      if (![...moduleIds].some((id) => id.endsWith(suffix))) return [];
      const sourceModule = preMountSourceModule(suffix);
      return [`export const __hmi_required_pre_mount_${index}__=${JSON.stringify(preMountMarker(sourceModule))};`];
    });
    if (markers.length === 0) return null;
    return { code: `${code}\n${markers.join('\n')}`, map: null };
  },
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
    const requiredPreMountEntries: Array<{
      sourceModule: string;
      marker: string;
      facade: string;
      markerChunk: string;
    }> = [];
    const generationErrors: string[] = [];

    for (const suffix of REQUIRED_PRE_MOUNT_MODULE_SUFFIXES) {
      const sourceModule = preMountSourceModule(suffix);
      const sourceIds = new Set(chunks.flatMap((chunk) => Object.keys(chunk.modules)
        .map(cleanModuleId)
        .filter((id) => id.endsWith(suffix))));
      const markerChunks = chunks.filter((chunk) => Object.keys(chunk.modules)
        .map(cleanModuleId)
        .some((id) => id.endsWith(suffix)));
      const facades = chunks.filter((chunk) => (
        chunk.isDynamicEntry
        && chunk.facadeModuleId !== null
        && cleanModuleId(chunk.facadeModuleId).endsWith(suffix)
      ));

      if (sourceIds.size !== 1 || markerChunks.length !== 1 || facades.length !== 1) {
        generationErrors.push(sourceModule);
        continue;
      }
      requiredPreMountEntries.push({
        sourceModule,
        marker: preMountMarker(sourceModule),
        facade: facades[0].fileName,
        markerChunk: markerChunks[0].fileName,
      });
    }

    const chunkCss = chunks
      .map((chunk) => {
        const viteChunk = chunk as typeof chunk & {
          viteMetadata?: { importedCss?: Set<string> };
        };
        return {
          chunk: chunk.fileName,
          files: [...(viteChunk.viteMetadata?.importedCss ?? [])].sort(),
        };
      })
      .sort((left, right) => left.chunk.localeCompare(right.chunk));
    const metadata = {
      schemaVersion: 2,
      requiredPreMountEntries,
      chunkCss,
      ...(generationErrors.length === 0 ? {} : { generationErrors }),
    };
    this.emitFile({
      type: 'asset',
      fileName: PRE_MOUNT_METADATA_FILE,
      source: `${JSON.stringify(metadata, null, 2)}\n`,
    });
  },
};

// Dev-Server auf 5173 lassen — 8123 bleibt der Phase-2-Referenz (prototype/)
// vorbehalten, damit beide für den Pixel-Vergleich parallel laufen können.
export default defineConfig({
  plugins: [
    svelte(),
    requiredPreMountMetadataPlugin,
    /* Mehrsprachigkeit (ADR-021): Paraglide übersetzt die Kataloge beim Bauen in
       Funktionen. Bewusst compilerbasiert statt Laufzeit-Wörterbuch — kein
       Nachschlagen beim Rendern, und ungenutzte Texte fallen beim Tree-Shaking
       raus. Das Performance-Budget (docs/03) bleibt unberührt.

       Keine `url`-Strategie: die HMI ist eine Kiosk-Oberfläche ohne Routing.
       Die Sprache kommt aus dem lokalen Speicher, sonst aus der Browsersprache,
       sonst Deutsch. */
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
      emitTsDeclarations: true,
    }),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      includeAssets: [
        'fonts/InterVariable-subset.woff2',
        'fonts/InstrumentSerif-subset.woff2',
        'icons/apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'brand/hauser-icon.svg',
        'manifest.webmanifest',
        ...START_SCREEN_PRECACHE_ASSETS,
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ambient-llm(?:\/|$)/],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        // Sichtbare Raum-/Hero-Bilder und MDI-Piktogramme werden bei Nutzung
        // cache-first gehalten. API-/Live-Daten bleiben ausdrücklich außen vor.
        runtimeCaching: [{
          urlPattern: /\/(?:hero|rooms|mdi-icons)\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'hmi-visual-assets-v1',
            expiration: { maxEntries: 160, maxAgeSeconds: 30 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }],
      },
    }),
  ],
  define: {
    __HAUSER_BUILD_INFO__: JSON.stringify(BUILD_INFO),
  },
  server: {
    fs: {
      // design-tokens/ liegt außerhalb des App-Roots (Single Source of Truth,
      // wird importiert, nicht kopiert)
      allow: ['..'],
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: CI_TEST_TIMEOUT,
    hookTimeout: CI_TEST_TIMEOUT,
  },
});
