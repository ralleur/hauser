/* ── Module an- und abschalten: die Schreib-Seite ──
   Geschrieben wird über einen schmalen Endpunkt (`PUT /api/household-modules/:id`,
   Muster der Raumbild-Zuweisung): ETag-gesichert und ohne
   Home-Assistant-Zugangsdaten in der Anfrage — der Server ändert `enabledModules`
   und die Navigation zusammen, sonst weist die Projektion die Konfiguration
   zurück (HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION). Die Navigation projiziert
   die App beim Start; nach dem Speichern meldet die Sektion deshalb einen
   nötigen Neustart. */

import { moduleConfig, type ToggleableModuleId } from './module-config.svelte.ts';

/* Notizen bringen zwei weitere Ziele mit (Einkaufsliste, Erinnerungen); sie
   hängen am selben Schalter — das entscheidet der Server. */
const COMPANION_MODULES: Partial<Record<ToggleableModuleId, readonly string[]>> = {
  notes: ['shopping', 'reminders'],
};

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
