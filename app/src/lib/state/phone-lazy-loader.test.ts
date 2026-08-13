import { describe, expect, it, vi } from 'vitest';
import phoneHome from '../components/phone/PhoneHomeFeed.svelte?raw';
import phoneShell from '../shells/PhoneAppShell.svelte?raw';
import lazyLoaderSource from './phone-lazy-loader.ts?raw';
import { createLatestPhoneLoader } from './phone-lazy-loader.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('phone inactive-view source boundaries', () => {
  it('keeps active Home synchronous while Settings, System and More stay literal-dynamic', () => {
    expect(phoneShell).toMatch(/^\s*import PhoneHomeFeed from ['"]\.\.\/components\/phone\/PhoneHomeFeed\.svelte['"]/m);
    expect(phoneShell).not.toMatch(/^\s*import MoreSheet from/m);
    expect(phoneShell).not.toMatch(/^\s*import SystemScreen from/m);
    expect(phoneHome).not.toMatch(/^\s*import\s*\{?\s*settingsValues/m);
    expect(phoneHome).toContain("import('./PhoneClimateDock.svelte')");
    expect(phoneHome).toContain("import('./RoomSummaryCard.svelte')");

    expect(lazyLoaderSource).toContain("import('../components/phone/MoreSheet.svelte')");
    expect(lazyLoaderSource).toContain("import('../screens/SystemScreen.svelte')");
    expect(lazyLoaderSource).toContain("import('./settings.svelte.ts')");
    expect(lazyLoaderSource).not.toMatch(/import\(\s*`|import\(\s*[A-Za-z_$]/);
  });

  it('loads the full panel and feature stylesheet only beyond the synchronous Home boundary', () => {
    expect(phoneShell).not.toMatch(/^\s*import ['"]\.\.\/\.\.\/styles\/app\.css['"]/m);
    expect(phoneShell).toContain("import('../../styles/app.css')");
  });

  it('exposes explicit loading, error and retry states for the on-demand System view', () => {
    expect(phoneShell).toMatch(/systemLoadFailed/);
    expect(phoneShell).toMatch(/role="status"/);
    expect(phoneShell).toMatch(/role="alert"/);
    expect(phoneShell).toMatch(/onclick=\{ensureSystemScreen\}/);
  });
});

describe('latest phone lazy loader', () => {
  it('accepts only the latest request when loads resolve out of order', async () => {
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    const accept = vi.fn();
    const loader = createLatestPhoneLoader({
      first: () => first.promise,
      second: () => second.promise,
    });

    const firstLoad = loader.load('first', accept);
    const secondLoad = loader.load('second', accept);
    second.resolve({ id: 'second' });
    await secondLoad;
    first.resolve({ id: 'first' });
    await firstLoad;

    expect(accept).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith({ id: 'second' });
  });

  it('does not cache a rejected attempt and succeeds on an explicit retry', async () => {
    const accept = vi.fn();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ id: 'recovered' });
    const loader = createLatestPhoneLoader({ screen: load });

    await expect(loader.load('screen', accept)).rejects.toThrow('chunk unavailable');
    expect(accept).not.toHaveBeenCalled();

    await expect(loader.load('screen', accept)).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledWith({ id: 'recovered' });
  });

  it('deduplicates concurrent attempts, caches only success and can cancel stale acceptance', async () => {
    const attempt = deferred<{ id: string }>();
    const load = vi.fn(() => attempt.promise);
    const accept = vi.fn();
    const loader = createLatestPhoneLoader({ screen: load });

    const firstLoad = loader.load('screen', accept);
    const secondLoad = loader.load('screen', accept);
    loader.cancel();
    attempt.resolve({ id: 'ready' });
    await Promise.all([firstLoad, secondLoad]);

    expect(load).toHaveBeenCalledOnce();
    expect(accept).not.toHaveBeenCalled();

    await loader.load('screen', accept);
    expect(load).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledWith({ id: 'ready' });
  });
});
