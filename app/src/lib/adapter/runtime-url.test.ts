import { describe, expect, it, vi } from 'vitest';
import { AdapterRuntime, configuredHaUrl, defaultHaUrl, seed } from './runtime.svelte.ts';
import type { Backend, ConnectionStatus } from './types.ts';
import { configuredBackendKind } from '../state/runtime-backend-sync.ts';
import { LAUNDRY_ENTITIES } from '../state/entities.ts';

class StubBackend implements Backend {
  starts = 0;
  constructor(
    private readonly value: string,
    private readonly status: ConnectionStatus,
  ) {}
  start(): void { this.starts += 1; }
  subscribe(cb: (entityId: string, value: unknown) => void): void { cb('sensor.test', this.value); }
  callService(): void {}
  onConnectionChange(cb: (status: ConnectionStatus) => void): void { cb(this.status); }
}

class ControlledBackend implements Backend {
  starts = 0;
  visible: string[][] = [];
  update: ((entityId: string, value: unknown, stale?: boolean) => void) | null = null;
  connection: ((status: ConnectionStatus) => void) | null = null;
  commandError: ((entityId: string) => void) | null = null;
  catalog: ((items: unknown[]) => void) | null = null;

  constructor(private readonly initialStatus: ConnectionStatus = 'connected') {}

  start(): void { this.starts += 1; }
  subscribe(cb: (entityId: string, value: unknown, stale?: boolean) => void): void { this.update = cb; }
  callService(): void {}
  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    this.connection = cb;
    cb(this.initialStatus);
  }
  onCommandError(cb: (entityId: string) => void): void { this.commandError = cb; }
  subscribeCatalog(cb: (items: unknown[]) => void): void { this.catalog = cb; }
  setVisible(entityIds: readonly string[]): void { this.visible.push([...entityIds]); }
}

describe('runtime HA URL defaults', () => {
  it('uses the HTTPS HA endpoint for an HTTPS PWA origin', () => {
    expect(defaultHaUrl('https:')).toBe('https://homeassistant.example.com');
  });

  it('keeps the direct LAN endpoint for an HTTP/LAN origin', () => {
    expect(defaultHaUrl('http:')).toBe('http://homeassistant.local:8123');
  });

  it('resolves a centrally synchronized override at backend start time', () => {
    const storage = { getItem: vi.fn(() => 'https://ha.example.test') };
    expect(configuredHaUrl(storage)).toBe('https://ha.example.test');
    expect(storage.getItem).toHaveBeenCalledWith('hmi:ha-url');
  });
});

describe('runtime backend bootstrap', () => {
  it('does not invent initial laundry values', () => {
    for (const adapter of Object.values(LAUNDRY_ENTITIES)) {
      if (adapter) expect(seed.has(adapter.entityId)).toBe(false);
    }
  });

  it('derives the backend kind from synchronized storage', () => {
    expect(configuredBackendKind({ getItem: () => 'fake' }, undefined)).toBe('fake');
    expect(configuredBackendKind({ getItem: () => 'ha' }, undefined)).toBe('ha');
    expect(configuredBackendKind({ getItem: () => null }, 'fake')).toBe('fake');
  });

  it('replaces the provisional backend exactly once before external start', () => {
    const provisional = new StubBackend('cached', 'disconnected');
    const configured = new StubBackend('configured', 'connected');
    const runtime = new AdapterRuntime(provisional);

    expect(runtime.store.get('sensor.test')?.value).toBe('cached');
    runtime.setBackend(configured);
    expect(runtime.store.get('sensor.test')?.value).toBe('configured');
    expect(runtime.connectionStatus).toBe('connected');

    runtime.start();

    expect(provisional.starts).toBe(0);
    expect(configured.starts).toBe(1);
    expect(runtime.store.get('sensor.test')?.value).toBe('configured');
  });

  it('invalidates every old callback generation and transfers catalog and visible subscriptions', () => {
    const provisional = new ControlledBackend();
    const configured = new ControlledBackend();
    const runtime = new AdapterRuntime(provisional);
    const catalogs: unknown[][] = [];

    runtime.subscribeCatalog((items) => catalogs.push(items));
    runtime.setVisible(['light.visible', 'sensor.visible']);
    provisional.update?.('light.test', { on: false });
    runtime.dispatch({
      entityId: 'light.test',
      domain: 'light',
      service: 'turn_on',
      data: {},
      queuedAt: 1,
    }, { on: true });

    runtime.setBackend(configured);

    expect(configured.visible).toEqual([['light.visible', 'sensor.visible']]);
    expect(configured.catalog).not.toBeNull();

    configured.catalog?.(['configured-catalog']);
    configured.connection?.('reconnecting');
    expect(catalogs).toEqual([['configured-catalog']]);
    expect(runtime.connectionStatus).toBe('reconnecting');

    provisional.update?.('light.test', { on: false, source: 'stale' });
    provisional.connection?.('disconnected');
    provisional.commandError?.('light.test');
    provisional.catalog?.(['stale-catalog']);

    expect(runtime.store.get('light.test')?.value).toEqual({ on: false });
    expect(runtime.connectionStatus).toBe('reconnecting');
    expect(runtime.intentStatus('light.test')).toBe('inflight');
    expect(catalogs).toEqual([['configured-catalog']]);

    configured.update?.('light.test', { on: true });
    expect(runtime.intentStatus('light.test')).toBeNull();
  });

  it('deletes removed backend entities instead of retaining an undefined store record', () => {
    const controlled = new ControlledBackend();
    const runtime = new AdapterRuntime(controlled);

    controlled.update?.('input_select.fixture_washer', { state: 'running', changedAt: 100 });
    expect(runtime.store.has('input_select.fixture_washer')).toBe(true);

    controlled.update?.('input_select.fixture_washer', undefined);

    expect(runtime.store.has('input_select.fixture_washer')).toBe(false);
    expect(runtime.merged('input_select.fixture_washer')).toBeUndefined();
  });

  it('passes each configured laundry helper and cycle marker through the productive HA constructor', async () => {
    const helperId = 'sensor.fixture_washer_status';
    const markerId = 'automation.fixture_washer_cycle';
    const constructorOptions: Array<{ laundryEntityIds?: readonly string[] }> = [];

    vi.resetModules();
    vi.doMock('./ha-backend.ts', () => ({
      HaBackend: class implements Backend {
        constructor(options: { laundryEntityIds?: readonly string[] }) {
          constructorOptions.push(options);
        }
        subscribe(): void {}
        callService(): void {}
        onConnectionChange(cb: (status: ConnectionStatus) => void): void { cb('connecting'); }
      },
    }));
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem: () => null });

    try {
      const { legacyHouseholdRuntimeModel } = await import('../config/legacy-household-config.ts');
      const { installActiveHouseholdData } = await import('../config/household-runtime-data.ts');
      installActiveHouseholdData({
        ...legacyHouseholdRuntimeModel,
        subscriptionEntityIds: [
          ...legacyHouseholdRuntimeModel.subscriptionEntityIds,
          helperId,
          markerId,
        ],
        globalEntities: {
          ...legacyHouseholdRuntimeModel.globalEntities,
          laundry: {
            ...legacyHouseholdRuntimeModel.globalEntities.laundry,
            washer: {
              type: 'entity',
              entityId: helperId,
              runningStates: ['running'],
              doneStates: ['done'],
              doneOnInitial: true,
              cycleMarkerEntityId: markerId,
            },
          },
        },
      });

      await import('./runtime.svelte.ts');

      expect(constructorOptions).toHaveLength(1);
      expect(constructorOptions[0].laundryEntityIds).toEqual(
        expect.arrayContaining([helperId, markerId]),
      );
    } finally {
      vi.doUnmock('./ha-backend.ts');
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
