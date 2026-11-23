// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCommute } from './commute.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('Commute view preference', () => {
  it('retains both manual choices across a new layer and module load', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value) });
    let state = await import('./commute.svelte.ts');
    expect(state.commuteView.mode).toBeNull();
    state.setCommuteView(true);
    vi.resetModules();
    state = await import('./commute.svelte.ts');
    expect(state.commuteView.mode).toBe(true);
    state.setCommuteView(false);
    vi.resetModules();
    expect((await import('./commute.svelte.ts')).commuteView.mode).toBe(false);
  });
});

describe('Commute map background requests', () => {
  it('requests a map before the first viewport has been measured', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const fetchImpl = vi.fn(async (_url: string) => Response.json({ config: defaultCommute, route: null }));
    vi.stubGlobal('fetch', fetchImpl);
    const { refreshCommute } = await import('./commute.svelte.ts');
    await refreshCommute();
    const query = new URL(fetchImpl.mock.calls[0][0], 'http://hauser.local').searchParams;
    expect(query.has('mapBounds')).toBe(false);
    expect(query.get('waitForMap')).toBe('1');
  });

  it('preloads the remembered viewport and retains it while the commute is hidden', async () => {
    const storage = new Map([['hmi:commute:map-bounds:v1', '[-512,-512,1536,1024]']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const fetchImpl = vi.fn(async (_url: string) => Response.json({ config: defaultCommute, route: null }));
    vi.stubGlobal('fetch', fetchImpl);
    const { coverCommuteMap, refreshCommute } = await import('./commute.svelte.ts');
    await refreshCommute();
    expect(fetchImpl.mock.calls[0][0]).toContain('mapBounds=-512,-512,1536,1024');
    coverCommuteMap([-768, -512, 1536, 1024]);
    await refreshCommute();
    coverCommuteMap(null);
    await refreshCommute();
    expect(fetchImpl.mock.lastCall?.[0]).toContain('mapBounds=-768,-512,1536,1024');
    expect(storage.get('hmi:commute:map-bounds:v1')).toBe('[-768,-512,1536,1024]');
  });

  it('keeps a prepared map on a failed background refresh', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const route = { name: 'Work', durationMinutes: 37, updatedAt: new Date().toISOString(),
      line: [[0, 0], [680, 285]], roads: [[[0, 0], [50, 50]]], areas: [], sections: [], reports: [],
      mapStatus: 'ready', mapKey: 'map-one' };
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ config: defaultCommute, route }))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchImpl);
    const { commute, refreshCommute } = await import('./commute.svelte.ts');
    await refreshCommute();
    const prepared = commute.route;
    await refreshCommute();
    expect(commute.route).toBe(prepared);
    await refreshCommute();
    expect(commute.route).toBe(prepared);
    expect(fetchImpl.mock.lastCall?.[0]).toContain('mapKey=map-one');
  });
});
