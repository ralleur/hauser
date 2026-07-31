import { describe, expect, it, vi } from 'vitest';
import { createLatestLazyLoader, createRetryableLazyLoader } from './lazy-loader.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('retryable lazy loader', () => {
  it('deduplicates parallel attempts and caches only a successful result', async () => {
    const attempt = deferred<{ id: string }>();
    const importer = vi.fn(() => attempt.promise);
    const loader = createRetryableLazyLoader({ screen: importer });

    const first = loader.load('screen');
    const second = loader.load('screen');
    expect(first).toBe(second);
    await Promise.resolve();
    expect(importer).toHaveBeenCalledOnce();

    attempt.resolve({ id: 'ready' });
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 'ready' }, { id: 'ready' }]);
    await expect(loader.load('screen')).resolves.toEqual({ id: 'ready' });
    expect(importer).toHaveBeenCalledOnce();
  });

  it('removes a rejected attempt so retry performs a real new import', async () => {
    const importer = vi.fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ id: 'recovered' });
    const loader = createRetryableLazyLoader({ screen: importer });

    await expect(loader.load('screen')).rejects.toThrow('chunk unavailable');
    await expect(loader.load('screen')).resolves.toEqual({ id: 'recovered' });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('accepts only the latest requested target while still caching stale success', async () => {
    const first = deferred<{ id: string }>();
    const second = deferred<{ id: string }>();
    const accept = vi.fn();
    const loader = createLatestLazyLoader({
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
    await loader.load('first', accept);
    expect(accept).toHaveBeenLastCalledWith({ id: 'first' });
  });
});
