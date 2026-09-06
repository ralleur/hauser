import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DURATION_FALLBACK_MS,
  EASING_FALLBACK,
  parseDurationMs,
  slideFade,
  tokenDuration,
  tokenEasing,
  withViewTransition,
} from './index.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubComputedStyle(values: Record<string, string>): void {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => values[name] ?? '' }));
  vi.stubGlobal('document', { documentElement: {} });
}

describe('Motion-Tokens', () => {
  it('parst Millisekunden und Sekunden', () => {
    expect(parseDurationMs('240ms')).toBe(240);
    expect(parseDurationMs('0.3s')).toBe(300);
    expect(parseDurationMs('')).toBeNull();
    expect(parseDurationMs('schnell')).toBeNull();
  });

  it('liest Dauer und Kurve aus den Tokens und fällt sonst auf die Vorgaben zurück', () => {
    expect(tokenDuration(null, 'slow')).toBe(DURATION_FALLBACK_MS.slow);
    expect(tokenEasing(null, 'spring')).toBe(EASING_FALLBACK.spring);
    stubComputedStyle({ '--duration-slow': '0ms', '--ease-spring': 'linear' });
    expect(tokenDuration(null, 'slow')).toBe(0);
    expect(tokenEasing(null, 'spring')).toBe('linear');
  });

  it('baut die Screen-Transition aus Spacing- und Dauer-Token', () => {
    stubComputedStyle({ '--space-6': '24px', '--duration-slow': '240ms' });
    const config = slideFade({} as Element, { direction: 1 });
    expect(config.duration).toBe(240);
    expect(config.css?.(0, 1, )).toBe('opacity:0;transform:translate3d(24px,0,0)');
    expect(slideFade({} as Element, { direction: -1 }).css?.(0.5, 0.5)).toBe('opacity:0.5;transform:translate3d(-12px,0,0)');
  });
});

describe('withViewTransition', () => {
  it('läuft ohne View-Transition-API sofort und wartet auf das DOM', async () => {
    const update = vi.fn();
    await withViewTransition(update, { doc: {} as Document });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('nutzt die View-Transition-API, wenn Bewegung erlaubt ist', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const update = vi.fn();
    const startViewTransition = vi.fn((run: () => void) => { run(); return { finished: Promise.resolve() }; });
    await withViewTransition(update, { doc: { startViewTransition } as unknown as Document });
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('überspringt die View Transition unter reduced motion', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const startViewTransition = vi.fn();
    const update = vi.fn();
    await withViewTransition(update, { doc: { startViewTransition } as unknown as Document });
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
