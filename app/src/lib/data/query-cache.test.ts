import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __queryCacheInternals, createSnapshotStore } from './query-cache.ts';
import { __revalidationInternals, registerRevalidation, revalidateStaleQueries, startQueryRevalidation } from './revalidation.ts';

function installLocalStorage(): Map<string, string> {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  return values;
}

beforeEach(() => {
  __queryCacheInternals.resetMemory();
  __queryCacheInternals.resetDatabase();
  __revalidationInternals.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Snapshot-Store (local)', () => {
  it('speichert eine Hülle mit Version und Zeitstempel und liest sie synchron', async () => {
    const values = installLocalStorage();
    let now = 10_000;
    const store = createSnapshotStore<{ items: string[] }>({ key: 'hmi:test', maxAgeMs: 5_000, now: () => now });
    expect(store.restoreSync()).toBeNull();
    expect(store.isStale()).toBe(true);
    await store.save({ items: ['a'] });
    expect(JSON.parse(values.get('hmi:test')!)).toEqual({ v: 1, updatedAt: 10_000, value: { items: ['a'] } });
    expect(store.isStale()).toBe(false);
    now += 5_000;
    expect(store.isStale()).toBe(true);
    const fresh = createSnapshotStore<{ items: string[] }>({ key: 'hmi:test', maxAgeMs: 5_000, now: () => now });
    expect(fresh.restoreSync()).toEqual({ v: 1, updatedAt: 10_000, value: { items: ['a'] } });
    expect(fresh.updatedAt()).toBe(10_000);
  });

  it('verwirft Stände fremder Version und ungültige Werte', () => {
    const values = installLocalStorage();
    values.set('hmi:test', JSON.stringify({ v: 2, updatedAt: 1, value: { items: [] } }));
    const store = createSnapshotStore<{ items: string[] }>({ key: 'hmi:test', maxAgeMs: 1 });
    expect(store.restoreSync()).toBeNull();
    values.set('hmi:test', JSON.stringify({ v: 1, updatedAt: 1, value: { nope: true } }));
    const validated = createSnapshotStore<{ items: string[] }>({
      key: 'hmi:test', maxAgeMs: 1,
      validate: (value): value is { items: string[] } => Array.isArray((value as { items?: unknown })?.items),
    });
    expect(validated.restoreSync()).toBeNull();
    values.set('hmi:test', 'kein json');
    expect(validated.restoreSync()).toBeNull();
  });

  it('übernimmt ein Altformat über migrateLegacy', () => {
    const values = installLocalStorage();
    values.set('hmi:legacy', JSON.stringify({ items: ['alt'], updatedAt: 42 }));
    const store = createSnapshotStore<{ items: string[] }>({
      key: 'hmi:legacy', maxAgeMs: 1,
      migrateLegacy: (raw) => {
        const legacy = raw as { items?: string[]; updatedAt?: number } | null;
        return Array.isArray(legacy?.items) && typeof legacy.updatedAt === 'number'
          ? { v: 1, updatedAt: legacy.updatedAt, value: { items: legacy.items } }
          : null;
      },
    });
    expect(store.restoreSync()).toEqual({ v: 1, updatedAt: 42, value: { items: ['alt'] } });
  });

  it('bleibt ohne localStorage im Prozessspeicher funktionsfähig', async () => {
    vi.stubGlobal('localStorage', undefined);
    const store = createSnapshotStore<number>({ key: 'hmi:mem', maxAgeMs: 1 });
    await store.save(7, 5);
    expect(store.restoreSync()).toEqual({ v: 1, updatedAt: 5, value: 7 });
    await store.clear();
    expect(store.restoreSync()).toBeNull();
  });
});

describe('Snapshot-Store (indexeddb)', () => {
  it('fällt ohne IndexedDB auf den Prozessspeicher zurück und liest asynchron', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = createSnapshotStore<string[]>({ key: 'hmi:idb', tier: 'indexeddb', maxAgeMs: 1 });
    expect(store.restoreSync()).toBeNull();
    expect(await store.restore()).toBeNull();
    await store.save(['x'], 3);
    expect(await store.restore()).toEqual({ v: 1, updatedAt: 3, value: ['x'] });
  });
});

describe('Revalidierung', () => {
  it('lädt nur veraltete Abfragen neu und bündelt parallele Auslöser', async () => {
    const staleLoad = vi.fn(async () => {});
    const freshLoad = vi.fn(async () => {});
    registerRevalidation({ name: 'stale', isStale: () => true, revalidate: staleLoad });
    registerRevalidation({ name: 'fresh', isStale: () => false, revalidate: freshLoad });
    const first = revalidateStaleQueries('manual');
    const second = revalidateStaleQueries('manual');
    expect(second).toBe(first);
    await first;
    expect(staleLoad).toHaveBeenCalledTimes(1);
    expect(freshLoad).not.toHaveBeenCalled();
  });

  it('reagiert auf Sichtbarkeit und Netz, aber nicht im Hintergrund', async () => {
    const load = vi.fn(async () => {});
    registerRevalidation({ name: 'q', isStale: () => true, revalidate: load });
    const docListeners = new Map<string, () => void>();
    const winListeners = new Map<string, () => void>();
    const doc = { visibilityState: 'hidden' as DocumentVisibilityState, addEventListener: (type: string, fn: () => void) => { docListeners.set(type, fn); } };
    const win = { addEventListener: (type: string, fn: () => void) => { winListeners.set(type, fn); } };
    startQueryRevalidation({ document: doc as unknown as Document, window: win as unknown as Window, navigator: { onLine: true } });
    docListeners.get('visibilitychange')!();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    docListeners.get('visibilitychange')!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(load).toHaveBeenCalledTimes(1);
    winListeners.get('online')!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
