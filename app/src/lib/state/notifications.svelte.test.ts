import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Reload-Dedupe (B-04): der Dedupe-Schlüssel darf keinen Zeitstempel tragen,
   sonst erzeugt derselbe fortdauernde Zustand nach jedem Laden einen weiteren
   Eintrag. Node-Env ohne echte Storage — minimaler In-Memory-Stub, der einen
   Reload überlebt. */

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

async function freshCenter() {
  vi.resetModules();
  const { notifications } = await import('./notifications.svelte.ts');
  notifications.init();
  return notifications;
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationCenter — Persistenz', () => {
  it('Reload bei fortdauerndem Zustand erzeugt keinen zweiten Eintrag', async () => {
    const changedAt = 1_700_000_000_000;

    const first = await freshCenter();
    first.syncLaundry('washer', { state: 'running', doneOnInitial: false, changedAt });
    expect(first.items).toHaveLength(1);

    /* Reload: neue Laufzeit-Instanz, Waschmaschine läuft weiter. Der gemeldete
       `changedAt` darf dabei driften (Demo-Adapter setzt ihn relativ zum Start)
       — der Zustand ist derselbe, also bleibt es eine Benachrichtigung. */
    const second = await freshCenter();
    second.syncLaundry('washer', { state: 'running', doneOnInitial: false, changedAt: changedAt + 3 * 60_000 });

    expect(second.items).toHaveLength(1);
    expect(second.items[0].dedupeKey).toBe('laundry:washer:running');
    // Verstrichene Zeit bleibt am ursprünglichen createdAt hängen.
    expect(second.items[0].createdAt).toBe(changedAt);
  });

  it('removes a persisted active laundry notification when the source is missing after reload', async () => {
    const first = await freshCenter();
    first.syncLaundry('washer', { state: 'running', doneOnInitial: false, changedAt: 100 });
    expect(first.items.map((item) => item.state)).toEqual(['running']);

    const reloaded = await freshCenter();
    expect(reloaded.items.map((item) => item.state)).toEqual(['running']);
    reloaded.syncLaundry('washer', undefined);

    expect(reloaded.items).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('hmi:notifications:v2') ?? '{}').active).toEqual([]);
  });

  it('reconciles persisted running to closed-client done, dedupes its marker, and allows the next cycle', async () => {
    const first = await freshCenter();
    first.syncLaundry('dryer', {
      state: 'running', doneOnInitial: true, changedAt: 50,
      cycleId: '2026-08-01T08:00:00+00:00',
    });
    expect(first.items.map((item) => item.state)).toEqual(['running']);

    const restored = await freshCenter();
    restored.syncLaundry('dryer', {
      state: 'done', doneOnInitial: true, changedAt: 100, cycleId: '2026-08-02T08:00:00+00:00',
    });
    expect(restored.items.map((item) => item.state)).toEqual(['done']);
    restored.dismiss(restored.items[0].dedupeKey);

    const afterRestart = await freshCenter();
    afterRestart.syncLaundry('dryer', {
      state: 'done', doneOnInitial: true, changedAt: 500, cycleId: '2026-08-02T08:00:00+00:00',
    });
    expect(afterRestart.items).toHaveLength(0);

    const nextCycle = await freshCenter();
    nextCycle.syncLaundry('dryer', {
      state: 'done', doneOnInitial: true, changedAt: 900, cycleId: '2026-08-03T08:00:00+00:00',
    });
    expect(nextCycle.items).toHaveLength(1);
    expect(nextCycle.items[0].dedupeKey).toContain('2026-08-03T08:00:00+00:00');
  });

  it('accepts marker-bound transitions only after helper and marker form a coherent new pair in either order', async () => {
    const center = await freshCenter();
    center.syncLaundry('dryer', {
      state: 'running', doneOnInitial: true, changedAt: 10, cycleId: 'cycle-a',
    });

    center.syncLaundry('dryer', {
      state: 'running', doneOnInitial: true, changedAt: 20, cycleId: 'cycle-b',
    });
    expect(center.items.map((item) => item.dedupeKey)).toEqual(['laundry:dryer:running:cycle-a']);
    center.syncLaundry('dryer', {
      state: 'done', doneOnInitial: true, changedAt: 30, cycleId: 'cycle-b',
    });
    expect(center.items.map((item) => item.dedupeKey)).toEqual(['laundry:dryer:done:cycle-b']);

    center.syncLaundry('dryer', {
      state: 'running', doneOnInitial: true, changedAt: 40, cycleId: 'cycle-b',
    });
    expect(center.items.map((item) => item.dedupeKey)).toEqual(['laundry:dryer:done:cycle-b']);
    center.syncLaundry('dryer', {
      state: 'running', doneOnInitial: true, changedAt: 50, cycleId: 'cycle-c',
    });
    expect(center.items.map((item) => item.dedupeKey)).toEqual(['laundry:dryer:running:cycle-c']);

    center.syncLaundry('dryer', {
      state: 'running', doneOnInitial: true, changedAt: 60, cycleId: 'guard-only-marker',
    });
    expect(center.items.map((item) => item.dedupeKey)).toEqual(['laundry:dryer:running:cycle-c']);
  });

  it('keeps unmarked adapters state-only', async () => {
    const center = await freshCenter();
    center.syncLaundry('washer', { state: 'running', doneOnInitial: false, changedAt: 10 });
    center.syncLaundry('washer', { state: 'done', doneOnInitial: false, changedAt: 20 });
    expect(center.items.map((item) => item.dedupeKey)).toEqual(['laundry:washer:done']);
  });
});
