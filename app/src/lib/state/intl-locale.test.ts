import { describe, expect, it } from 'vitest';
import { resolveIntlTag } from './locale.svelte.ts';

describe('resolveIntlTag', () => {
  it('nimmt die Region des Geräts, wenn ihre Sprache zur Oberfläche passt', () => {
    expect(resolveIntlTag('en', ['en-US', 'de-DE'])).toBe('en-US');
    expect(resolveIntlTag('en', ['de-DE', 'en-AU'])).toBe('en-AU');
    expect(resolveIntlTag('de', ['de-AT'])).toBe('de-AT');
    expect(resolveIntlTag('pt', ['pt-BR'])).toBe('pt-BR');
  });

  it('fällt auf die Vorgabe je Sprache zurück, wenn keine Gerätesprache passt', () => {
    expect(resolveIntlTag('en', ['de-DE', 'fr-FR'])).toBe('en-GB');
    expect(resolveIntlTag('en', [])).toBe('en-GB');
    expect(resolveIntlTag('de', ['en-US'])).toBe('de-DE');
    expect(resolveIntlTag('pl')).toBe('pl-PL');
  });

  it('ignoriert Gerätesprachen ohne Region und unbekannte Sprachen', () => {
    expect(resolveIntlTag('en', ['en'])).toBe('en-GB');
    expect(resolveIntlTag('xx', ['xx-YY'])).toBe('de-DE');
  });

  it('formatiert das Datum je Region unterschiedlich', () => {
    const date = new Date(2026, 8, 2, 17, 5);
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };
    expect(date.toLocaleDateString(resolveIntlTag('en', ['en-US']), options)).toBe('Wednesday, September 2');
    expect(date.toLocaleDateString(resolveIntlTag('en', []), options)).toBe('Wednesday 2 September');
    expect(date.toLocaleDateString(resolveIntlTag('de', []), options)).toBe('Mittwoch, 2. September');
  });
});
