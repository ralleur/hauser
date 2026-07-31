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
