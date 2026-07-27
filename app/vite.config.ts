import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { VitePWA } from 'vite-plugin-pwa';

// Dev-Server auf 5173 lassen — 8123 bleibt der Phase-2-Referenz (prototype/)
// vorbehalten, damit beide für den Pixel-Vergleich parallel laufen können.
export default defineConfig({
  plugins: [
    svelte(),
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
        'manifest.webmanifest',
      ],
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ambient-llm(?:\/|$)/],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
    }),
  ],
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
  },
});
