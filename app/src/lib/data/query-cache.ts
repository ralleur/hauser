/* ── Datenschicht: Snapshot-Cache mit Staleness ──

   Jede Leseabfrage (Kalender, Erinnerungen, Einkaufsliste, Bibliothek …)
   bekommt einen Snapshot-Speicher: beim Start wird der letzte Stand sofort
   gezeigt, im Hintergrund wird revalidiert. Zwei Speicherstufen:

   - `local`      — localStorage, synchron lesbar. Für kleine Snapshots, die
                    beim ersten Frame da sein sollen (Listen mit wenigen KB).
   - `indexeddb`  — IndexedDB, asynchron, ohne die 5-MB-Grenze. Für große
                    Stände wie die Jellyfin-Bibliothek.

   Beide Stufen legen dieselbe Hülle ab (`{ v, updatedAt, value }`) und fallen
   ohne Browser-Speicher (Vitest, Private Mode, volle Quota) auf eine
   prozessweite Map zurück, damit Aufrufer nie auf Speicherfehler prüfen
   müssen. Staleness ist eine Eigenschaft des Snapshots (Alter gegen
   `maxAgeMs`), die Revalidierung übernimmt `revalidation.ts`. */

export interface SnapshotEnvelope<T> {
  v: number;
  updatedAt: number;
  value: T;
}

export type SnapshotTier = 'local' | 'indexeddb';

export interface SnapshotStoreOptions<T> {
  key: string;
  /** Schemaversion des Snapshots; ein anderer Wert verwirft alte Stände. */
  version?: number;
  tier?: SnapshotTier;
  /** Ab diesem Alter gilt der Snapshot als veraltet und wird revalidiert. */
  maxAgeMs: number;
  /** Prüft fremde/alte Daten vor der Übernahme; ungültige Stände werden verworfen. */
  validate?: (value: unknown) => value is T;
  /** Liest ein Altformat (z. B. ein früherer localStorage-Eintrag ohne Hülle). */
  migrateLegacy?: (raw: unknown) => SnapshotEnvelope<T> | null;
  now?: () => number;
}

export interface SnapshotStore<T> {
  readonly key: string;
  readonly tier: SnapshotTier;
  /** Letzter Snapshot; `local` liefert sofort, `indexeddb` nach dem Öffnen. */
  restore(): Promise<SnapshotEnvelope<T> | null>;
  /** Nur `local`: synchroner Zugriff für den ersten Frame. */
  restoreSync(): SnapshotEnvelope<T> | null;
  save(value: T, updatedAt?: number): Promise<void>;
  clear(): Promise<void>;
  /** Zeitpunkt des zuletzt gespeicherten oder wiederhergestellten Stands. */
  updatedAt(): number;
  isStale(now?: number): boolean;
}

/* ── Speicher-Backends ── */

interface RawBackend {
  read(key: string): Promise<string | null>;
  readSync?(key: string): string | null;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const memory = new Map<string, string>();
const memoryBackend: RawBackend = {
  read: async (key) => memory.get(key) ?? null,
  readSync: (key) => memory.get(key) ?? null,
  write: async (key, text) => { memory.set(key, text); },
  remove: async (key) => { memory.delete(key); },
};

function storageAvailable(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch { return null; }
}

const localBackend: RawBackend = {
  read: async (key) => localBackend.readSync!(key),
  readSync: (key) => {
    const storage = storageAvailable();
    if (!storage) return memory.get(key) ?? null;
    try { return storage.getItem(key); } catch { return memory.get(key) ?? null; }
  },
  write: async (key, text) => {
    const storage = storageAvailable();
    memory.set(key, text);
    if (!storage) return;
    try { storage.setItem(key, text); } catch { /* Quota/Private Mode: Speicher bleibt in der Map. */ }
  },
  remove: async (key) => {
    memory.delete(key);
    const storage = storageAvailable();
    if (!storage) return;
    try { storage.removeItem(key); } catch { /* ignore */ }
  },
};

const DB_NAME = 'hauser-query-cache';
const STORE = 'snapshots';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openWithVersion(factory: IDBFactory, version: number | undefined): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = version === undefined ? factory.open(DB_NAME) : factory.open(DB_NAME, version); } catch { resolve(null); return; }
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      } catch { /* Upgrade fehlgeschlagen: onerror folgt. */ }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/* Öffnet die Datenbank mit ihrer aktuellen Version. Fehlt der Objektspeicher
   (etwa nach einem abgebrochenen Upgrade), wird einmal mit der nächsten Version
   erneut geöffnet, damit `onupgradeneeded` ihn anlegt. Jeder Fehler endet in
   `null`, und die Aufrufer weichen auf den Prozessspeicher aus. */
function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    let factory: IDBFactory | undefined;
    try { factory = typeof indexedDB === 'undefined' ? undefined : indexedDB; } catch { factory = undefined; }
    if (!factory) return null;
    let db = await openWithVersion(factory, undefined);
    if (db && !db.objectStoreNames.contains(STORE)) {
      const nextVersion = db.version + 1;
      db.close();
      db = await openWithVersion(factory, nextVersion);
      if (db && !db.objectStoreNames.contains(STORE)) { db.close(); return null; }
    }
    if (db) db.onversionchange = () => { db?.close(); dbPromise = null; };
    return db;
  })().catch(() => null);
  return dbPromise;
}

function idbRequest<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T | null> {
  return openDatabase().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      let request: IDBRequest<T>;
      try {
        request = run(db.transaction(STORE, mode).objectStore(STORE));
      } catch { resolve(null); return; }
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  });
}

const indexedDbBackend: RawBackend = {
  read: async (key) => {
    const db = await openDatabase();
    if (!db) return memory.get(key) ?? null;
    const value = await idbRequest<string>((store) => store.get(key) as IDBRequest<string>, 'readonly');
    return typeof value === 'string' ? value : null;
  },
  write: async (key, text) => {
    const db = await openDatabase();
    if (!db) { memory.set(key, text); return; }
    await idbRequest((store) => store.put(text, key), 'readwrite');
  },
  remove: async (key) => {
    memory.delete(key);
    const db = await openDatabase();
    if (!db) return;
    await idbRequest((store) => store.delete(key), 'readwrite');
  },
};

/* Testhaken: Backends austauschen und den Prozessspeicher leeren. */
export const __queryCacheInternals = {
  resetMemory(): void { memory.clear(); },
  resetStats(): void { stats.clear(); },
  resetDatabase(): void { dbPromise = null; },
  backends: { local: localBackend, indexeddb: indexedDbBackend, memory: memoryBackend },
};

/* ── Snapshot-Store ── */

function parseEnvelope<T>(text: string | null, options: SnapshotStoreOptions<T>): SnapshotEnvelope<T> | null {
  if (!text) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const version = options.version ?? 1;
  const envelope = raw as Partial<SnapshotEnvelope<unknown>> | null;
  if (envelope && typeof envelope === 'object' && envelope.v === version && Number.isFinite(envelope.updatedAt) && 'value' in envelope) {
    const value = envelope.value;
    if (options.validate && !options.validate(value)) return null;
    return { v: version, updatedAt: envelope.updatedAt as number, value: value as T };
  }
  if (options.migrateLegacy) {
    const migrated = options.migrateLegacy(raw);
    if (migrated && (!options.validate || options.validate(migrated.value))) return { ...migrated, v: version };
  }
  return null;
}

/* ── Buchführung für die Diagnose (Paket 10) ──
   Wie alt ist der jüngste Stand, und wie oft hat ein Snapshot den Kaltstart
   überbrückt? Zwei Zahlen pro Speicher, mehr nicht — sie kosten nichts und
   beantworten genau die Frage der versteckten Diagnoseansicht. */
export interface SnapshotStat {
  key: string;
  hits: number;
  misses: number;
  updatedAt: number;
}

const stats = new Map<string, SnapshotStat>();

function statFor(key: string): SnapshotStat {
  const existing = stats.get(key);
  if (existing) return existing;
  const created: SnapshotStat = { key, hits: 0, misses: 0, updatedAt: 0 };
  stats.set(key, created);
  return created;
}

export function snapshotStats(): SnapshotStat[] {
  return [...stats.values()];
}

export function createSnapshotStore<T>(options: SnapshotStoreOptions<T>): SnapshotStore<T> {
  const tier: SnapshotTier = options.tier ?? 'local';
  const backend = tier === 'indexeddb' ? indexedDbBackend : localBackend;
  const now = options.now ?? (() => Date.now());
  const version = options.version ?? 1;
  let lastUpdatedAt = 0;

  const stat = statFor(options.key);

  function adopt(envelope: SnapshotEnvelope<T> | null): SnapshotEnvelope<T> | null {
    if (envelope) {
      lastUpdatedAt = Math.max(lastUpdatedAt, envelope.updatedAt);
      stat.hits += 1;
      stat.updatedAt = lastUpdatedAt;
    } else {
      stat.misses += 1;
    }
    return envelope;
  }

  return {
    key: options.key,
    tier,
    async restore() {
      return adopt(parseEnvelope(await backend.read(options.key), options));
    },
    restoreSync() {
      if (!backend.readSync) return null;
      return adopt(parseEnvelope(backend.readSync(options.key), options));
    },
    async save(value, updatedAt = now()) {
      lastUpdatedAt = updatedAt;
      stat.updatedAt = updatedAt;
      const envelope: SnapshotEnvelope<T> = { v: version, updatedAt, value };
      let text: string;
      try { text = JSON.stringify(envelope); } catch { return; }
      await backend.write(options.key, text);
    },
    async clear() {
      lastUpdatedAt = 0;
      await backend.remove(options.key);
    },
    updatedAt() { return lastUpdatedAt; },
    isStale(at = now()) {
      return lastUpdatedAt === 0 || at - lastUpdatedAt >= options.maxAgeMs;
    },
  };
}
