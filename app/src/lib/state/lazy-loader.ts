export type LazyImporter<T> = () => Promise<T>;

export function createRetryableLazyCache<Key extends string, Loaded>() {
  const successful = new Map<Key, Loaded>();
  const pending = new Map<Key, Promise<Loaded>>();

  function load(key: Key, importer: LazyImporter<Loaded>): Promise<Loaded> {
    if (successful.has(key)) return Promise.resolve(successful.get(key) as Loaded);

    const existing = pending.get(key);
    if (existing) return existing;

    let attempt!: Promise<Loaded>;
    attempt = Promise.resolve()
      .then(importer)
      .then((loaded) => {
        successful.set(key, loaded);
        return loaded;
      })
      .finally(() => {
        if (pending.get(key) === attempt) pending.delete(key);
      });
    pending.set(key, attempt);
    return attempt;
  }

  return { load };
}

/**
 * Success-only cache for lazy chunks and other optional resources.
 * Concurrent callers share one attempt. A rejection is never retained, so an
 * explicit retry always invokes the literal importer again.
 */
export function createRetryableLazyLoader<Key extends string, Loaded>(
  loaders: Record<Key, LazyImporter<Loaded>>,
) {
  const cache = createRetryableLazyCache<Key, Loaded>();

  function load(key: Key): Promise<Loaded> {
    return cache.load(key, loaders[key]);
  }

  return { load };
}

/**
 * Adds latest-request-wins acceptance for imperative component assignment.
 * Stale successes remain in the success cache, but cannot replace the active
 * target. Stale failures are intentionally ignored by the caller-facing task.
 */
export function createLatestLazyLoader<Key extends string, Loaded>(
  loaders: Record<Key, LazyImporter<Loaded>>,
) {
  const retryable = createRetryableLazyLoader(loaders);
  let latestRequest = 0;

  return {
    async load(key: Key, accept: (loaded: Loaded) => void): Promise<void> {
      const request = ++latestRequest;
      try {
        const loaded = await retryable.load(key);
        if (request === latestRequest) accept(loaded);
      } catch (error) {
        if (request === latestRequest) throw error;
      }
    },
    cancel(): void {
      latestRequest += 1;
    },
  };
}
