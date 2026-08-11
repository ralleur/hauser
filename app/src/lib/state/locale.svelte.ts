/* ============================================
   Sprachwahl (ADR-021).

   Paraglide löst die Texte beim Bauen auf; `m.*()` liest die aktive Sprache
   erst beim Aufruf. Damit ein Wechsel ohne Neuladen sichtbar wird, hält dieses
   Modul die Sprache zusätzlich als reaktiven Zustand — App.svelte hängt daran
   ein `{#key}`, das die Oberfläche einmal neu aufbaut.

   Neuladen wäre der einfachere Weg, ist im Kiosk-Betrieb aber falsch: das Panel
   hängt dauerhaft an der Wand, ein Full Reload würde Verbindung, Entity-Cache
   und laufende Overlays wegwerfen.
   ============================================ */

import { getLocale, setLocale, locales, baseLocale } from '../../paraglide/runtime.js';

export type AppLocale = (typeof locales)[number];

/* Eigenbezeichnung, nicht übersetzt: eine Sprachliste soll in der eigenen
   Sprache lesbar sein, egal welche gerade aktiv ist. */
export const LOCALE_LABELS: Readonly<Record<string, string>> = {
  de: 'Deutsch',
  en: 'English',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  pl: 'Polski',
};

export const AVAILABLE_LOCALES: readonly AppLocale[] = locales;

function readLocale(): AppLocale {
  try {
    return getLocale();
  } catch {
    return baseLocale;
  }
}

export const localeState = $state({ current: readLocale() as AppLocale });

export function localeLabel(locale: string): string {
  return LOCALE_LABELS[locale] ?? locale;
}

/** Wechselt die Sprache, ohne das Dokument neu zu laden. */
export async function changeLocale(
  next: AppLocale,
  options: { syncDemoNames?: boolean } = {},
): Promise<void> {
  if (next === localeState.current) return;
  await setLocale(next, { reload: false });
  localeState.current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;

  // Im First-Run-Wizard existiert der produktive App-State noch nicht. Die
  // Sprachwahl muss dort persistieren, ohne ihn vor dem Config-Bootstrap zu laden.
  if (options.syncDemoNames === false) return;

  // Demo-Namen hängen an der Sprache, nicht am Katalog — neu setzen.
  const [{ applyDemoNames }, { appState }] = await Promise.all([
    import('../demo/demo-names.ts'),
    import('./app.svelte.ts'),
  ]);
  applyDemoNames(appState.rooms);
}

/** Einmalig beim Start: `lang` am Dokument spiegeln (Screenreader, Silbentrennung). */
export function initLocale(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = localeState.current;
}

/* Für Intl-Formatierer: Datum, Uhrzeit und Zahlen folgen der Oberfläche.
   Ohne das bliebe die Uhr deutsch, obwohl die Texte übersetzt sind. */
const INTL_TAGS: Readonly<Record<string, string>> = {
  de: 'de-DE', en: 'en-GB', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', pl: 'pl-PL',
};

export function intlLocale(): string {
  return INTL_TAGS[readLocale()] ?? 'de-DE';
}

/* Pluralkategorie der aktiven Sprache. Das Katalogformat kennt keine
   ICU-Plurale, und die Sprachen unterscheiden sich stark: Deutsch und Englisch
   haben zwei Formen, Polnisch vier (1 okno / 2–4 okna / 5+ okien / Bruchteile).
   Intl.PluralRules kennt die Regeln bereits — der Katalog hält je Kategorie
   eine Fassung, hier wird nur ausgewählt. */
export type PluralCategory = 'one' | 'two' | 'few' | 'many' | 'other';

export function pluralCategory(count: number): PluralCategory {
  try {
    return new Intl.PluralRules(intlLocale()).select(count) as PluralCategory;
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}
