import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reminder, ReminderSource } from './reminders.ts';

const CACHE_KEY = 'hmi:reminders-cache';
const cachedSource: ReminderSource = { entityId: 'todo.familie', name: 'Familie', color: '#fff' };
const cachedItem: Reminder = {
  id: 'todo.familie:cached',
  title: 'Letzten bekannten Stand behalten',
  due: null,
  completed: false,
  description: null,
  color: '#fff',
};

function installLocalStorage(): Storage {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  vi.stubGlobal('localStorage', storage);
  return storage;
}

/* Altformat ohne Hülle, wie es ältere Geräte hinterlassen haben; der
   Snapshot-Store liest es weiter (migrateLegacy). */
function cacheLastKnown(storage: Storage): void {
  storage.setItem(CACHE_KEY, JSON.stringify({
    sources: [cachedSource],
    items: [cachedItem],
    updatedAt: 1234,
  }));
}

async function freshReminders({
  connectionStatus = 'connected',
  listReminderSources = vi.fn(async () => [] as ReminderSource[]),
  getReminders = vi.fn(async () => [] as Reminder[]),
  updateTodoItem = vi.fn(async () => {}),
}: {
  connectionStatus?: 'connected' | 'disconnected';
  listReminderSources?: ReturnType<typeof vi.fn>;
  getReminders?: ReturnType<typeof vi.fn>;
  updateTodoItem?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.resetModules();
  vi.doMock('../adapter/runtime.svelte.ts', () => ({
    runtime: { connectionStatus, listReminderSources, getReminders, updateTodoItem },
  }));
  vi.doMock('./hmi-data.ts', () => ({ hmiDataRequest: vi.fn() }));
  vi.doMock('./shared-config.ts', () => ({ sharedStorage: localStorage }));
  return import('./reminders.svelte.ts');
}

beforeEach(() => {
  vi.useFakeTimers();
  installLocalStorage();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('../adapter/runtime.svelte.ts');
  vi.doUnmock('./hmi-data.ts');
  vi.doUnmock('./shared-config.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

async function initAndWait(module: Awaited<ReturnType<typeof freshReminders>>): Promise<void> {
  module.initReminders();
  await module.refreshReminders();
}

describe('reminder last-known cache', () => {
  it('deletes a completed HA reminder from its original list by its full UID', async () => {
    localStorage.setItem('hmi:reminders-selected', JSON.stringify([cachedSource.entityId]));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
    const item = { ...cachedItem, id: 'remote:uid', completed: true, hasUniqueTodoUid: true };
    const getReminders = vi.fn(async () => [] as Reminder[]).mockResolvedValueOnce([item]);
    const updateTodoItem = vi.fn(async () => {});
    const module = await freshReminders({ updateTodoItem, getReminders, listReminderSources: vi.fn(async () => [cachedSource]) });
    await initAndWait(module);
    expect(module.canDeleteReminder({ ...item, id: 'todo.familie:ambiguous', hasUniqueTodoUid: false })).toBe(false);
    await module.deleteReminder('todo.familie:remote:uid');
    expect(updateTodoItem).toHaveBeenCalledWith('todo.familie', 'remote:uid', null);
    expect(module.reminders.items).toEqual([]);
  });

  it('completes an overdue HA reminder through its source list and preserves the full UID', async () => {
    localStorage.setItem('hmi:reminders-selected', JSON.stringify([cachedSource.entityId]));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));
    const updateTodoItem = vi.fn(async () => {});
    const getReminders = vi.fn(async () => [{ ...cachedItem, id: 'remote:uid', completed: true }]);
    const module = await freshReminders({ updateTodoItem, getReminders, listReminderSources: vi.fn(async () => [cachedSource]) });
    const id = `${cachedSource.entityId}:remote:uid`;
    expect(module.canCompleteReminder(id)).toBe(true);
    expect(module.hmiReminderId(id)).toBeNull();
    await module.completeReminder(id);
    expect(updateTodoItem).toHaveBeenCalledWith('todo.familie', 'remote:uid', true);
    expect(module.reminders.items).toMatchObject([{ id, completed: true }]);
  });

  it('keeps the reminder open and surfaces a rejected HA write', async () => {
    const updateTodoItem = vi.fn().mockRejectedValue(new Error('HA refused'));
    const module = await freshReminders({ updateTodoItem });
    module.reminders.items = [cachedItem];
    await expect(module.completeReminder(cachedItem.id)).rejects.toThrow('HA refused');
    expect(module.reminders.items[0].completed).toBe(false);
    expect(module.canCompleteReminder('hmi:family-reminders:optimistic-1')).toBe(false);
    expect(module.canCompleteReminder('unknown')).toBe(false);
  });

  it('keeps the restored cache when offline discovery only returns an empty list', async () => {
    cacheLastKnown(localStorage);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const module = await freshReminders({ connectionStatus: 'disconnected' });

    await initAndWait(module);

    expect(module.reminders.sources).toEqual([cachedSource]);
    expect(module.reminders.items).toEqual([cachedItem]);
    expect(module.reminders.updatedAt).toBe(1234);
    expect(module.reminders.error).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({ items: [cachedItem], updatedAt: 1234 });
  });

  it('keeps the restored cache when source discovery rejects', async () => {
    cacheLastKnown(localStorage);
    vi.stubGlobal('fetch', vi.fn());
    const module = await freshReminders({
      listReminderSources: vi.fn().mockRejectedValue(new Error('discovery failed')),
    });

    await initAndWait(module);

    expect(module.reminders.sources).toEqual([cachedSource]);
    expect(module.reminders.items).toEqual([cachedItem]);
    expect(module.reminders.error).toBe('discovery failed');
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({ items: [cachedItem], updatedAt: 1234 });
  });

  it('keeps the restored cache when the central reminder fetch fails', async () => {
    cacheLastKnown(localStorage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const module = await freshReminders();

    await initAndWait(module);

    expect(module.reminders.sources).toEqual([cachedSource]);
    expect(module.reminders.items).toEqual([cachedItem]);
    expect(module.reminders.error).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({ items: [cachedItem], updatedAt: 1234 });
  });

  it('persists an authoritative successful empty server result and removes stale items', async () => {
    cacheLastKnown(localStorage);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updated_at: '2026-07-31T00:00:00Z', source_name: 'HMI', source_color: '#fff', items: [] }),
    }));
    const module = await freshReminders();

    await initAndWait(module);

    expect(module.reminders.sources).toEqual([]);
    expect(module.reminders.items).toEqual([]);
    expect(module.reminders.updatedAt).toBeGreaterThan(1234);
    expect(module.reminders.error).toBeNull();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({ v: 1, value: { sources: [], items: [] } });
  });
});
