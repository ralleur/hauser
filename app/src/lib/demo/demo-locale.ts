// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale } from '../../paraglide/runtime.js';

/** Sample content is German or English; the interface keeps its own locale. */
export function demoLocale(): 'de' | 'en' {
  return getLocale() === 'de' ? 'de' : 'en';
}

export function demoText(german: string, english: string): string {
  return demoLocale() === 'de' ? german : english;
}

export function demoMessage(message: (inputs?: {}, options?: { locale?: 'de' | 'en' }) => string): string {
  return message({}, { locale: demoLocale() });
}
