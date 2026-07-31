const SHARED_CONFIG_OUTBOX_KEY = 'hmi:shared-config-outbox:v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

let activeStorage: StorageLike | null = null;
let journal = '';
let requestDrain: (() => void) | null = null;
let acceptsSharedKey: ((key: string) => boolean) | null = null;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function storageGet(storage: StorageLike, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

function storageSet(storage: StorageLike, key: string, value: string): void {
  try { storage.setItem(key, value); } catch { /* In-memory-Journal bleibt aktiv. */ }
}

function storageRemove(storage: StorageLike, key: string): void {
  try { storage.removeItem(key); } catch { /* In-memory-Journal bleibt aktiv. */ }
}

function activateStorage(storage: StorageLike): void {
  if (activeStorage === storage) return;
  activeStorage = storage;
  journal = storageGet(storage, SHARED_CONFIG_OUTBOX_KEY) ?? '';
  requestDrain = null;
  acceptsSharedKey = null;
}

/** Öffnet das synchrone Journal mit geschlossener Netzwerk-Barriere. */
export function beginSharedConfigOutbox(storage: StorageLike | null): void {
  if (storage) activateStorage(storage);
  requestDrain = null;
}

export function readSharedConfigOutbox(storage: StorageLike): string | null {
  return activeStorage === storage ? journal : null;
}

export function connectSharedConfigOutbox(
  storage: StorageLike,
  drain: () => void,
  acceptsKey: (key: string) => boolean,
): void {
  if (activeStorage === storage) {
    requestDrain = drain;
    acceptsSharedKey = acceptsKey;
  }
}

/** Hängt vor jedem Netzwerkzugriff genau ein durable Event an. */
export function recordSharedConfigUpdate(
  storage: StorageLike,
  key: string,
  value: string | null,
): void {
  activateStorage(storage);
  if (acceptsSharedKey && !acceptsSharedKey(key)) return;
  journal += `${journal ? '\n' : ''}${JSON.stringify([key, value])}`;
  storageSet(storage, SHARED_CONFIG_OUTBOX_KEY, journal);
  requestDrain?.();
}

export function acknowledgeSharedConfigOutbox(
  storage: StorageLike,
  snapshot: string,
): void {
  if (activeStorage !== storage) return;
  if (journal === snapshot) journal = '';
  else if (journal.startsWith(`${snapshot}\n`)) journal = journal.slice(snapshot.length + 1);
  else return;
  if (journal) storageSet(storage, SHARED_CONFIG_OUTBOX_KEY, journal);
  else storageRemove(storage, SHARED_CONFIG_OUTBOX_KEY);
}

export function clearSharedConfigOutbox(storage: StorageLike): void {
  if (activeStorage !== storage) return;
  journal = '';
  storageRemove(storage, SHARED_CONFIG_OUTBOX_KEY);
}

/**
 * Synchroner Storage-Seam für bestehende App-Stores: lokal sofort wirksam,
 * mit durable Outbox vor jedem zentralen Best-effort-Write. Parsing, Recovery,
 * GET und PUT liegen vollständig im post-paint geladenen Bootstrap-Modul.
 */
export const sharedStorage: StorageLike = {
  getItem(key: string): string | null {
    const storage = browserStorage();
    return storage ? storageGet(storage, key) : null;
  },
  setItem(key: string, value: string): void {
    const storage = browserStorage();
    if (storage) storageSet(storage, key, value);
    if (storage) recordSharedConfigUpdate(storage, key, value);
  },
  removeItem(key: string): void {
    const storage = browserStorage();
    if (storage) storageRemove(storage, key);
    if (storage) recordSharedConfigUpdate(storage, key, null);
  },
};
