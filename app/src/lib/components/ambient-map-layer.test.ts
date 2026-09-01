// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Quellvertrag des Ambient-Kartenlayers (docs/18 §3.1, §8, §11 S5).
   Der Layer ist reines CSS über einem fertigen Serverasset — es gibt keine
   Laufzeitlogik zu testen. Geprüft wird deshalb der Vertrag im Quelltext:
   genau ein Layer, Asset ausschließlich aus dem Client-State, exakte
   Token-Deckkraft, Tiefnacht ohne Karte und ohne Attribution, und die
   unveränderte Semantik der bestehenden Ambient-Bereiche. */

const layer = readFileSync(new URL('./AmbientLayer.svelte', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(
  new URL('../../../../design-tokens/tokens.css', import.meta.url), 'utf8');
const tokensJson = JSON.parse(readFileSync(
  new URL('../../../../design-tokens/tokens.json', import.meta.url), 'utf8')) as {
    tokens: { opacity?: { ambientMap?: { value?: string } } };
  };

describe('Ambient-Kartenlayer — Markup', () => {
  it('rendert genau einen dekorativen Layer ohne Pointer-Ziel', () => {
    expect(layer.match(/class="ambient-map"/g)).toHaveLength(1);
    expect(layer).toMatch(/<div class="ambient-map" aria-hidden="true"/);
  });

  it('bezieht die Asset-URL aus dem Client-State statt Inline-SVG zu bauen', () => {
    expect(layer).toMatch(/--ambient-map-src: url\('\{ambientMap\.assetUrl\}'\)/);
    expect(layer).not.toMatch(/<svg/);
    expect(layer).not.toMatch(/data:image\/svg/);
  });

  it('zeigt Layer und Attribution nur bei Schalter an, Asset vorhanden und außerhalb Deep Night', () => {
    expect(layer).toMatch(
      /const mapVisible = \$derived\(\s*settingsValues\.ambientCityMap && !deepNight && ambientMap\.assetUrl !== null,\s*\);/,
    );
    expect(layer.match(/\{#if mapVisible\}/g)).toHaveLength(2);
  });

  it('holt den Status idle bzw. beim Standby-Eintritt sofort und wartet nie', () => {
    expect(layer).toMatch(/ensureAmbientMapStatus\(\{ immediate: active \}\)/);
    expect(layer).not.toMatch(/await ensureAmbientMapStatus/);
    expect(layer).not.toMatch(/await .*ambientMap/);
  });

  it('zeigt die OSM-Attribution aus dem Katalog', () => {
    expect(layer).toMatch(/<p class="ambient-map-credit">\{m\.sys_map_attribution\(\)\}<\/p>/);
  });
});

describe('Ambient-Kartenlayer — CSS-Vertrag', () => {
  const rule = appCss.match(/\.ambient-map \{[\s\S]*?\}/)?.[0] ?? '';

  it('färbt mit der primären Schriftfarbe und exakt der Token-Deckkraft', () => {
    expect(rule).toMatch(/background:\s*var\(--color-text-primary\);/);
    expect(rule).toMatch(/opacity:\s*var\(--opacity-ambient-map\);/);
    expect(tokensCss).toMatch(/--opacity-ambient-map:\s*0\.1;/);
    expect(tokensJson.tokens.opacity?.ambientMap?.value).toBe('0.1');
  });

  it('maskiert mit derselben externen Asset-URL, deckend zentriert und ohne Wiederholung', () => {
    expect(rule).toMatch(/-webkit-mask-image:\s*var\(--ambient-map-src\);/);
    expect(rule).toMatch(/[^-]mask-image:\s*var\(--ambient-map-src\);/);
    expect(rule).toMatch(/mask-size:\s*cover;/);
    expect(rule).toMatch(/mask-position:\s*center;/);
    expect(rule).toMatch(/mask-repeat:\s*no-repeat;/);
  });

  it('bleibt auf die Ambient-Fläche begrenzt, hinter dem Inhalt und ohne Pointer-Ziel', () => {
    expect(rule).toMatch(/position:\s*absolute;/);
    expect(rule).toMatch(/inset:\s*0;/);
    expect(rule).toMatch(/z-index:\s*-1;/);
    expect(rule).toMatch(/pointer-events:\s*none;/);
    expect(rule).not.toMatch(/filter|backdrop-filter|animation|transition/);
  });

  it('blendet Karte und Attribution in Deep Night vollständig aus', () => {
    expect(appCss).toMatch(
      /\.ambient\.deep-night \.ambient-map,\s*\.ambient\.deep-night \.ambient-map-credit \{ display: none; \}/,
    );
  });

  it('hält die Attribution lesbar, aber außerhalb der Maskenopacity und ohne Tap-Ziel', () => {
    const credit = appCss.match(/^\.ambient-map-credit \{[\s\S]*?\}/m)?.[0] ?? '';
    expect(credit).toMatch(/pointer-events:\s*none;/);
    /* S6/B2: `--color-text-tertiary` ist in docs/01-design-system.md ausdrücklich
       auf nicht-essenzielle Labels ab 14px begrenzt. Die ODbL-Attribution ist
       rechtlich verpflichtend, also bedeutungstragend — sie nutzt daher das dort
       belegte Mikro-Label-Paar aus `--text-2xs` und `--color-text-secondary`. */
    expect(credit).toMatch(/font-size:\s*var\(--text-2xs\);/);
    expect(credit).toMatch(/color:\s*var\(--color-text-secondary\);/);
    expect(credit).not.toMatch(/--color-text-tertiary/);
    expect(credit).not.toMatch(/opacity:/);
  });
});

describe('Ambient-Kartenlayer — bestehende Semantik unverändert', () => {
  it('lässt die Weckzonen des Ambient-Screens unangetastet', () => {
    expect(layer).toMatch(/hit\.closest\('\.ambient-week'\) \? 'calendar'/);
    expect(layer).toMatch(/hit\.closest\('\.ambient-postits, \.ambient-shopping'\) \? 'notes'/);
  });

  it('lässt Kalender, Post-its, Einkaufsliste und Tageskommentar unverändert bedingt', () => {
    expect(layer).toMatch(/\{#if weekHasEvents && !deepNight\}/);
    expect(layer).toMatch(/\{#if postits\.items\.length && !deepNight\}/);
    expect(layer).toMatch(/\{#if shoppingSections\.length && !deepNight\}/);
    expect(layer).toMatch(/\{#if settingsValues\.ambientHeroText\}/);
  });
});
