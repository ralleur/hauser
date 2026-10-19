import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('location', { search: '' });
const { hud, hudClockTap, simulator } = await import('./hud.svelte.ts');

describe('Uhr-Geste', () => {
  afterEach(() => {
    vi.useRealTimers();
    hud.active = false;
    simulator.active = false;
  });

  it('öffnet den Simulator auch mit gemächlichen Mausklicks', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) { hudClockTap(); vi.advanceTimersByTime(400); }
    expect(simulator.active).toBe(true);
    expect(hud.active).toBe(false);
  });

  it('beginnt nach einer Pause neu zu zählen', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) { hudClockTap(); vi.advanceTimersByTime(300); }
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 2; i++) { hudClockTap(); vi.advanceTimersByTime(300); }
    expect(simulator.active).toBe(false);
  });
});
