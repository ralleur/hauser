/* Die Textprüfungen im Testlauf sind auf Deutsch geschrieben. Seit die
   Oberfläche ohne gespeicherte Wahl und ohne passende Browsersprache auf
   Englisch fällt (ADR-021, `baseLocale = "en"`), würde der Testlauf sonst
   englische Texte sehen. Er setzt die Sprache deshalb ausdrücklich — die
   Strategiekette selbst ist Paraglides Sache, nicht Gegenstand dieser Tests. */

import { overwriteGetLocale } from './paraglide/runtime.js';

overwriteGetLocale(() => 'de');
