// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedStorage } from './shared-config.ts';
import {
  bootstrapSharedConfig,
  SHARED_CONFIG_KEYS,
} from './shared-config-bootstrap.ts';
import {
  bootstrapSharedConfigBeforeRuntime,
  SHARED_CONFIG_BOOTSTRAP_TIMEOUT_MS,
} from './startup-background.ts';

afterEach(() => vi.unstubAllGlobals());

const SHARED_CONFIG_OUTBOX_KEY = 'hmi:shared-config-outbox:v1';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function jsonResponse(values: Record<string, string>) {
  return new Response(JSON.stringify({ values }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('zentrale HMI-Konfiguration', () => {
  it('hält den schweren Bootstrap hinter einer literalen Post-Paint-Modulgrenze', () => {
    const startupSource = readFileSync(new URL('./startup-background.ts', import.meta.url), 'utf8');

    expect(startupSource).not.toMatch(/from ['"]\.\/shared-config-bootstrap\.ts['"]/);
    expect(startupSource).toContain("import('./shared-config-bootstrap.ts')");
  });

  it('blockiert zentrale Layout-Writes bis GET und lässt danach das Pending gewinnen', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const { layoutManager } = await import('./layout-manager.svelte.ts');
    const centralLayout = {
      version: 1,
      widthPreset: 'wide',
      panelSize: 70,
      energyPanelSize: 70,
      roomsPerRow: 2,
      slots: [{ id: 'slot-1', roomId: 'wohnzimmer' }],
    };
    const localLayout = {
      version: 1,
      widthPreset: 'compact',
      panelSize: 15,
      energyPanelSize: 15,
      roomsPerRow: 2,
      slots: [{ id: 'slot-1', roomId: 'kueche' }],
    };
    let resolveGet!: (response: Response) => void;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse({}));
      return new Promise<Response>((resolve) => { resolveGet = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    const startRuntime = vi.fn(() => {
      expect(layoutManager.applied).toEqual(localLayout);
    });

    const bootstrap = bootstrapSharedConfigBeforeRuntime(startRuntime, {
      fetcher: fetcher as typeof fetch,
      storage,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    sharedStorage.setItem('hmi:home-layout:v1', JSON.stringify(localLayout));
    expect(storage.getItem('hmi:home-layout:v1')).toBe(JSON.stringify(localLayout));
    expect(fetcher).toHaveBeenCalledOnce();

    resolveGet(jsonResponse({ 'hmi:home-layout:v1': JSON.stringify(centralLayout) }));
    await bootstrap;

    expect(storage.getItem('hmi:home-layout:v1')).toBe(JSON.stringify(localLayout));
    expect(startRuntime).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT']);
    sharedStorage.setItem('hmi:home-layout:v1', JSON.stringify(localLayout));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT', 'PUT']);
  });

  it('migriert einen zentral fehlenden Layout-Wert genau einmal aus dem neuesten lokalen Stand', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    let resolveGet!: (response: Response) => void;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return Promise.resolve(jsonResponse({}));
      return new Promise<Response>((resolve) => { resolveGet = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    const firstLayout = JSON.stringify({ version: 1, widthPreset: 'compact', slots: [] });
    const latestLayout = JSON.stringify({
      version: 1,
      widthPreset: 'wide',
      slots: [{ id: 'latest-slot', roomId: 'wohnzimmer' }],
    });

    const bootstrap = bootstrapSharedConfig(fetcher as typeof fetch, storage);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    sharedStorage.setItem('hmi:home-layout:v1', firstLayout);
    sharedStorage.setItem('hmi:home-layout:v1', latestLayout);
    resolveGet(jsonResponse({}));
    await bootstrap;

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT']);
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({
      updates: { 'hmi:home-layout:v1': latestLayout },
    });

    sharedStorage.removeItem('hmi:home-layout:v1');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetcher.mock.calls[2]![1]!.body as string)).toEqual({
      updates: { 'hmi:home-layout:v1': null },
    });
  });

  it('repariert nach verlorener Migrations-PUT-Antwort und Modulneustart den neueren lokalen Write', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const key = 'hmi:home-layout:v1';
    const firstLayout = JSON.stringify({ version: 1, widthPreset: 'compact', slots: [] });
    const latestLayout = JSON.stringify({
      version: 1,
      widthPreset: 'wide',
      slots: [{ id: 'latest-slot', roomId: 'wohnzimmer' }],
    });
    const server = new Map<string, string>();
    storage.setItem(key, firstLayout);
    let rejectCommittedPut!: () => void;
    const firstFetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Promise.resolve(jsonResponse({}));
      const { updates } = JSON.parse(init.body as string) as {
        updates: Record<string, string | null>;
      };
      return new Promise<Response>((_resolve, reject) => {
        rejectCommittedPut = () => {
          for (const [updateKey, value] of Object.entries(updates)) {
            if (value === null) server.delete(updateKey);
            else server.set(updateKey, value);
          }
          reject(new Error('Antwort nach Server-Commit verloren'));
        };
      });
    });
    vi.stubGlobal('fetch', firstFetcher);

    const firstBootstrap = bootstrapSharedConfig(firstFetcher as typeof fetch, storage);
    await vi.waitFor(() => expect(firstFetcher).toHaveBeenCalledTimes(2));
    sharedStorage.setItem(key, latestLayout);
    rejectCommittedPut();
    await firstBootstrap;

    expect(server.get(key)).toBe(firstLayout);
    expect(storage.getItem(key)).toBe(latestLayout);
    expect(storage.getItem(SHARED_CONFIG_OUTBOX_KEY)).not.toBeNull();

    // Separater Vite-Modul-Identifier simuliert einen PWA-Prozessneustart ohne
    // den Modul-Cache der übrigen Singleton-Tests global zurückzusetzen.
    // @ts-expect-error Vite unterstützt Query-Module, TypeScript löst sie nicht auf.
    const recoveredModule = await import('./shared-config.ts?recovery');
    // @ts-expect-error Vite unterstützt Query-Module, TypeScript löst sie nicht auf.
    const recoveredBootstrap = await import('./shared-config-bootstrap.ts?recovery');
    const recoveryFetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') {
        return Promise.resolve(jsonResponse(Object.fromEntries(server)));
      }
      const { updates } = JSON.parse(init.body as string) as {
        updates: Record<string, string | null>;
      };
      for (const [updateKey, value] of Object.entries(updates)) {
        if (value === null) server.delete(updateKey);
        else server.set(updateKey, value);
      }
      return Promise.resolve(jsonResponse({}));
    });

    await recoveredBootstrap.bootstrapSharedConfig(
      recoveryFetcher as typeof fetch,
      storage,
      undefined,
      {
        acknowledge: recoveredModule.acknowledgeSharedConfigOutbox,
        begin: recoveredModule.beginSharedConfigOutbox,
        clear: recoveredModule.clearSharedConfigOutbox,
        connect: recoveredModule.connectSharedConfigOutbox,
        read: recoveredModule.readSharedConfigOutbox,
        record: recoveredModule.recordSharedConfigUpdate,
      },
    );

    expect(server.get(key)).toBe(latestLayout);
    expect(storage.getItem(key)).toBe(latestLayout);
    expect(storage.getItem(SHARED_CONFIG_OUTBOX_KEY)).toBeNull();
    expect(recoveryFetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT']);
  });

  it('verwirft ein malformed Outbox-Envelope sicher statt es zu migrieren', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SHARED_CONFIG_OUTBOX_KEY, JSON.stringify({
      version: 99,
      sequence: 'kaputt',
      updates: { 'hmi:ha-url': { value: 'http://falsch:8123', revision: 1 } },
    }));
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}));

    await bootstrapSharedConfig(fetcher as typeof fetch, storage);

    expect(storage.getItem(SHARED_CONFIG_OUTBOX_KEY)).toBeNull();
    expect(storage.getItem('hmi:ha-url')).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('entfernt eine Outbox-Revision erst nach ihrer erfolgreichen PUT-Antwort', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ 'hmi:ha-url': 'http://zentral:8123' }));
    vi.stubGlobal('fetch', fetcher);
    await bootstrapSharedConfig(fetcher as typeof fetch, storage);
    fetcher.mockClear();

    sharedStorage.setItem('hmi:ha-url', 'http://neu:8123');
    expect(storage.getItem(SHARED_CONFIG_OUTBOX_KEY)).not.toBeNull();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(storage.getItem(SHARED_CONFIG_OUTBOX_KEY)).toBeNull());
  });

  it('behält bei verlorener Antwort eines normalen Writes dessen durable Outbox', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const server = new Map<string, string>([['hmi:ha-url', 'http://zentral:8123']]);
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Promise.resolve(jsonResponse(Object.fromEntries(server)));
      const { updates } = JSON.parse(init.body as string) as {
        updates: Record<string, string | null>;
      };
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) server.delete(key);
        else server.set(key, value);
      }
      return Promise.reject(new Error('Antwort nach Server-Commit verloren'));
    });
    vi.stubGlobal('fetch', fetcher);
    await bootstrapSharedConfig(fetcher as typeof fetch, storage);

    sharedStorage.setItem('hmi:ha-url', 'http://neu:8123');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(server.get('hmi:ha-url')).toBe('http://neu:8123');
    const journalEvent = JSON.parse(storage.getItem(SHARED_CONFIG_OUTBOX_KEY) ?? 'null');
    expect(journalEvent).toEqual(['hmi:ha-url', 'http://neu:8123']);
  });

  it('bewahrt einen neueren lokalen Write während des Migrations-PUT zentral auf', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const server = new Map<string, string | null>();
    let resolveGet!: (response: Response) => void;
    const pendingPuts: Array<{
      updates: Record<string, string | null>;
      resolve: () => void;
    }> = [];
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const { updates } = JSON.parse(init.body as string) as {
          updates: Record<string, string | null>;
        };
        return new Promise<Response>((resolve) => {
          pendingPuts.push({
            updates,
            resolve: () => {
              for (const [key, value] of Object.entries(updates)) server.set(key, value);
              resolve(jsonResponse({}));
            },
          });
        });
      }
      return new Promise<Response>((resolve) => { resolveGet = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    const firstLayout = JSON.stringify({ version: 1, widthPreset: 'compact', slots: [] });
    const latestLayout = JSON.stringify({
      version: 1,
      widthPreset: 'wide',
      slots: [{ id: 'latest-slot', roomId: 'wohnzimmer' }],
    });

    const bootstrap = bootstrapSharedConfig(fetcher as typeof fetch, storage);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    sharedStorage.setItem('hmi:home-layout:v1', firstLayout);
    resolveGet(jsonResponse({}));
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(1));
    expect(pendingPuts[0]!.updates).toEqual({ 'hmi:home-layout:v1': firstLayout });

    sharedStorage.setItem('hmi:home-layout:v1', latestLayout);
    expect(storage.getItem('hmi:home-layout:v1')).toBe(latestLayout);
    expect(pendingPuts).toHaveLength(1);

    pendingPuts[0]!.resolve();
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(2));
    expect(pendingPuts[1]!.updates).toEqual({ 'hmi:home-layout:v1': latestLayout });
    pendingPuts[1]!.resolve();
    await bootstrap;

    expect(server.get('hmi:home-layout:v1')).toBe(latestLayout);
    expect(storage.getItem('hmi:home-layout:v1')).toBe(latestLayout);
    expect(fetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT', 'PUT']);
  });

  it('serialisiert auch neuere lokale Writes während des Follow-up-PUT', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    let resolveGet!: (response: Response) => void;
    const pendingPuts: Array<{
      updates: Record<string, string | null>;
      resolve: () => void;
    }> = [];
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const { updates } = JSON.parse(init.body as string) as {
          updates: Record<string, string | null>;
        };
        return new Promise<Response>((resolve) => {
          pendingPuts.push({ updates, resolve: () => resolve(jsonResponse({})) });
        });
      }
      return new Promise<Response>((resolve) => { resolveGet = resolve; });
    });
    vi.stubGlobal('fetch', fetcher);
    const firstLayout = JSON.stringify({ version: 1, widthPreset: 'compact', slots: [] });
    const secondLayout = JSON.stringify({ version: 1, widthPreset: 'wide', slots: [] });
    const latestLayout = JSON.stringify({
      version: 1,
      widthPreset: 'wide',
      slots: [{ id: 'latest-slot', roomId: 'wohnzimmer' }],
    });

    const bootstrap = bootstrapSharedConfig(fetcher as typeof fetch, storage);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    sharedStorage.setItem('hmi:home-layout:v1', firstLayout);
    resolveGet(jsonResponse({}));
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(1));

    sharedStorage.setItem('hmi:home-layout:v1', secondLayout);
    pendingPuts[0]!.resolve();
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(2));
    sharedStorage.setItem('hmi:home-layout:v1', latestLayout);
    pendingPuts[1]!.resolve();
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(3));
    pendingPuts[2]!.resolve();
    await bootstrap;

    expect(pendingPuts.map(({ updates }) => updates)).toEqual([
      { 'hmi:home-layout:v1': firstLayout },
      { 'hmi:home-layout:v1': secondLayout },
      { 'hmi:home-layout:v1': latestLayout },
    ]);
    expect(storage.getItem('hmi:home-layout:v1')).toBe(latestLayout);
  });

  it('wendet den Serverstand vor lokalen Altwerten an und migriert nur fehlende Werte', async () => {
    const storage = new MemoryStorage();
    storage.setItem('hmi:ha-url', 'http://lokal:8123');
    storage.setItem('hmi:jf-url', 'http://lokal:8096');
    storage.setItem('hmi:theme-override', 'lokal-bleibt');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ 'hmi:ha-url': 'http://zentral:8123' }))
      .mockResolvedValueOnce(jsonResponse({}));

    await bootstrapSharedConfig(fetcher as typeof fetch, storage);

    expect(storage.getItem('hmi:ha-url')).toBe('http://zentral:8123');
    expect(storage.getItem('hmi:jf-url')).toBe('http://lokal:8096');
    expect(storage.getItem('hmi:theme-override')).toBe('lokal-bleibt');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const migration = JSON.parse(fetcher.mock.calls[1][1].body as string);
    expect(migration).toEqual({ updates: { 'hmi:jf-url': 'http://lokal:8096' } });
  });

  it('schreibt zentral weiter, wenn lokaler Browser-Storage blockiert ist', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetcher);

    await bootstrapSharedConfig(fetcher as typeof fetch, localStorage);
    fetcher.mockClear();

    expect(() => sharedStorage.setItem('hmi:ha-url', 'http://zentral:8123')).not.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
      updates: { 'hmi:ha-url': 'http://zentral:8123' },
    });
  });

  it('synchronisiert Shared Config vollständig vor Auth- und Runtime-Start', async () => {
    const storage = new MemoryStorage();
    let resolveFetch!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const startRuntime = vi.fn(() => {
      expect(storage.getItem('hmi:ha-token')).toBe('central-token');
    });

    const bootstrap = bootstrapSharedConfigBeforeRuntime(startRuntime, {
      fetcher: fetcher as typeof fetch,
      storage,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(startRuntime).not.toHaveBeenCalled();

    resolveFetch(jsonResponse({ 'hmi:ha-token': 'central-token' }));
    await bootstrap;
    expect(startRuntime).toHaveBeenCalledOnce();
  });

  it('rehydriert alle bereits erzeugten configgebundenen Singletons vor dem Runtime-Start', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const { deviceManager } = await import('./device-manager.svelte.ts');
    const { layoutManager } = await import('./layout-manager.svelte.ts');
    const { sceneManager } = await import('./scene-manager.svelte.ts');
    const { settingsValues } = await import('./settings.svelte.ts');
    const { rehydrateShoppingConfig, shoppingConfig } = await import('./shopping-settings.svelte.ts');
    const { immersionLight, rehydrateImmersionLight } = await import('./immersion-light.svelte.ts');
    const centralDevice = { version: 1, devices: { 'light.wohnzimmer_kugellampen': { name: 'Zentral' } }, order: {} };
    const centralLayout = {
      version: 1,
      widthPreset: 'wide',
      panelSize: 70,
      energyPanelSize: 70,
      roomsPerRow: 2,
      slots: [{ id: 'slot-1', roomId: 'wohnzimmer' }],
    };
    const centralScene = {
      version: 1,
      rooms: { wohnzimmer: { hell: { include: ['switch.zentral'], exclude: [] } } },
    };
    const oldShopping = { version: 1, stores: [{ id: 'altmarkt', label: 'Altmarkt', categories: [] }] };
    const centralShopping = { version: 1, stores: [{ id: 'zentralmarkt', label: 'Zentralmarkt', categories: ['frische'] }] };
    const oldImmersion = {
      version: 1,
      rooms: { kueche: { 'light.old': { x: 0.2, y: 0.3, radius: 0.1 } } },
    };
    const centralImmersion = {
      version: 1,
      rooms: { wohnzimmer: { 'light.central': { x: 0.7, y: 0.4, radius: 0.2 } } },
    };
    storage.setItem('hmi:shopping-config:v1', JSON.stringify(oldShopping));
    storage.setItem('hmi:immersion-light:v1', JSON.stringify(oldImmersion));
    rehydrateShoppingConfig();
    rehydrateImmersionLight();
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({
      'hmi:backend': 'fake',
      'hmi:ha-url': 'http://zentral:8123',
      'hmi:jf-url': 'http://zentral:8096',
      'hmi:library': 'live',
      'hmi:lock-button': 'classic',
      'hmi:device-config:v1': JSON.stringify(centralDevice),
      'hmi:home-layout:v1': JSON.stringify(centralLayout),
      'hmi:scene-config:v1': JSON.stringify(centralScene),
      'hmi:shopping-config:v1': JSON.stringify(centralShopping),
      'hmi:immersion-light:v1': JSON.stringify(centralImmersion),
    }));
    const startRuntime = vi.fn(() => {
      expect(deviceManager.config).toEqual(centralDevice);
      expect(layoutManager.applied).toEqual(centralLayout);
      expect(sceneManager.config).toEqual(centralScene);
      expect(storage.getItem('hmi:shopping-config:v1')).toBe(JSON.stringify(centralShopping));
      expect(shoppingConfig.stores.map(({ id, label }) => ({ id, label }))).toEqual([
        { id: 'zentralmarkt', label: 'Zentralmarkt' },
      ]);
      expect(storage.getItem('hmi:immersion-light:v1')).toBe(JSON.stringify(centralImmersion));
      expect(immersionLight.config).toEqual(centralImmersion);
      expect(settingsValues).toMatchObject({
        demoMode: true,
        haUrl: 'http://zentral:8123',
        jellyfinUrl: 'http://zentral:8096',
        libraryMode: 'live',
        classicLockButton: true,
      });
    });

    expect(deviceManager.config).not.toEqual(centralDevice);
    expect(layoutManager.applied).not.toEqual(centralLayout);
    expect(sceneManager.config).not.toEqual(centralScene);
    expect(shoppingConfig.stores[0]?.id).toBe('altmarkt');
    expect(immersionLight.config).toEqual(oldImmersion);

    await bootstrapSharedConfigBeforeRuntime(startRuntime, {
      fetcher: fetcher as typeof fetch,
      storage,
    });

    expect(startRuntime).toHaveBeenCalledOnce();
  });

  it('startet die Runtime nach einem begrenzten Config-Timeout mit lokalem Stand', async () => {
    const storage = new MemoryStorage();
    storage.setItem('hmi:ha-token', 'local-token');
    const startRuntime = vi.fn();
    let observedSignal: AbortSignal | undefined;
    let observedDelay = 0;

    await bootstrapSharedConfigBeforeRuntime(startRuntime, {
      fetcher: ((_input: RequestInfo | URL, init?: RequestInit) => {
        observedSignal = init?.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }) as typeof fetch,
      storage,
      scheduleTimeout: (callback, timeoutMs) => {
        observedDelay = timeoutMs;
        callback();
        return () => {};
      },
    });

    expect(observedDelay).toBe(SHARED_CONFIG_BOOTSTRAP_TIMEOUT_MS);
    expect(observedSignal?.aborted).toBe(true);
    expect(storage.getItem('hmi:ha-token')).toBe('local-token');
    expect(startRuntime).toHaveBeenCalledOnce();
  });

  it('hält nach einem fehlgeschlagenen Migrations-PUT die Outbox und retried erst beim nächsten Write', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const firstLayout = JSON.stringify({ version: 1, widthPreset: 'compact', slots: [] });
    const latestLayout = JSON.stringify({ version: 1, widthPreset: 'wide', slots: [] });
    storage.setItem('hmi:home-layout:v1', firstLayout);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockRejectedValue(new Error('PUT fehlgeschlagen'));
    vi.stubGlobal('fetch', fetcher);

    await bootstrapSharedConfig(fetcher as typeof fetch, storage);
    sharedStorage.setItem('hmi:home-layout:v1', latestLayout);
    await Promise.resolve();

    expect(storage.getItem('hmi:home-layout:v1')).toBe(latestLayout);
    expect(fetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT', 'PUT']);

    const recoveryFetcher = vi.fn().mockResolvedValue(jsonResponse({
      'hmi:home-layout:v1': latestLayout,
    }));
    await bootstrapSharedConfig(recoveryFetcher as typeof fetch, storage);
  });

  it('hält die Write-Barriere nach einem Abort des Migrations-PUT geschlossen', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const controller = new AbortController();
    const firstLayout = JSON.stringify({ version: 1, widthPreset: 'compact', slots: [] });
    const latestLayout = JSON.stringify({ version: 1, widthPreset: 'wide', slots: [] });
    storage.setItem('hmi:home-layout:v1', firstLayout);
    const pendingPuts: Array<(response: Response) => void> = [];
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Promise<Response>((resolve) => { pendingPuts.push(resolve); });
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetcher);

    const bootstrap = bootstrapSharedConfig(fetcher as typeof fetch, storage, controller.signal);
    await vi.waitFor(() => expect(pendingPuts).toHaveLength(1));
    controller.abort();
    pendingPuts[0]!(jsonResponse({}));
    await bootstrap;
    sharedStorage.setItem('hmi:home-layout:v1', latestLayout);
    await Promise.resolve();

    expect(storage.getItem('hmi:home-layout:v1')).toBe(latestLayout);
    expect(fetcher.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'PUT']);

    const recoveryFetcher = vi.fn().mockResolvedValue(jsonResponse({
      'hmi:home-layout:v1': latestLayout,
    }));
    await bootstrapSharedConfig(recoveryFetcher as typeof fetch, storage);
  });

  /* Credential-Cutover (H12): der Wechsel in eine Gastoberfläche löscht die
     lokalen Zugangsdaten — aber ausdrücklich nur lokal. Ein Weg über
     `sharedStorage` würde ein Outbox-Ereignis schreiben und den Wert damit auch
     zentral in /data/config.json löschen; der Admin wäre danach ausgesperrt. */
  it('löscht sensible Werte lokal, ohne sie zentral zu entfernen', async () => {
    const storage = new MemoryStorage();
    storage.setItem('hmi:ha-token', 'admin-token');
    storage.setItem('hmi:jf-token', 'jellyfin-token');
    vi.stubGlobal('localStorage', storage);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ 'hmi:ha-token': 'admin-token' }));
    await bootstrapSharedConfig(fetcher as typeof fetch, storage);
    expect(storage.getItem(SHARED_CONFIG_OUTBOX_KEY)).toBeNull();
    const callsBeforePurge = fetcher.mock.calls.length;

    const { purgeHotelSensitiveValues } = await import('../hotel-mode-activation.ts');
    const removed = purgeHotelSensitiveValues(storage);
    await Promise.resolve();

    expect(removed.sort()).toEqual(['hmi:ha-token', 'hmi:jf-token']);
    expect(storage.getItem('hmi:ha-token')).toBeNull();
    // Entscheidend: kein Outbox-Ereignis und damit kein zentraler Write.
    expect(storage.getItem(SHARED_CONFIG_OUTBOX_KEY)).toBeNull();
    expect(fetcher.mock.calls.length).toBe(callsBeforePurge);
  });

  it('führt ausschließlich explizit gemeinsame Schlüssel', () => {
    expect(SHARED_CONFIG_KEYS).toContain('hmi:device-config:v1');
    expect(SHARED_CONFIG_KEYS).toContain('hmi:ha-token');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:ha-cache');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:theme-override');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:appearance-mode');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:jf-device');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:ui-mode');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:notion-bridge-url');
  });
});
