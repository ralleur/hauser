export type PhoneLazyImporter<T> = () => Promise<T>;

/**
 * Race-safe loader for imperative phone assignments. Keeping this tiny loader
 * on the phone side avoids pulling the generic recovery chunk into Home's
 * startup closure; the generic cache remains behind the feature/layer seams.
 */
export function createLatestPhoneLoader<Key extends string, Loaded>(
  loaders: Record<Key, PhoneLazyImporter<Loaded>>,
) {
  let latestRequest = 0;
  const attempts = new Map<Key, Promise<Loaded>>();

  function loadValue(key: Key): Promise<Loaded> {
    const existing = attempts.get(key);
    if (existing) return existing;
    const attempt = Promise.resolve().then(() => loaders[key]());
    attempts.set(key, attempt);
    void attempt.catch(() => {
      if (attempts.get(key) === attempt) attempts.delete(key);
    });
    return attempt;
  }

  return {
    loadValue,
    async load(key: Key, accept: (loaded: Loaded) => void): Promise<void> {
      const request = ++latestRequest;
      try {
        const loaded = await loadValue(key);
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

export function createPhoneLayerLoader() {
  return createLatestPhoneLoader({
    more: () => import('../components/phone/MoreSheet.svelte'),
  });
}

export function createPhoneSystemLoader() {
  return createLatestPhoneLoader({
    system: () => import('../screens/SystemScreen.svelte'),
  });
}

export function createPhoneSettingsLoader() {
  return createLatestPhoneLoader({
    settings: () => import('./settings.svelte.ts'),
  });
}
