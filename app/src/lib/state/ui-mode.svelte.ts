export type UiModePreference = 'auto' | 'phone' | 'panel';
export type EffectiveUiMode = 'phone' | 'panel';

export const UI_MODE_STORAGE_KEY = 'hmi:ui-mode';
// Portrait bis 767 px; typische Phones bleiben auch quer in ihrer Phone-Shell.
// Die zusätzliche Höhen-/Breitengrenze erfasst keine Tablets (z. B. 1024×768).
export const UI_MODE_QUERY = '(max-width: 767px), (max-width: 950px) and (max-height: 500px)';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface MediaQueryLike {
  matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

interface UiModeControllerOptions {
  matchMedia(query: string): MediaQueryLike;
  storage?: StorageLike;
}

function validPreference(value: unknown): value is UiModePreference {
  return value === 'auto' || value === 'phone' || value === 'panel';
}

export function readUiModePreference(storage?: StorageLike): UiModePreference {
  if (!storage) return 'auto';
  try {
    const value = storage.getItem(UI_MODE_STORAGE_KEY);
    return validPreference(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

export function writeUiModePreference(preference: UiModePreference, storage?: StorageLike): void {
  if (!storage) return;
  try {
    if (preference === 'auto') storage.removeItem(UI_MODE_STORAGE_KEY);
    else storage.setItem(UI_MODE_STORAGE_KEY, preference);
  } catch {
    // Storage is an optional reproducibility seam; privacy modes must not break startup.
  }
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function resolveUiMode(preference: UiModePreference, phoneViewport: boolean): EffectiveUiMode {
  return preference === 'auto' ? (phoneViewport ? 'phone' : 'panel') : preference;
}

export function createUiModeController(options: UiModeControllerOptions) {
  const media = options.matchMedia(UI_MODE_QUERY);
  let preference = readUiModePreference(options.storage);
  let effective = resolveUiMode(preference, media.matches);
  let destroyed = false;
  const subscribers = new Set<(mode: EffectiveUiMode) => void>();

  const publish = () => {
    const next = resolveUiMode(preference, media.matches);
    if (next === effective) return;
    effective = next;
    for (const subscriber of subscribers) subscriber(effective);
  };
  const onViewportChange = () => publish();
  media.addEventListener('change', onViewportChange);

  return {
    get preference() { return preference; },
    get effective() { return effective; },
    setPreference(next: UiModePreference) {
      preference = next;
      writeUiModePreference(next, options.storage);
      publish();
    },
    subscribe(subscriber: (mode: EffectiveUiMode) => void) {
      subscribers.add(subscriber);
      subscriber(effective);
      return () => subscribers.delete(subscriber);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      media.removeEventListener('change', onViewportChange);
      subscribers.clear();
    },
  };
}

export function createLatestShellLoader<T>(loaders: Record<EffectiveUiMode, () => Promise<T>>) {
  let request = 0;
  return {
    async load(mode: EffectiveUiMode, accept: (loaded: T) => void): Promise<void> {
      const current = ++request;
      const loaded = await loaders[mode]();
      if (current === request) accept(loaded);
    },
  };
}

export const uiMode = $state({
  preference: 'auto' as UiModePreference,
  effective: 'panel' as EffectiveUiMode,
});

let controller: ReturnType<typeof createUiModeController> | null = null;
let unsubscribe: (() => void) | null = null;

export function initUiMode(): () => void {
  if (controller || typeof window === 'undefined') return () => undefined;
  controller = createUiModeController({
    matchMedia: (query) => window.matchMedia(query),
    storage: browserStorage(),
  });
  uiMode.preference = controller.preference;
  unsubscribe = controller.subscribe((effective) => {
    uiMode.effective = effective;
    uiMode.preference = controller?.preference ?? 'auto';
  });
  return destroyUiMode;
}

export function setUiModePreference(preference: UiModePreference): void {
  if (controller) {
    controller.setPreference(preference);
    uiMode.preference = controller.preference;
    uiMode.effective = controller.effective;
    return;
  }
  const storage = browserStorage();
  writeUiModePreference(preference, storage);
  uiMode.preference = preference;
  if (typeof window !== 'undefined') uiMode.effective = resolveUiMode(preference, window.matchMedia(UI_MODE_QUERY).matches);
}

export function destroyUiMode(): void {
  unsubscribe?.();
  controller?.destroy();
  unsubscribe = null;
  controller = null;
}
