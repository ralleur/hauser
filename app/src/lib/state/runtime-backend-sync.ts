import { FakeBackend } from '../adapter/fake-backend.ts';
import { HaBackend } from '../adapter/ha-backend.ts';
import {
  seed,
  backend,
  configuredHaUrl,
  setBackend,
} from '../adapter/runtime.svelte.ts';
import { HOUSEHOLD_RUNTIME_MODEL } from '../config/household-runtime-data.ts';

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
        entityIds: HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds,
        seed: seed,
      }));
}
