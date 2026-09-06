import { afterEach, describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

const STORES = [
  { id: 'aldi', label: 'Aldi', categories: [], entityId: 'todo.aldi' },
  { id: 'rewe', label: 'Rewe', categories: [], entityId: 'todo.rewe' },
];

function mockShoppingConfig(): void {
  vi.doMock('./shopping-settings.svelte.ts', () => ({
    shoppingConfig: { version: 1, provider: 'ha', stores: STORES },
  }));
}

describe('optimistische Daten-Writes', () => {
  it('zeigt ein Einkaufsitem vor der Antwort der Liste und behält es während eines alten Snapshots', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const addItem = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const fetchSections = vi.fn().mockResolvedValue([]);
    mockShoppingConfig();
    vi.doMock('./shopping-lists.ts', () => ({ addItem, fetchSections, setItemChecked: vi.fn() }));
    const module = await import('./shopping.svelte.ts');
    module.shopping.sections = [{ id: 'aldi', title: 'Aldi', items: [] }];

    const write = module.addShoppingItem('aldi', 'Hafermilch');

    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Hafermilch']);
    expect(addItem).toHaveBeenCalledWith('ha', STORES[0], 'Hafermilch');

    release();
    await write;
    await vi.advanceTimersByTimeAsync(500);

    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Hafermilch']);
  });

  it('rollt ein optimistisches Einkaufsitem bei einem Listen-Fehler zurück', async () => {
    mockShoppingConfig();
    vi.doMock('./shopping-lists.ts', () => ({
      addItem: vi.fn().mockRejectedValue(new Error('Liste abgelehnt')),
      fetchSections: vi.fn().mockResolvedValue([]),
      setItemChecked: vi.fn(),
    }));
    const module = await import('./shopping.svelte.ts');
    module.shopping.sections = [{ id: 'rewe', title: 'Rewe', items: [] }];

    const write = module.addShoppingItem('rewe', 'Kaffee');
    expect(module.shopping.sections[0].items.map((item) => item.title)).toEqual(['Kaffee']);
    await expect(write).rejects.toThrow('Liste abgelehnt');
    expect(module.shopping.sections[0].items).toEqual([]);
  });

  it('schaltet ein Einkaufsitem sofort um und rollt einen Listen-Fehler zurück', async () => {
    let reject!: (error: Error) => void;
    const setItemChecked = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    mockShoppingConfig();
    vi.doMock('./shopping-lists.ts', () => ({
      addItem: vi.fn(), fetchSections: vi.fn().mockResolvedValue([]), setItemChecked,
    }));
    const module = await import('./shopping.svelte.ts');
    const item = { id: '3a658ddc-b17b-800e-a7a6-ef6500a3c973', title: 'Kaffee', checked: false };
    module.shopping.sections = [{ id: 'rewe', title: 'Rewe', items: [item] }];

    const write = module.toggleShoppingItem('rewe', item);
    expect(module.shopping.sections[0].items[0].checked).toBe(true);
    expect(setItemChecked).toHaveBeenCalledWith('ha', STORES[1], '3a658ddc-b17b-800e-a7a6-ef6500a3c973', true);

    reject(new Error('Liste abgelehnt'));
    await expect(write).rejects.toThrow('Liste abgelehnt');
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
