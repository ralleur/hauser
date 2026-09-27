// @ts-expect-error Native Node test without @types/node.
import { readFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { dirname, join } from 'node:path';
// @ts-expect-error Native Node test without @types/node.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* Jede Sprache hat jeden Text. Fehlt ein Schlüssel, zeigt Paraglide still
   den englischen Text — das fällt erst auf, wenn jemand in dieser Sprache
   vor dem Panel steht. Neue Texte kommen deshalb in alle Kataloge aus
   project.inlang, nicht nur in die, die man gerade im Kopf hat. Platzhalter
   müssen mitkommen: ohne `{mark}` fehlt das Symbol im Satz, ohne `{count}`
   die Zahl. */

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const settings = JSON.parse(readFileSync(join(APP, 'project.inlang', 'settings.json'), 'utf8'));
const catalogue = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(APP, 'messages', `${locale}.json`), 'utf8'));
const base = catalogue(settings.baseLocale);
const keys = Object.keys(base).filter((key) => key !== '$schema');
const placeholders = (text: unknown): string =>
  [...new Set(String(text).match(/\{[A-Za-z0-9_]+\}/g) ?? [])].sort().join(' ');

describe('Sprachkataloge', () => {
  for (const locale of settings.locales as string[]) {
    if (locale === settings.baseLocale) continue;
    const messages = catalogue(locale);

    it(`${locale} hat jeden Text des Grundkatalogs`, () => {
      expect(keys.filter((key) => typeof messages[key] !== 'string' || !String(messages[key]).trim())).toEqual([]);
    });

    it(`${locale} behält die Platzhalter`, () => {
      expect(keys.filter((key) => key in messages && placeholders(messages[key]) !== placeholders(base[key]))).toEqual([]);
    });
  }
});
