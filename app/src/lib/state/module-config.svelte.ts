/* ── Module an- und abschalten ──
   Ein Modul ist ein Screen: Energie, Kalender, Notizen, Media, Bibliothek,
   Ablage. Was aktiv ist, steht in der Haushalts-Konfiguration
   (`enabledModules` plus der zugehörige Navigationseintrag) — beides muss
   zusammenpassen, sonst weist die Projektion die Konfiguration zurück
   (HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION).

   Geschrieben wird über einen schmalen Endpunkt (`PUT /api/household-modules/:id`,
   Muster der Raumbild-Zuweisung): ETag-gesichert und ohne
   Home-Assistant-Zugangsdaten in der Anfrage — der Server ändert beide Listen
   zusammen. Die Navigation projiziert die App beim Start; nach dem Speichern
   meldet die Sektion deshalb einen nötigen Neustart. */

import { ENABLED_MODULES } from '../config/household-runtime-data.ts';

/** Module, die dieser Bildschirm ein- und ausschalten darf. */
export const TOGGLEABLE_MODULES = ['energy', 'calendar', 'notes', 'media', 'library', 'ablage'] as const;
export type ToggleableModuleId = typeof TOGGLEABLE_MODULES[number];

/* Notizen bringen zwei weitere Ziele mit (Einkaufsliste, Erinnerungen); sie
   hängen am selben Schalter — das entscheidet der Server. */
const COMPANION_MODULES: Partial<Record<ToggleableModuleId, readonly string[]>> = {
  notes: ['shopping', 'reminders'],
};

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

/** Schaltet ein Modul um und schreibt die Konfiguration zurück. */
export async function setModuleEnabled(
  id: ToggleableModuleId,
  enabled: boolean,
  label: string,
): Promise<boolean> {
  moduleConfig.busy = id;
  moduleConfig.error = null;
  try {
    // Der ETag stammt aus dem gelesenen Stand: er verhindert, dass zwei Geräte
    // gleichzeitig unterschiedliche Modullisten schreiben.
    const current = await fetch('/api/household-config', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!current.ok) throw new Error('HOUSEHOLD_CONFIG_UNREACHABLE');
    await current.text();
    const etag = current.headers.get('etag');
    if (!etag) throw new Error('HOUSEHOLD_CONFIG_ETAG_MISSING');

    const written = await fetch(`/api/household-modules/${encodeURIComponent(id)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify({ enabled, name: label }),
    });
    if (!written.ok) throw new Error('HOUSEHOLD_CONFIG_WRITE_FAILED');

    if (enabled) {
      moduleConfig.enabled.add(id);
      for (const companion of COMPANION_MODULES[id] ?? []) moduleConfig.enabled.add(companion);
    } else {
      moduleConfig.enabled.delete(id);
      for (const companion of COMPANION_MODULES[id] ?? []) moduleConfig.enabled.delete(companion);
    }
    // Set neu zuweisen, damit Svelte die Änderung sieht.
    moduleConfig.enabled = new Set(moduleConfig.enabled);
    moduleConfig.saved = true;
    return true;
  } catch (error) {
    moduleConfig.error = error instanceof Error ? error.message : 'HOUSEHOLD_CONFIG_WRITE_FAILED';
    return false;
  } finally {
    moduleConfig.busy = null;
  }
}
