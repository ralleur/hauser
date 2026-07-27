import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { createPwaUpdateCoordinator } from './pwa-update.ts';

describe('PWA update activation', () => {
  it('keeps a bounded cold-start window even if the first tap is immediate', () => {
    const lifecycle = readFileSync(new URL('./pwa-lifecycle.ts', import.meta.url), 'utf8');
    expect(lifecycle).toMatch(/let startupSafe = true/);
    expect(lifecycle).toMatch(/startupSafe \|\| ambientActive \|\| document\.visibilityState === 'hidden'/);
    expect(lifecycle).toMatch(/window\.setTimeout\(\(\) => \{/);
    expect(lifecycle).toMatch(/startupSafe = false/);
    expect(lifecycle).toMatch(/\}, 15_000\)/);
    expect(lifecycle).not.toMatch(/addEventListener\('pointerdown', markInteractive/);
  });
  it('keeps an update waiting while the app is being used', async () => {
    const activate = vi.fn(async () => undefined);
    const coordinator = createPwaUpdateCoordinator(activate, false);
    coordinator.requestActivation();
    await Promise.resolve();
    expect(coordinator.pending).toBe(true);
    expect(activate).not.toHaveBeenCalled();
  });

  it('activates a waiting update once Ambient or hidden state is safe', async () => {
    const activate = vi.fn(async () => undefined);
    const coordinator = createPwaUpdateCoordinator(activate, false);
    coordinator.requestActivation();
    coordinator.setSafeToActivate(true);
    await Promise.resolve();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(coordinator.pending).toBe(false);
  });

  it('retries a failed activation only after the safety state changes again', async () => {
    const activate = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);
    const coordinator = createPwaUpdateCoordinator(activate, true);
    coordinator.requestActivation();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(coordinator.pending).toBe(true);
    coordinator.setSafeToActivate(false);
    coordinator.setSafeToActivate(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(activate).toHaveBeenCalledTimes(2);
    expect(coordinator.pending).toBe(false);
  });
});