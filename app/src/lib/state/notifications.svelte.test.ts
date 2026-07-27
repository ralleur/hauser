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
    first.syncLaundry('washer', { on: true, changedAt });
    expect(first.items).toHaveLength(1);

    /* Reload: neue Laufzeit-Instanz, Waschmaschine läuft weiter. Der gemeldete
       `changedAt` darf dabei driften (Demo-Adapter setzt ihn relativ zum Start)
       — der Zustand ist derselbe, also bleibt es eine Benachrichtigung. */
    const second = await freshCenter();
    second.syncLaundry('washer', { on: true, changedAt: changedAt + 3 * 60_000 });

    expect(second.items).toHaveLength(1);
    expect(second.items[0].dedupeKey).toBe('laundry:washer:running');
    // Verstrichene Zeit bleibt am ursprünglichen createdAt hängen.
    expect(second.items[0].createdAt).toBe(changedAt);
  });
});
