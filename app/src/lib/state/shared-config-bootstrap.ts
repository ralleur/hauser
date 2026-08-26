import {
  acknowledgeSharedConfigOutbox,
  beginSharedConfigOutbox,
  clearSharedConfigOutbox,
  connectSharedConfigOutbox,
  readSharedConfigOutbox,
  recordSharedConfigUpdate,
  type StorageLike,
} from './shared-config.ts';

export const SHARED_CONFIG_KEYS = [
  'hmi:backend',
  'hmi:ha-url',
  'hmi:ha-token',
  'hmi:jf-url',
  'hmi:jf-token',
  'hmi:jf-user',
  'hmi:library',
  'hmi:lock-button',
  'hmi:device-config:v1',
  'hmi:scene-config:v1',
  'hmi:home-layout:v1',
  'hmi:light-icon-overrides:v1',
  'hmi:immersion-light:v1',
  'hmi:calendar-selected',
  'hmi:reminders-selected',
  'hmi:shopping-config:v1',
  'hmi:reminder-persons:v1',
] as const;

type FetchLike = typeof fetch;
type SharedConfigOutbox = {
  acknowledge: typeof acknowledgeSharedConfigOutbox;
  begin: typeof beginSharedConfigOutbox;
  clear: typeof clearSharedConfigOutbox;
  connect: typeof connectSharedConfigOutbox;
  read: typeof readSharedConfigOutbox;
  record: typeof recordSharedConfigUpdate;
};
type PendingUpdates = Map<string, string | null>;

const sharedConfigOutbox: SharedConfigOutbox = {
  acknowledge: acknowledgeSharedConfigOutbox,
  begin: beginSharedConfigOutbox,
  clear: clearSharedConfigOutbox,
  connect: connectSharedConfigOutbox,
  read: readSharedConfigOutbox,
  record: recordSharedConfigUpdate,
};
const keys = new Set<string>(SHARED_CONFIG_KEYS);
let bootstrapGeneration = 0;
let activeFlush: Promise<void> | null = null;
let activeFlushGeneration = 0;

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function storageGet(storage: StorageLike, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

function storageSet(storage: StorageLike, key: string, value: string): void {
  try { storage.setItem(key, value); } catch { /* Journal bleibt maßgeblich. */ }
}

function storageRemove(storage: StorageLike, key: string): void {
  try { storage.removeItem(key); } catch { /* Journal bleibt maßgeblich. */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && (value as { constructor?: unknown }).constructor === Object;
}

/** Liest sowohl das bisherige Envelope als auch das append-only Eventjournal. */
function parseJournal(raw: string): PendingUpdates | null {
  const updates: PendingUpdates = new Map();
  if (!raw) return updates;

  try {
    for (const [index, line] of raw.split('\n').entries()) {
      const candidate: unknown = JSON.parse(line);
      if (index === 0 && isRecord(candidate) && candidate.version === 1) {
        if (!Number.isSafeInteger(candidate.sequence)
          || (candidate.sequence as number) < 0
          || !isRecord(candidate.updates)) return null;
        for (const [key, update] of Object.entries(candidate.updates)) {
          if (!keys.has(key)
            || !isRecord(update)
            || (typeof update.value !== 'string' && update.value !== null)
            || !Number.isSafeInteger(update.revision)
            || (update.revision as number) <= 0
            || (update.revision as number) > (candidate.sequence as number)) return null;
          updates.set(key, update.value as string | null);
        }
        continue;
      }
      if (!Array.isArray(candidate)
        || candidate.length !== 2
        || typeof candidate[0] !== 'string'
        || (typeof candidate[1] !== 'string' && candidate[1] !== null)) return null;
      if (!keys.has(candidate[0])) continue;
      updates.set(candidate[0], candidate[1]);
    }
    return updates;
  } catch {
    return null;
  }
}

/**
 * Sendet Journal-Snapshots seriell. Neuere Events bleiben während eines PUTs
 * erhalten und bilden den nächsten coalesced Snapshot. Nach einem Fehler endet
 * der Lauf; ein Retry beginnt erst beim nächsten Bootstrap oder Write.
 */
async function flushPendingUpdates(
  fetcher: FetchLike,
  generation: number,
  storage: StorageLike,
  outbox: SharedConfigOutbox,
  signal?: AbortSignal,
): Promise<void> {
  while (generation === bootstrapGeneration && !signal?.aborted) {
    const snapshot = outbox.read(storage);
    if (snapshot === null || !snapshot) return;
    const pending = parseJournal(snapshot);
    if (!pending) {
      outbox.clear(storage);
      return;
    }
    if (!pending.size) {
      outbox.acknowledge(storage, snapshot);
      return;
    }

    let response: Response;
    try {
      response = await fetcher('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: Object.fromEntries(pending) }),
        signal,
      });
    } catch {
      return;
    }
    if (!response.ok
      || generation !== bootstrapGeneration
      || outbox.read(storage) === null
      || signal?.aborted) return;
    outbox.acknowledge(storage, snapshot);
    // Ein weiterer Durchlauf folgt nur auf eine bestätigte Serverantwort.
  }
}

function requestFlush(
  fetcher: FetchLike,
  generation: number,
  storage: StorageLike,
  outbox: SharedConfigOutbox,
  signal?: AbortSignal,
): Promise<void> {
  if (activeFlush) {
    return generation === activeFlushGeneration
      ? activeFlush
      : activeFlush.then(() => requestFlush(fetcher, generation, storage, outbox, signal));
  }

  const promise = flushPendingUpdates(fetcher, generation, storage, outbox, signal);
  activeFlush = promise;
  activeFlushGeneration = generation;
  void promise.finally(() => {
    if (activeFlush === promise) activeFlush = null;
  });
  return promise;
}

/**
 * Lädt die zentrale Konfiguration nach dem ersten Paint, aber vor dem Start
 * externer Backends. Ein durable Pending-Event gewinnt gegen den GET-Stand.
 * Ohne Pending gewinnt ein vorhandener Serverwert; nur serverseitig fehlende
 * lokale Altwerte werden einmalig über dieselbe Outbox migriert.
 */
export async function bootstrapSharedConfig(
  fetcher: FetchLike = fetch,
  storage: StorageLike | null = browserStorage(),
  signal?: AbortSignal,
  outbox: SharedConfigOutbox = sharedConfigOutbox,
): Promise<void> {
  const generation = ++bootstrapGeneration;
  outbox.begin(storage);
  if (!storage) return;

  try {
    const response = await fetcher('/api/config', {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return;
    const payload = await response.json() as { values?: Record<string, unknown> };
    if (signal?.aborted
      || generation !== bootstrapGeneration
      || outbox.read(storage) === null) return;
    const values = payload.values && typeof payload.values === 'object' ? payload.values : {};
    let pending = parseJournal(outbox.read(storage) ?? '');
    if (!pending) {
      outbox.clear(storage);
      pending = new Map();
    }

    for (const key of SHARED_CONFIG_KEYS) {
      if (pending.has(key)) {
        const value = pending.get(key);
        if (value === null) storageRemove(storage, key);
        else storageSet(storage, key, value!);
        continue;
      }

      const central = values[key];
      if (typeof central === 'string') {
        storageSet(storage, key, central);
        continue;
      }

      const local = storageGet(storage, key);
      if (local !== null) outbox.record(storage, key, local);
    }

    const drain = () => {
      void requestFlush(fetcher, generation, storage, outbox, signal);
    };
    outbox.connect(storage, drain, (key) => keys.has(key));
    await requestFlush(fetcher, generation, storage, outbox, signal);
  } catch {
    // Server/Storage nicht erreichbar: lokaler Stand und Outbox bleiben nutzbar.
  }
}
