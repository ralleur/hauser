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
    for (let i = 0; i < 5; i++) { hudClockTap(); vi.advanceTimersByTime(900); }
    expect(simulator.active).toBe(true);
    expect(hud.active).toBe(false);
  });

  it('lässt nach drei oder vier Tipps kein HUD stehen', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 4; i++) { hudClockTap(); vi.advanceTimersByTime(300); }
    vi.advanceTimersByTime(2000);
    expect(hud.active).toBe(false);
    expect(simulator.active).toBe(false);
    for (let i = 0; i < 5; i++) { hudClockTap(); vi.advanceTimersByTime(300); }
    expect(simulator.active).toBe(true);
  });

  it('beginnt nach einer Pause neu zu zählen', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) { hudClockTap(); vi.advanceTimersByTime(300); }
    vi.advanceTimersByTime(1500);
    for (let i = 0; i < 2; i++) { hudClockTap(); vi.advanceTimersByTime(300); }
    expect(simulator.active).toBe(false);
  });
});
