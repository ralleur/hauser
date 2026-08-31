import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { createPwaUpdateCoordinator } from './pwa-update.ts';

describe('PWA update activation', () => {
  /* B-27 C: Das frueher hier geforderte 15-s-Kaltstartfenster ist entfallen. Es
     erlaubte genau den Reload waehrend der sichtbaren Nutzung, den der Hinweis
     ersetzt. Uebrig bleibt das Ambient-/Hidden-Gate fuer den Kiosk. */
  it('never activates a waiting worker while the app is visible', () => {
    const lifecycle = readFileSync(new URL('./pwa-lifecycle.ts', import.meta.url), 'utf8');
    expect(lifecycle).toMatch(
      /const safeToActivate = \(\) => ambientActive \|\| document\.visibilityState === 'hidden'/,
    );
    // Auf Code gepruefte Abwesenheit — der erklaerende Kommentar darf den
    // Namen weiterhin nennen.
    expect(lifecycle).not.toMatch(/let startupSafe/);
    expect(lifecycle).not.toMatch(/startupSafe\s*=/);
    expect(lifecycle).not.toMatch(/\}, 15_000\)/);
    expect(lifecycle).not.toMatch(/addEventListener\('pointerdown', markInteractive/);
  });

  it('offers the waiting worker to the user when it cannot activate on its own', () => {
    const lifecycle = readFileSync(new URL('./pwa-lifecycle.ts', import.meta.url), 'utf8');
    expect(lifecycle).toMatch(/if \(coordinator\.pending\) offerPwaUpdate\(/);
    const shell = readFileSync(
      new URL('../shells/PhoneAppShell.svelte', import.meta.url),
      'utf8',
    );
    expect(shell).toMatch(/\{#if pwaUpdatePrompt\.pending\}/);
    expect(shell).toMatch(/onclick=\{applyPwaUpdate\}/);
    // Nicht modal: kein Scrim, keine Fokusfalle, kein dialog-Element.
    expect(shell).not.toMatch(/phone-update-hint-scrim/);
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