import { FakeBackend } from '../adapter/fake-backend.ts';
import { HaBackend } from '../adapter/ha-backend.ts';
import {
  seed,
  backend,
  configuredHaTransport,
  configuredHaUrl,
  rememberHaTransport,
  setBackend,
} from '../adapter/runtime.svelte.ts';
import { HOUSEHOLD_RUNTIME_MODEL } from '../config/household-runtime-data.ts';

const HA_TRANSPORT_TIMEOUT_MS = 3_000;

/* Cutover im Browser: sobald dieser Server intern verbindet, hat ein früher
 * eingegebener Long-Lived Access Token hier nichts mehr zu suchen. Direkte
 * Installationen bleiben unberührt, weil sie diesen Zweig nie erreichen. */
function forgetBrowserHaCredentials(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem('hmi:ha-token');
    localStorage.removeItem('hmi:ha-url');
  } catch { /* Ohne Storage gibt es auch nichts zu entfernen. */ }
}

export function configuredBackendKind(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  envBackend: string | undefined = import.meta.env?.VITE_BACKEND as string | undefined,
): 'fake' | 'ha' {
  if (envBackend === 'fake') return 'fake';
  if (!storage) return typeof window === 'undefined' ? 'fake' : 'ha';
  try {
    return storage?.getItem('hmi:backend') === 'fake' ? 'fake' : 'ha';
  } catch {
    return 'ha';
  }
}

/** Nach Shared-Config-Sync den provisorischen Backendtyp korrigieren, bevor
 * irgendein externer Verbindungsaufbau beginnt. */
export function syncConfiguredBackend(): void {
  const kind = configuredBackendKind();
  if ((kind === 'fake') === (backend instanceof FakeBackend)) return;
  setBackend(kind === 'fake'
    ? new FakeBackend(seed)
    : new HaBackend({
        url: () => configuredHaUrl(),
        transport: () => configuredHaTransport(),
        entityIds: HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds,
        seed: seed,
      }));
}

/* B-27 A2: Auf einem eingerichteten Gerät liegen Token und HA-URL bereits
   lokal — die HA-Verbindung muss dann nicht auf die Shared Config warten.
   Fehlt eines von beiden, bleibt es bei der bisherigen Reihenfolge: ein frisch
   eingerichtetes Gerät startete sonst mit `missing-token` und zeigte kurz den
   Login. Der Backendtyp muss ebenfalls schon lokal feststehen, sonst würde ein
   Demo-Gerät vor dem Sync gegen echtes HA verbinden. */
export function haCredentialsAvailableLocally(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): boolean {
  if (!storage) return false;
  try {
    if (configuredBackendKind(storage) !== 'ha') return false;
    if (configuredHaTransport(storage) === 'gateway') return true;
    return !!storage.getItem('hmi:ha-token')?.trim() && !!storage.getItem('hmi:ha-url')?.trim();
  } catch {
    return false;
  }
}

/** Betriebsart des Live-Kanals vom Server übernehmen, bevor der Backend-Start
 * eine Verbindung aufbaut. Scheitert die Auskunft, bleibt der zuletzt bekannte
 * Wert stehen — geraten wird nichts. */
export async function syncHaTransport(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const response = await fetcher('/api/ha/connection', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      /* Eine hängende lokale API darf den Verbindungsaufbau nicht sperren. */
      signal: signal ?? AbortSignal.timeout(HA_TRANSPORT_TIMEOUT_MS),
    });
    if (!response.ok) return;
    const payload = await response.json() as { mode?: unknown };
    const transport = payload.mode === 'supervisor' ? 'gateway' : 'direct';
    rememberHaTransport(transport);
    if (transport === 'gateway') forgetBrowserHaCredentials();
  } catch { /* Ohne Auskunft bleibt der zuletzt bekannte Kanal gültig. */ }
}
