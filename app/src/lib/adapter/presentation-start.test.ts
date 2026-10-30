// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('website presentation initial lights', () => {
  it('starts every backend lamp off before the presentation mounts', async () => {
    vi.stubEnv('VITE_DEMO', '1');
    vi.stubGlobal('location', new URL('https://hauserhome.app/presentation/?presentation=1'));
    const { seed, runtime } = await import('./runtime.svelte.ts');
    const lamps = [...seed.keys()].filter(id => id.startsWith('light.'));
    expect(lamps.length).toBeGreaterThan(0);
    for (const id of lamps) expect(runtime.merged(id), id).toMatchObject({ on: false });
  });
});
