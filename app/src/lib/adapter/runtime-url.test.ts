import { describe, expect, it, vi } from 'vitest';
import { AdapterRuntime, configuredHaUrl, defaultHaUrl } from './runtime.svelte.ts';
import type { Backend, ConnectionStatus } from './types.ts';
import { configuredBackendKind } from '../state/runtime-backend-sync.ts';

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
  services: Array<{ domain: string; service: string; entityId: string; data: Record<string, unknown> }> = [];
  renames: Array<{ entityId: string; name: string }> = [];
  update: ((entityId: string, value: unknown, stale?: boolean, available?: boolean) => void) | null = null;
  connection: ((status: ConnectionStatus) => void) | null = null;
  commandError: ((entityId: string) => void) | null = null;
  catalog: ((items: unknown[]) => void) | null = null;

  constructor(private readonly initialStatus: ConnectionStatus = 'connected') {}

  start(): void { this.starts += 1; }
  subscribe(cb: (entityId: string, value: unknown, stale?: boolean, available?: boolean) => void): void { this.update = cb; }
  callService(domain: string, service: string, entityId: string, data: Record<string, unknown>): void {
    this.services.push({ domain, service, entityId, data });
  }
  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    this.connection = cb;
    cb(this.initialStatus);
  }
  onCommandError(cb: (entityId: string) => void): void { this.commandError = cb; }
  subscribeCatalog(cb: (items: unknown[]) => void): void { this.catalog = cb; }
  setVisible(entityIds: readonly string[]): void { this.visible.push([...entityIds]); }
  async renameEntity(entityId: string, name: string): Promise<void> { this.renames.push({ entityId, name }); }
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
});

describe('runtime entity availability', () => {
  it('keeps the last-known value while exposing explicit availability changes', () => {
    const backend = new ControlledBackend();
    const runtime = new AdapterRuntime(backend);

    backend.update?.('light.test', { on: true, brightness: 42 }, false, true);
    backend.update?.('light.test', undefined, false, false);

    expect(runtime.isEntityAvailable('light.test')).toBe(false);
    expect(runtime.store.get('light.test')).toMatchObject({
      value: { on: true, brightness: 42 },
      available: false,
    });

    backend.update?.('light.test', { on: false, brightness: 17 }, false, true);
    expect(runtime.isEntityAvailable('light.test')).toBe(true);
    expect(runtime.merged('light.test')).toEqual({ on: false, brightness: 17 });
  });

  it.each([
    ['light.test', { on: true, brightness: 42 }],
    ['climate.test', { target: 21, hvac: 'heat', current: 20 }],
    ['sun.sun', { day: true }],
    ['media_player.kitchen', { playing: true, available: true }],
    ['camera.garden', { available: true, entityPicture: '/api/camera_proxy/camera.garden' }],
    ['sensor.house_power', { value: 2480, unit: 'W' }],
    ['switch.test', { on: true }],
    ['input_boolean.test', { on: true }],
    ['binary_sensor.test', { on: true }],
    ['fan.test', { on: true }],
    ['cover.test', { on: true }],
  ])('keeps unavailable %s values as last-known context', (entityId, value) => {
    const backend = new ControlledBackend();
    const runtime = new AdapterRuntime(backend);

    backend.update?.(entityId, value, false, true);
    backend.update?.(entityId, undefined, false, false);

    expect(runtime.store.get(entityId)?.value).toEqual(value);
    expect(runtime.merged(entityId)).toEqual(value);
    expect(runtime.isEntityAvailable(entityId)).toBe(false);
  });

  it('defaults unknown and legacy backend updates to available', () => {
    const backend = new ControlledBackend();
    const runtime = new AdapterRuntime(backend);

    expect(runtime.isEntityAvailable('light.not-seen')).toBe(true);
    backend.update?.('light.test', { on: false });
    expect(runtime.isEntityAvailable('light.test')).toBe(true);
  });

  it('blocks dispatch, send, and rename without creating an optimistic intent', async () => {
    const backend = new ControlledBackend();
    const runtime = new AdapterRuntime(backend);
    const command = {
      entityId: 'light.test',
      domain: 'light',
      service: 'turn_on',
      data: {},
      queuedAt: 1,
    };
    backend.update?.('light.test', { on: false, brightness: 20 });
    backend.update?.('light.test', undefined, false, false);

    runtime.dispatch(command, { on: true, brightness: 20 });
    runtime.send({ ...command, service: 'toggle' });
    await expect(runtime.renameEntity('light.test', 'Testlicht')).rejects.toThrow('nicht verfügbar');
    await Promise.resolve();

    expect(runtime.intentStatus('light.test')).toBeNull();
    expect(runtime.merged('light.test')).toEqual({ on: false, brightness: 20 });
    expect(backend.services).toEqual([]);
    expect(backend.renames).toEqual([]);
  });
});
