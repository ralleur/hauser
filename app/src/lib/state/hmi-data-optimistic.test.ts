import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

describe('optimistische HMI-Backend-Writes', () => {
  it('zeigt ein Einkaufsitem vor der Backend-Antwort und behält es während eines alten Snapshots', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const hmiDataRequest = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    vi.doMock('./hmi-data.ts', () => ({ hmiDataRequest }));
    const module = await import('./shopping.svelte.ts');
    module.shopping.sections = [{ id: 'aldi', title: 'Aldi', items: [] }];

    const write = module.addShoppingItem('aldi', 'Hafermilch');

    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Hafermilch']);
    expect(hmiDataRequest).toHaveBeenCalledWith('/api/shopping/items', 'POST', { store: 'aldi', title: 'Hafermilch' });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sections: [{ id: 'aldi', title: 'Aldi', items: [] }] }),
    }) as typeof fetch;
    release();
    await write;
    await vi.advanceTimersByTimeAsync(500);

    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Hafermilch']);
  });

  it('rollt ein optimistisches Einkaufsitem bei einem Backend-Fehler zurück', async () => {
    vi.doMock('./hmi-data.ts', () => ({
      hmiDataRequest: vi.fn().mockRejectedValue(new Error('Backend abgelehnt')),
    }));
    const module = await import('./shopping.svelte.ts');
    module.shopping.sections = [{ id: 'rewe', title: 'Rewe', items: [] }];

    const write = module.addShoppingItem('rewe', 'Kaffee');
    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Kaffee']);
    await expect(write).rejects.toThrow('Backend abgelehnt');
    expect(module.shopping.sections[0].items).toEqual([]);
  });

  it('schaltet ein Einkaufsitem sofort um und rollt einen Backend-Fehler zurück', async () => {
    let reject!: (error: Error) => void;
    const hmiDataRequest = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    vi.doMock('./hmi-data.ts', () => ({ hmiDataRequest }));
    const module = await import('./shopping.svelte.ts');
    const item = { id: '3a658ddc-b17b-800e-a7a6-ef6500a3c973', title: 'Kaffee', checked: false };
    module.shopping.sections = [{ id: 'rewe', title: 'Rewe', items: [item] }];

    const write = module.toggleShoppingItem('rewe', item);
    expect(module.shopping.sections[0].items[0].checked).toBe(true);
    expect(hmiDataRequest).toHaveBeenCalledWith(
      '/api/shopping/items/3a658ddc-b17b-800e-a7a6-ef6500a3c973', 'PATCH', { checked: true },
    );

    reject(new Error('Backend abgelehnt'));
    await expect(write).rejects.toThrow('Backend abgelehnt');
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
      who: 'sam', title: 'Müll rausbringen', due: null,
    });

    release();
    await write;
  });
});
