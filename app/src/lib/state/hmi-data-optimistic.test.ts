import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

describe('optimistische Daten-Writes', () => {
  it('zeigt ein Einkaufsitem vor der Bridge-Antwort und behält es während eines alten Snapshots', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const bridgePost = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    vi.doMock('./notion-bridge.ts', () => ({ bridgePost }));
    const module = await import('./shopping.svelte.ts');
    module.shopping.sections = [{ id: 'aldi', title: 'Aldi', items: [] }];

    const write = module.addShoppingItem('aldi', 'Hafermilch');

    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Hafermilch']);
    expect(bridgePost).toHaveBeenCalledWith('/shopping/add', { store: 'aldi', title: 'Hafermilch' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sections: [{ id: 'aldi', title: 'Aldi', items: [] }] }),
    }) as typeof fetch;
    release();
    await write;
    await vi.advanceTimersByTimeAsync(500);

    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Hafermilch']);
  });

  it('rollt ein optimistisches Einkaufsitem bei einem Bridge-Fehler zurück', async () => {
    vi.doMock('./notion-bridge.ts', () => ({
      bridgePost: vi.fn().mockRejectedValue(new Error('Bridge abgelehnt')),
    }));
    const module = await import('./shopping.svelte.ts');
    module.shopping.sections = [{ id: 'rewe', title: 'Rewe', items: [] }];

    const write = module.addShoppingItem('rewe', 'Kaffee');
    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Kaffee']);
    await expect(write).rejects.toThrow('Bridge abgelehnt');
    expect(module.shopping.sections[0].items).toEqual([]);
  });

  it('schaltet ein Einkaufsitem sofort um und rollt einen Bridge-Fehler zurück', async () => {
    let reject!: (error: Error) => void;
    const bridgePost = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    vi.doMock('./notion-bridge.ts', () => ({ bridgePost }));
    const module = await import('./shopping.svelte.ts');
    const item = { id: '3a658ddc-b17b-800e-a7a6-ef6500a3c973', title: 'Kaffee', checked: false };
    module.shopping.sections = [{ id: 'rewe', title: 'Rewe', items: [item] }];

    const write = module.toggleShoppingItem('rewe', item);
    expect(module.shopping.sections[0].items[0].checked).toBe(true);
    expect(bridgePost).toHaveBeenCalledWith('/shopping/toggle', {
      id: '3a658ddc-b17b-800e-a7a6-ef6500a3c973', checked: true,
    });

    reject(new Error('Bridge abgelehnt'));
    await expect(write).rejects.toThrow('Bridge abgelehnt');
    expect(module.shopping.sections[0].items[0].checked).toBe(false);
  });

  it('zeigt eine neue Erinnerung sofort und gibt optimistische IDs nicht zum Abhaken frei', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const hmiDataRequest = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    vi.doMock('./hmi-data.ts', () => ({ hmiDataRequest }));
    vi.doMock('../adapter/runtime.svelte.ts', () => ({ runtime: {} }));
    const module = await import('./reminders.svelte.ts');
    module.reminders.items = [];

    const write = module.addReminder('sam', 'Müll rausbringen');
    const optimistic = module.reminders.items[0];

    expect(optimistic.title).toBe('Sam - Müll rausbringen');
    expect(module.hmiReminderId(optimistic.id)).toBeNull();
    expect(hmiDataRequest).toHaveBeenCalledWith('/api/reminders', 'POST', {
      who: 'sam', label: 'Sam', title: 'Müll rausbringen', due: null,
    });

    release();
    await write;
  });
});
