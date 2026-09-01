// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/* Quellvertrag des Ambient-Kartenlayers (docs/18 §3.1, §8, §11 S5).
   Der Layer ist reines CSS über einem fertigen Serverasset — es gibt keine
   Laufzeitlogik zu testen. Geprüft wird deshalb der Vertrag im Quelltext:
   genau ein Layer, Asset ausschließlich aus dem Client-State, exakte
   Token-Deckkraft, Tiefnacht ohne Karte, und die
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

  it('zeigt den Layer nur bei Schalter an, Asset vorhanden und außerhalb Deep Night', () => {
    expect(layer).toMatch(
      /const mapVisible = \$derived\(\s*\(settingsValues\.ambientCityMap \|\| settingsPreview\)\s*&& !deepNight && ambientMap\.assetUrl !== null,\s*\);/,
    );
    // Genau ein bedingter Block: die Namensnennung ist aus dem Bild gewandert.
    expect(layer.match(/\{#if mapVisible\}/g)).toHaveLength(1);
  });

  /* Eine Vorschau, die den Stadtplan nicht zeigt, kuendigt nichts an — und sie
     gehoert dorthin zurueck, von wo sie gestartet wurde, nicht auf den
     Homescreen. Beide Vorschauen wecken deshalb an Ort und Stelle. */
  it('zeigt die Karte auch in der Einstellungsvorschau und weckt an Ort und Stelle', () => {
    expect(layer).toMatch(/let settingsPreview = \$state\(false\);/);
    expect(layer).toMatch(/if \(deepNightPreview \|\| settingsPreview\) \{\s*wakeAmbient\(\);/);
    expect(layer).toMatch(/ambientRequest\.mode === 'preview'/);
  });

  it('holt den Status idle bzw. beim Standby-Eintritt sofort und wartet nie', () => {
    expect(layer).toMatch(/ensureAmbientMapStatus\(\{ immediate: active \}\)/);
    expect(layer).not.toMatch(/await ensureAmbientMapStatus/);
    expect(layer).not.toMatch(/await .*ambientMap/);
  });

  /* Owner-Entscheidung: Die OSM-Namensnennung steht NICHT im Bild, sondern
     sichtbar in den Einstellungen und im NOTICE. Der Standby ist eine rein
     dekorative Flaeche ohne Bedienung; OpenStreetMaps Richtlinie erlaubt fuer
     solche nicht-interaktiven Werke die Nennung dort, wo Credits ueblich sind.
     Der Test haelt beide Haelften fest — im Bild nicht, in den Einstellungen
     schon —, damit die Pflichtangabe nicht unbemerkt ganz verschwindet. */
  it('führt die OSM-Namensnennung in den Einstellungen statt im Standby', () => {
    expect(layer).not.toMatch(/ambient-map-credit/);
    expect(layer).not.toMatch(/sys_map_attribution/);
    const section = readFileSync(
      new URL('./settings/AmbientSection.svelte', import.meta.url),
      'utf8',
    );
    expect(section).toMatch(/settings-note-license/);
    expect(section).toMatch(/m\.sys_map_license\(\)/);
    expect(section).toMatch(/openstreetmap\.org\/copyright/);
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

  it('blendet die Karte in Deep Night vollständig aus', () => {
    expect(appCss).toMatch(
      /\.ambient\.deep-night \.ambient-map \{ display: none; \}/,
    );
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
