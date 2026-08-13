import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const websocket = vi.hoisted(() => ({
  createConnection: vi.fn(),
  createLongLivedTokenAuth: vi.fn((url: string, token: string) => ({ url, token })),
  callService: vi.fn(),
  getStates: vi.fn(async () => []),
  ERR_INVALID_AUTH: Symbol('invalid-auth'),
}));

vi.mock('home-assistant-js-websocket', () => websocket);

import { HaBackend, installHaRetryFactory } from './ha-backend.ts';
import type { EntitiesDiff } from './ha-entities.ts';
import { createHaRetryController } from '../state/runtime-background.ts';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function connection(subscribeMessage: (callback: (diff: EntitiesDiff) => void) => Promise<() => Promise<void>>) {
  return {
    addEventListener: vi.fn(),
    subscribeMessage: vi.fn(subscribeMessage),
    sendMessagePromise: vi.fn(),
    close: vi.fn(),
  };
}

beforeEach(() => {
  installHaRetryFactory(createHaRetryController);
  websocket.createConnection.mockReset();
  websocket.createLongLivedTokenAuth.mockClear();
  websocket.callService.mockClear();
  websocket.getStates.mockClear();
  const storage = new MemoryStorage();
  storage.setItem('hmi:ha-token', 'test-token');
  vi.stubGlobal('localStorage', storage);
  performance.clearMarks();
  performance.clearMeasures();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HaBackend deferred startup', () => {
  it('hydrates cached entities as stale without opening a connection in the constructor', () => {
    localStorage.setItem('hmi:ha-cache', JSON.stringify({ 'light.demo': { on: true } }));
    const backend = new HaBackend({ url: 'http://initial:8123', entityIds: ['light.demo'] });
    const update = vi.fn();

    backend.subscribe(update);

    expect(update).toHaveBeenCalledWith('light.demo', { on: true }, true);
    expect(websocket.createConnection).not.toHaveBeenCalled();
  });

  it('never hydrates configured laundry entities from browser cache or live seed', () => {
    localStorage.setItem('hmi:ha-cache', JSON.stringify({
      'input_select.fixture_washer': { state: 'running', changedAt: 100 },
      'light.demo': { on: true },
    }));
    const backend = new HaBackend({
      url: 'http://initial:8123',
      entityIds: ['input_select.fixture_washer', 'light.demo'],
      laundryEntityIds: ['input_select.fixture_washer'],
      seed: new Map([
        ['input_select.fixture_washer', { state: 'running', changedAt: 200 }],
        ['light.demo', { on: false }],
      ]),
    });
    const update = vi.fn();

    backend.subscribe(update);

    expect(update).toHaveBeenCalledExactlyOnceWith('light.demo', { on: true }, true);
    expect(update).not.toHaveBeenCalledWith(
      'input_select.fixture_washer',
      expect.anything(),
      expect.anything(),
    );
  });

  it('publishes raw laundry states for every supported domain and clears removals from runtime and cache', async () => {
    let emit!: (diff: EntitiesDiff) => void;
    const connected = connection(async (callback) => {
      emit = callback;
      return async () => {};
    });
    websocket.createConnection.mockResolvedValueOnce(connected);
    const laundryEntityIds = [
      'input_select.fixture_washer',
      'select.fixture_dryer',
      'sensor.fixture_enum',
      'binary_sensor.fixture_binary',
      'input_boolean.fixture_boolean',
      'automation.fixture_cycle',
    ];
    const backend = new HaBackend({
      url: 'http://ha:8123',
      entityIds: [...laundryEntityIds, 'switch.fixture_general'],
      laundryEntityIds,
    });
    const update = vi.fn();
    backend.subscribe(update);
    backend.start();
    await vi.waitFor(() => expect(connected.subscribeMessage).toHaveBeenCalledOnce());

    emit({
      a: {
        'input_select.fixture_washer': { s: 'running', a: {}, lc: 100 },
        'select.fixture_dryer': { s: 'done', a: {}, lc: 101 },
        'sensor.fixture_enum': { s: 'drying', a: {}, lc: 102 },
        'binary_sensor.fixture_binary': { s: 'unknown', a: {}, lc: 103 },
        'input_boolean.fixture_boolean': { s: 'unavailable', a: {}, lc: 104 },
        'automation.fixture_cycle': {
          s: 'on',
          a: { last_triggered: '2026-08-02T08:00:00+00:00' },
          lc: 104.5,
        },
        'switch.fixture_general': { s: 'unavailable', a: {}, lc: 105 },
      },
    });

    expect(update).toHaveBeenCalledWith(
      'input_select.fixture_washer',
      { state: 'running', changedAt: 100_000 },
    );
    expect(update).toHaveBeenCalledWith('select.fixture_dryer', { state: 'done', changedAt: 101_000 });
    expect(update).toHaveBeenCalledWith('sensor.fixture_enum', { state: 'drying', changedAt: 102_000 });
    expect(update).toHaveBeenCalledWith('binary_sensor.fixture_binary', { state: 'unknown', changedAt: 103_000 });
    expect(update).toHaveBeenCalledWith('input_boolean.fixture_boolean', { state: 'unavailable', changedAt: 104_000 });
    expect(update).toHaveBeenCalledWith('automation.fixture_cycle', {
      state: 'on',
      changedAt: 104_500,
      lastTriggered: '2026-08-02T08:00:00+00:00',
    });
    expect(update).toHaveBeenCalledWith('switch.fixture_general', undefined, false, false);

    emit({ r: { 'input_select.fixture_washer': null } });

    expect(update).toHaveBeenLastCalledWith('input_select.fixture_washer', undefined);
    const cache = JSON.parse(localStorage.getItem('hmi:ha-cache') ?? '{}') as Record<string, unknown>;
    expect(cache).not.toHaveProperty('input_select.fixture_washer');
    expect(cache).toHaveProperty('select.fixture_dryer');
  });

  it('resolves the URL at start time and keeps concurrent starts single-flight', async () => {
    let currentUrl = 'http://before-sync:8123';
    let resolveConnection!: (value: ReturnType<typeof connection>) => void;
    const pending = new Promise<ReturnType<typeof connection>>((resolve) => { resolveConnection = resolve; });
    websocket.createConnection.mockReturnValue(pending);
    const backend = new HaBackend({ url: () => currentUrl, entityIds: [] });
    currentUrl = 'http://after-sync:8123';

    backend.start();
    backend.start();

    expect(websocket.createLongLivedTokenAuth).toHaveBeenCalledOnce();
    expect(websocket.createLongLivedTokenAuth).toHaveBeenCalledWith('http://after-sync:8123', 'test-token');
    expect(websocket.createConnection).toHaveBeenCalledOnce();

    const connected = connection(async () => async () => {});
    resolveConnection(connected);
    await vi.waitFor(() => expect(connected.subscribeMessage).toHaveBeenCalledOnce());
    expect(websocket.createConnection).toHaveBeenCalledOnce();
  });

  it('reports connected only after the entity subscription is active', async () => {
    vi.useFakeTimers();
    let resolveSubscription!: (unsubscribe: () => Promise<void>) => void;
    const pendingSubscription = new Promise<() => Promise<void>>((resolve) => {
      resolveSubscription = resolve;
    });
    const connected = connection(() => pendingSubscription);
    websocket.createConnection.mockResolvedValueOnce(connected);
    const backend = new HaBackend({ url: 'http://ha:8123', entityIds: ['light.demo'] });
    const statuses: string[] = [];
    backend.onConnectionChange((status) => statuses.push(status));

    backend.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(connected.subscribeMessage).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe('connecting');
    const ready = connected.addEventListener.mock.calls
      .find(([event]) => event === 'ready')?.[1] as (() => void) | undefined;
    expect(ready).toBeTypeOf('function');
    ready?.();
    expect(statuses.at(-1)).toBe('connecting');

    resolveSubscription(async () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe('connected');
  });

  it('retries an initial failure automatically and cancels the retry after success', async () => {
    vi.useFakeTimers();
    const failed = connection(async () => { throw new Error('subscription failed'); });
    const recovered = connection(async () => async () => {});
    websocket.createConnection
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(recovered);
    const backend = new HaBackend({ url: 'http://ha:8123', entityIds: ['light.demo'] });
    const statuses: string[] = [];
    backend.onConnectionChange((status) => statuses.push(status));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    backend.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe('disconnected');
    expect(failed.close).toHaveBeenCalledOnce();
    expect(websocket.createConnection).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(999);
    expect(websocket.createConnection).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(recovered.subscribeMessage).toHaveBeenCalledOnce();
    expect(websocket.createConnection).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('connected');
    expect(vi.getTimerCount()).toBe(0);
    warn.mockRestore();
  });

  it('uses bounded exponential delays without duplicate timers or online listeners', async () => {
    vi.useFakeTimers();
    const online = new EventTarget();
    const add = vi.spyOn(online, 'addEventListener');
    const remove = vi.spyOn(online, 'removeEventListener');
    vi.stubGlobal('window', online);
    const recovered = connection(async () => async () => {});
    websocket.createConnection
      .mockRejectedValueOnce(new Error('offline-1'))
      .mockRejectedValueOnce(new Error('offline-2'))
      .mockRejectedValueOnce(new Error('offline-3'))
      .mockRejectedValueOnce(new Error('offline-4'))
      .mockRejectedValueOnce(new Error('offline-5'))
      .mockRejectedValueOnce(new Error('offline-6'))
      .mockRejectedValueOnce(new Error('offline-7'))
      .mockResolvedValueOnce(recovered);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const backend = new HaBackend({ url: 'http://ha:8123', entityIds: [] });

    backend.start();
    backend.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(websocket.createConnection).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    expect(add).toHaveBeenCalledTimes(1);

    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(vi.getTimerCount()).toBe(1);
      const before = websocket.createConnection.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(websocket.createConnection).toHaveBeenCalledTimes(before + 1);
      expect(vi.getTimerCount()).toBe(1);
      expect(add).toHaveBeenCalledTimes(1);
    }

    await vi.advanceTimersByTimeAsync(29_999);
    expect(websocket.createConnection).toHaveBeenCalledTimes(7);
    online.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);

    expect(websocket.createConnection).toHaveBeenCalledTimes(8);
    expect(recovered.subscribeMessage).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('cleans retry state after subscription even while the catalog never resolves', async () => {
    vi.useFakeTimers();
    const online = new EventTarget();
    const add = vi.spyOn(online, 'addEventListener');
    const remove = vi.spyOn(online, 'removeEventListener');
    vi.stubGlobal('window', online);
    const recovered = connection(async () => async () => {});
    websocket.createConnection
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(recovered);
    websocket.getStates.mockReturnValueOnce(new Promise(() => {}));
    const backend = new HaBackend({ url: 'http://ha:8123', entityIds: ['light.demo'] });
    const statuses: string[] = [];
    backend.onConnectionChange((status) => statuses.push(status));
    backend.subscribeCatalog(vi.fn());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    backend.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe('disconnected');
    expect(add).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(recovered.subscribeMessage).toHaveBeenCalledOnce();
    expect(websocket.getStates).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe('connected');
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('keeps the connection connected when the catalog refresh rejects', async () => {
    vi.useFakeTimers();
    const online = new EventTarget();
    const remove = vi.spyOn(online, 'removeEventListener');
    vi.stubGlobal('window', online);
    const recovered = connection(async () => async () => {});
    websocket.createConnection
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(recovered);
    websocket.getStates.mockRejectedValueOnce(new Error('catalog unavailable'));
    const backend = new HaBackend({ url: 'http://ha:8123', entityIds: ['light.demo'] });
    const statuses: string[] = [];
    backend.onConnectionChange((status) => statuses.push(status));
    backend.subscribeCatalog(vi.fn());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    backend.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(websocket.getStates).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe('connected');
    expect(statuses.filter((status) => status === 'disconnected')).toHaveLength(1);
    expect(remove).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[HaBackend] Entity-Katalog konnte nicht geladen werden:',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('reports a missing token as setup and retries neither missing nor invalid auth', async () => {
    vi.useFakeTimers();
    localStorage.removeItem('hmi:ha-token');
    const missing = new HaBackend({ url: 'http://ha:8123', entityIds: [] });
    const missingReasons: string[] = [];
    missing.onAuthError((reason) => missingReasons.push(reason));

    missing.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(missingReasons).toEqual(['missing-token']);
    expect(websocket.createConnection).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    localStorage.setItem('hmi:ha-token', 'expired-token');
    websocket.createConnection.mockRejectedValueOnce(websocket.ERR_INVALID_AUTH);
    const invalid = new HaBackend({ url: 'http://ha:8123', entityIds: [] });
    const invalidReasons: string[] = [];
    invalid.onAuthError((reason) => invalidReasons.push(reason));
    invalid.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidReasons).toEqual(['invalid-auth']);
    expect(localStorage.getItem('hmi:ha-token')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
