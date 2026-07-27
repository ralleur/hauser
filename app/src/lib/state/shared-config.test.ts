import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapSharedConfig, sharedStorage, SHARED_CONFIG_KEYS } from './shared-config.ts';

afterEach(() => vi.unstubAllGlobals());

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

    expect(() => sharedStorage.setItem('hmi:ha-url', 'http://zentral:8123')).not.toThrow();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
      updates: { 'hmi:ha-url': 'http://zentral:8123' },
    });
  });

  it('führt ausschließlich explizit gemeinsame Schlüssel', () => {
    expect(SHARED_CONFIG_KEYS).toContain('hmi:device-config:v1');
    expect(SHARED_CONFIG_KEYS).toContain('hmi:ha-token');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:ha-cache');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:theme-override');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:jf-device');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:ui-mode');
    expect(SHARED_CONFIG_KEYS).not.toContain('hmi:notion-bridge-url');
  });
});
