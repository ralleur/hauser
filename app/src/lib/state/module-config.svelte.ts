/* ── Module an- und abschalten: die Lese-Seite ──
   Ein Modul ist ein Screen: Energie, Kalender, Notizen, Media, Bibliothek,
   Ablage. Was aktiv ist, steht in der Haushalts-Konfiguration
   (`enabledModules` plus der zugehörige Navigationseintrag).

   Der Startpfad fragt nur, ob ein Navigationsziel sichtbar ist. Das Schreiben
   (`module-config-write.ts`) lädt erst, wer die Dienste-Einstellungen
   öffnet (ADR-029). */

import { ENABLED_MODULES } from '../config/household-runtime-data.ts';

/** Module, die dieser Bildschirm ein- und ausschalten darf. */
export const TOGGLEABLE_MODULES = ['energy', 'calendar', 'notes', 'media', 'library', 'ablage'] as const;
export type ToggleableModuleId = typeof TOGGLEABLE_MODULES[number];

export const moduleConfig = $state({
  enabled: new Set<string>(ENABLED_MODULES),
  busy: null as string | null,
  error: null as string | null,
  saved: false,
});

export function moduleEnabled(id: ToggleableModuleId): boolean {
  return moduleConfig.enabled.has(id);
}

/* Sichtbarkeit eines Navigationsziels. Home und System stehen nie zur
   Wahl; alles andere folgt dem Schalter — und zwar sofort, ohne Neustart:
   die Projektion beim Start setzt denselben Stand noch einmal. */
export function moduleVisible(id: string): boolean {
  if (!(TOGGLEABLE_MODULES as readonly string[]).includes(id)) return true;
  return moduleConfig.enabled.has(id);
}

/* Die Phone-Ziele decken sich nicht eins zu eins mit den Modulen: Notizen
   teilen sich in Einkaufsliste und Erinnerungen, und „Media" führt sowohl in
   die Bibliothek als auch in die Mediensteuerung. */
export function phoneTargetVisible(target: string): boolean {
  if (target === 'shopping' || target === 'reminders') return moduleVisible('notes');
  if (target === 'media') return moduleVisible('library') || moduleVisible('media');
  return moduleVisible(target);
}
