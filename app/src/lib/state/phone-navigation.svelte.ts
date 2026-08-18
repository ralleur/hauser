import { m } from '../../paraglide/messages.js';
import { projectPhoneTarget, type ScreenId } from './nav.svelte.ts';

export type PhoneMainTarget = 'home' | 'calendar' | 'media' | 'more';
export type MediaRootTarget = 'media' | 'library';
export type LayerCloseReason = 'back' | 'escape' | 'scrim' | 'close' | 'toggle' | 'selection' | 'navigation' | 'unmount';
export type LayerChangeReason = LayerCloseReason | 'open';

/* `label` als Getter (ADR-021) — siehe nav.svelte.ts. */
export const PHONE_MAIN_TARGETS = [
  { id: 'home', get label() { return m.nav_home(); } },
  { id: 'calendar', get label() { return m.nav_calendar(); } },
  { id: 'media', get label() { return m.nav_media(); } },
  { id: 'more', get label() { return m.nav_more(); } },
] as const satisfies readonly { id: PhoneMainTarget; readonly label: string }[];

export function mainAreaForScreen(screen: unknown): PhoneMainTarget {
  return projectPhoneTarget(screen).area;
}

export function rememberMediaTarget(current: MediaRootTarget, screen: ScreenId): MediaRootTarget {
  if (screen === 'media') return 'media';
  if (screen === 'library' || screen === 'library-detail') return 'library';
  return current;
}

export function initialMediaTarget(screens: readonly { id: ScreenId }[]): MediaRootTarget {
  return screens.some(({ id }) => id === 'media') ? 'media' : 'library';
}

export function canonicalTargetForMain(
  target: PhoneMainTarget,
  lastMediaTarget: MediaRootTarget,
): ScreenId | null {
  if (target === 'home') return 'home';
  if (target === 'calendar') return 'calendar';
  if (target === 'media') return lastMediaTarget;
  return null;
}

interface HistoryPort {
  readonly state: unknown;
  pushState(data: unknown, unused?: string, url?: string | URL | null): void;
  back(): void;
  addEventListener(type: 'popstate', listener: (event: PopStateEvent) => void): void;
  removeEventListener(type: 'popstate', listener: (event: PopStateEvent) => void): void;
}

export interface PhoneLayerController {
  open(): boolean;
  close(reason: Exclude<LayerCloseReason, 'back' | 'unmount'>): boolean;
  destroy(): void;
  isOpen(): boolean;
}

const HISTORY_MARKER = '__hmiPhoneMoreLayer';
const HISTORY_MARKER_GENERATION = '__hmiPhoneMoreMarkerGeneration.v1';

export interface HistoryMarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HistoryMarkerSources {
  randomUUID?: () => string;
  getRandomValues?: (values: Uint32Array<ArrayBuffer>) => void;
  random?: () => number;
  storage?: HistoryMarkerStorage | null;
  now?: () => number;
  performanceNow?: () => number;
  /** Deterministic test seam for module-load entropy. Production uses `random`. */
  reloadEntropy?: string;
}

function moduleEntropyFrom(sources: HistoryMarkerSources): string | null {
  try {
    const injected = sources.reloadEntropy;
    if (typeof injected === 'string' && injected) return injected;
  } catch {
    // Continue to the runtime entropy adapter.
  }

  try {
    const random = sources.random;
    if (!random) return null;
    const value = random();
    if (!Number.isFinite(value)) return null;
    return Math.floor(Math.abs(value) * Number.MAX_SAFE_INTEGER).toString(36);
  } catch {
    return null;
  }
}

function sessionGenerationFrom(sources: HistoryMarkerSources): string | null {
  try {
    const storage = sources.storage;
    if (!storage) return null;
    const stored = storage.getItem(HISTORY_MARKER_GENERATION);
    const previous = stored && /^\d{1,9}$/.test(stored) ? Number(stored) : 0;
    const next = previous >= 999_999_999 ? 1 : previous + 1;
    storage.setItem(HISTORY_MARKER_GENERATION, String(next));
    return next.toString(36);
  } catch {
    return null;
  }
}


function safeClockFrom(sources: HistoryMarkerSources): string {
  let wall = 0;
  let monotonic = 0;

  try {
    const now = sources.now;
    const value = now?.();
    if (typeof value === 'number' && Number.isFinite(value)) wall = value;
  } catch {
    // A clock is optional at the final best-effort tier.
  }

  try {
    const performanceNow = sources.performanceNow;
    const value = performanceNow?.();
    if (typeof value === 'number' && Number.isFinite(value)) monotonic = value;
  } catch {
    // Keep the wall-clock/counter fallback operational.
  }

  const wallPart = Math.floor(Math.abs(wall)).toString(36);
  const monotonicPart = Math.floor(Math.abs(monotonic) * 1000).toString(36);
  return monotonic ? `${wallPart}-${monotonicPart}` : wallPart;
}

export function createHistoryMarkerGenerator(sources: HistoryMarkerSources): () => string {
  let counter = 0;
  const moduleIdentity = moduleEntropyFrom(sources) ?? sessionGenerationFrom(sources);


  return () => {
    try {
      const randomUUID = sources.randomUUID;
      const uuid = randomUUID?.();
      if (typeof uuid === 'string' && uuid) return `more-${uuid}`;
    } catch {
      // Continue with the next entropy source.
    }

    try {
      const getRandomValues = sources.getRandomValues;
      if (getRandomValues) {
        const words = new Uint32Array(4);
        getRandomValues(words);
        return `more-r-${Array.from(words, (word) => word.toString(36).padStart(7, '0')).join('')}`;
      }
    } catch {
      // The non-crypto fallback below must keep layer open/close fail-safe.
    }

    return `more-f-${safeClockFrom(sources)}-${moduleIdentity ?? 'unavailable'}-${++counter}`;
  };
}

function productionSessionStorage(): HistoryMarkerStorage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

const nextHistoryMarker = createHistoryMarkerGenerator({
  randomUUID: () => globalThis.crypto.randomUUID(),
  getRandomValues: (values) => globalThis.crypto.getRandomValues(values),
  random: () => Math.random(),

  now: () => Date.now(),
  performanceNow: () => globalThis.performance.now(),
  storage: productionSessionStorage(),
});

function markerFrom(state: unknown): unknown {
  return state && typeof state === 'object' ? (state as Record<string, unknown>)[HISTORY_MARKER] : undefined;
}

export function createPhoneLayerController(
  browser: HistoryPort,
  onChange: (open: boolean, reason: LayerChangeReason) => void,
): PhoneLayerController {
  type Phase = 'idle' | 'open' | 'waiting-closed' | 'waiting-open' | 'popping-closed' | 'popping-reopen';

  let phase: Phase = 'idle';
  let listening = false;
  let destroyed = false;
  const marker = nextHistoryMarker();

  const removeListener = () => {
    if (!listening) return;
    browser.removeEventListener('popstate', onPopState);
    listening = false;
  };

  const ensureListener = () => {
    if (listening) return;
    browser.addEventListener('popstate', onPopState);
    listening = true;
  };

  const finishCleanup = () => {
    phase = 'idle';
    removeListener();
  };

  const pushOwnedMarker = () => {
    const previous = browser.state && typeof browser.state === 'object'
      ? browser.state as Record<string, unknown>
      : {};
    browser.pushState({ ...previous, [HISTORY_MARKER]: marker }, '');
  };

  const popOwnedMarker = () => {
    phase = 'popping-closed';
    browser.back();
  };

  function onPopState(event: PopStateEvent) {
    if (phase === 'popping-closed') {
      finishCleanup();
      return;
    }
    if (phase === 'popping-reopen') {
      pushOwnedMarker();
      phase = 'open';
      onChange(true, 'open');
      return;
    }

    const reachedOwnedMarker = markerFrom(event.state) === marker;
    if (phase === 'waiting-closed' || phase === 'waiting-open') {
      if (!reachedOwnedMarker) return;
      if (phase === 'waiting-open') onChange(false, 'back');
      popOwnedMarker();
      return;
    }

    if (phase !== 'open') {
      removeListener();
      return;
    }

    onChange(false, 'back');
    if (reachedOwnedMarker) popOwnedMarker();
    else finishCleanup();
  }

  return {
    open() {
      if (destroyed) return false;
      if (phase === 'popping-closed') {
        phase = 'popping-reopen';
        return true;
      }
      if (phase === 'waiting-closed') {
        phase = 'waiting-open';
        onChange(true, 'open');
        return true;
      }
      if (phase !== 'idle') return false;
      ensureListener();
      pushOwnedMarker();
      phase = 'open';
      onChange(true, 'open');
      return true;
    },
    close(reason) {
      if (phase !== 'open' && phase !== 'waiting-open') return false;
      onChange(false, reason);
      if (phase === 'waiting-open') {
        phase = 'waiting-closed';
      } else if (markerFrom(browser.state) === marker) {
        popOwnedMarker();
      } else {
        phase = 'waiting-closed';
      }
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const wasOpen = phase === 'open' || phase === 'waiting-open';
      if (wasOpen) onChange(false, 'unmount');
      // History cannot surgically remove an owned marker below foreign state.
      // Unmount never traverses foreign entries and always bounds listener lifetime.
      const removeCurrentMarker = phase === 'open' && markerFrom(browser.state) === marker;
      phase = 'idle';
      removeListener();
      if (removeCurrentMarker) browser.back();
    },
    isOpen() {
      return phase === 'open' || phase === 'waiting-open';
    },
  };
}

export interface PhoneModalLifecycle {
  open(): number;
  beginClose(): number | null;
  finishOutro(generation: number): boolean;
  isBlocking(): boolean;
  destroy(): void;
}

export function createPhoneModalLifecycle(onRelease: () => void): PhoneModalLifecycle {
  let generation = 0;
  let visible = false;
  let blocking = false;

  return {
    open() {
      generation += 1;
      visible = true;
      blocking = true;
      return generation;
    },
    beginClose() {
      if (!visible) return null;
      visible = false;
      return generation;
    },
    finishOutro(completedGeneration) {
      if (visible || !blocking || completedGeneration !== generation) return false;
      blocking = false;
      onRelease();
      return true;
    },
    isBlocking() {
      return blocking;
    },
    destroy() {
      generation += 1;
      visible = false;
      blocking = false;
    },
  };
}

export function wrappedFocusIndex(currentIndex: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (currentIndex < 0) return backwards ? count - 1 : 0;
  return (currentIndex + (backwards ? -1 : 1) + count) % count;
}

interface FocusTarget {
  isConnected: boolean;
  focus(options?: FocusOptions): void;
}

export function restorePhoneFocus(trigger: FocusTarget | null, fallback: FocusTarget | null): 'trigger' | 'fallback' | 'none' {
  if (trigger?.isConnected) {
    trigger.focus({ preventScroll: true });
    return 'trigger';
  }
  if (fallback?.isConnected) {
    fallback.focus({ preventScroll: true });
    return 'fallback';
  }
  return 'none';
}
