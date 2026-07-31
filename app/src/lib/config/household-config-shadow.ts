import {
  compareRuntimeModels,
  compileHouseholdConfig,
  parseHouseholdConfig,
  type ConfigIssue,
  type HouseholdRuntimeModel,
  type RuntimeDifference,
} from './household-config.ts';
import { legacyHouseholdRuntimeModel } from './legacy-household-config.ts';

export type HouseholdConfigMode = 'shadow' | 'active';
export type HouseholdConfigCacheDisposition = 'retain' | 'replace' | 'clear';
export type HouseholdConfigShadowResult =
  | { status: 'match'; differences: [] }
  | { status: 'mismatch'; differences: RuntimeDifference[] }
  | { status: 'invalid'; kind: 'json'; message: string }
  | { status: 'invalid'; kind: 'schema'; issues: ConfigIssue[] }
  | {
      status: 'unavailable';
      message: string;
      httpStatus?: number;
      code?: string;
    };

export interface HouseholdConfigCandidate {
  mode: HouseholdConfigMode | 'unknown';
  shadow: HouseholdConfigShadowResult;
  model?: HouseholdRuntimeModel;
  /** Effective persisted transition. `replace`/`clear` are returned only when
   * the storage mutation succeeded; unavailable storage degrades to `retain`. */
  cacheDisposition: HouseholdConfigCacheDisposition;
}

export interface HouseholdConfigShadowDependencies {
  fetcher?: typeof fetch;
  legacyModel?: HouseholdRuntimeModel;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => () => void;
  timeoutMs?: number;
}

export const HOUSEHOLD_CONFIG_SHADOW_TIMEOUT_MS = 1_000;
export const HOUSEHOLD_CONFIG_CACHE_KEY = 'hmi:household-config-cache:v1';
const TIMED_OUT = Symbol('household-config-shadow-timeout');

type HouseholdConfigStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): HouseholdConfigStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function writeHouseholdConfigCache(
  storage: HouseholdConfigStorage | null,
  mode: HouseholdConfigMode,
  config: unknown,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(HOUSEHOLD_CONFIG_CACHE_KEY, JSON.stringify({
      version: 1,
      mode,
      config,
      savedAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearHouseholdConfigCache(
  storage: HouseholdConfigStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(HOUSEHOLD_CONFIG_CACHE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Liest ausschließlich einen zuvor validierten Snapshot. Beschädigte oder
 * veraltete Cache-Formate werden verworfen, nie als Runtime-Modell übernommen. */
export function readCachedHouseholdConfigCandidate(
  {
    storage = browserStorage(),
    legacyModel = legacyHouseholdRuntimeModel,
  }: Pick<HouseholdConfigShadowDependencies, 'storage' | 'legacyModel'> = {},
): HouseholdConfigCandidate | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(HOUSEHOLD_CONFIG_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Record<string, unknown>;
    const mode = normalizeHouseholdConfigModeHeader(
      typeof cached.mode === 'string' ? cached.mode : null,
    );
    if (cached.version !== 1 || !mode) throw new Error('unsupported cache');
    const parsed = parseHouseholdConfig(cached.config);
    if (!parsed.ok) throw new Error('invalid cached config');
    const model = compileHouseholdConfig(parsed.value);
    const comparison = compareRuntimeModels(legacyModel, model);
    return {
      mode,
      model,
      cacheDisposition: 'retain',
      shadow: comparison.equal
        ? { status: 'match', differences: [] }
        : { status: 'mismatch', differences: comparison.differences },
    };
  } catch {
    try { storage.removeItem(HOUSEHOLD_CONFIG_CACHE_KEY); } catch { /* ignore */ }
    return null;
  }
}

function defaultScheduleTimeout(callback: () => void, timeoutMs: number): () => void {
  const handle = setTimeout(callback, timeoutMs);
  return () => clearTimeout(handle);
}

export function normalizeHouseholdConfigModeHeader(value: string | null): HouseholdConfigMode | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'active' || normalized === 'shadow' ? normalized : null;
}

function modeUnavailable(
  message: string,
  cacheDisposition: Extract<HouseholdConfigCacheDisposition, 'retain' | 'clear'>,
): HouseholdConfigCandidate {
  return {
    mode: 'unknown',
    cacheDisposition,
    shadow: {
      status: 'unavailable',
      code: 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE',
      message,
    },
  };
}

function timeoutResult(httpStatus?: number): HouseholdConfigShadowResult {
  return {
    status: 'unavailable',
    ...(httpStatus === undefined ? {} : { httpStatus }),
    code: 'HOUSEHOLD_CONFIG_TIMEOUT',
    message: 'Household config request timed out.',
  };
}

function unavailableFromResponse(
  status: number,
  payload: unknown,
): HouseholdConfigShadowResult {
  const object = typeof payload === 'object' && payload !== null
    ? payload as Record<string, unknown>
    : {};
  return {
    status: 'unavailable',
    httpStatus: status,
    ...(typeof object.code === 'string' ? { code: object.code } : {}),
    message: typeof object.message === 'string'
      ? object.message
      : `Household config request failed with HTTP ${status}.`,
  };
}

/**
 * Loads the external config exactly once and returns both its server-selected
 * mode and its effect-free comparison. Every failure is data and no productive
 * runtime module is imported here.
 */
async function loadHouseholdConfigCandidateInternal(
  {
    fetcher = fetch,
    legacyModel = legacyHouseholdRuntimeModel,
    storage = browserStorage(),
    scheduleTimeout = defaultScheduleTimeout,
    timeoutMs = HOUSEHOLD_CONFIG_SHADOW_TIMEOUT_MS,
  }: HouseholdConfigShadowDependencies = {},
  confirmedMode?: HouseholdConfigMode,
): Promise<HouseholdConfigCandidate> {
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : HOUSEHOLD_CONFIG_SHADOW_TIMEOUT_MS;
  let mode: HouseholdConfigMode;
  if (confirmedMode) {
    mode = confirmedMode;
  } else {
    const modeController = new AbortController();
    let cancelModeTimeout = () => {};
    const modeTimeout = new Promise<typeof TIMED_OUT>((resolve) => {
      cancelModeTimeout = scheduleTimeout(() => {
        modeController.abort();
        resolve(TIMED_OUT);
      }, boundedTimeoutMs);
    });
    try {
      const fetchedMode = await Promise.race([fetcher('/api/household-config-mode', {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: modeController.signal,
      }), modeTimeout]);
      if (fetchedMode === TIMED_OUT) {
        return modeUnavailable('Household config mode request timed out.', 'retain');
      }
      if (!fetchedMode.ok) {
        return modeUnavailable(
          `Household config mode request failed with HTTP ${fetchedMode.status}.`,
          'clear',
        );
      }
      const resolvedMode = normalizeHouseholdConfigModeHeader(
        fetchedMode.headers.get('x-hmi-household-config-mode'),
      );
      if (!resolvedMode) {
        return modeUnavailable('Household config mode response was missing or invalid.', 'clear');
      }
      mode = resolvedMode;
    } catch (error) {
      return modeUnavailable(
        error instanceof Error ? error.message : 'Household config mode request failed.',
        'retain',
      );
    } finally {
      cancelModeTimeout();
    }
  }

  const controller = new AbortController();
  let cancelTimeout = () => {};
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    cancelTimeout = scheduleTimeout(() => {
      controller.abort();
      resolve(TIMED_OUT);
    }, boundedTimeoutMs);
  });

  let response: Response;
  try {
    const fetched = await Promise.race([fetcher('/api/household-config', {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    }), timeout]);
    if (fetched === TIMED_OUT) {
      return {
        mode,
        cacheDisposition: mode === 'shadow' ? 'clear' : 'retain',
        shadow: timeoutResult(),
      };
    }
    response = fetched;
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        mode,
        cacheDisposition: mode === 'shadow' ? 'clear' : 'retain',
        shadow: timeoutResult(),
      };
    }
    return {
      mode,
      cacheDisposition: mode === 'shadow' ? 'clear' : 'retain',
      shadow: {
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'Household config request failed.',
      },
    };
  }

  const responseMode = normalizeHouseholdConfigModeHeader(
    response.headers.get('x-hmi-household-config-mode'),
  );
  if (!confirmedMode && responseMode !== mode) {
    cancelTimeout();
    return modeUnavailable('Household config mode changed or was missing during bootstrap.', 'clear');
  }
  let text: string;
  try {
    const responseText = await Promise.race([response.text(), timeout]);
    if (responseText === TIMED_OUT) {
      return {
        mode,
        cacheDisposition: mode === 'shadow' ? 'clear' : 'retain',
        shadow: timeoutResult(response.status),
      };
    }
    text = responseText;
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        mode,
        cacheDisposition: mode === 'shadow' ? 'clear' : 'retain',
        shadow: timeoutResult(response.status),
      };
    }
    return {
      mode,
      cacheDisposition: mode === 'shadow' ? 'clear' : 'retain',
      shadow: {
        status: 'unavailable',
        httpStatus: response.status,
        message: error instanceof Error ? error.message : 'Household config response was unreadable.',
      },
    };
  } finally {
    cancelTimeout();
  }

  try {
    if (!response.ok) {
      let payload: unknown = null;
      try { payload = JSON.parse(text) as unknown; } catch { /* Error body may be plain text. */ }
      return {
        mode,
        cacheDisposition: 'clear',
        shadow: unavailableFromResponse(response.status, payload),
      };
    }

    let input: unknown;
    try {
      input = JSON.parse(text) as unknown;
    } catch (error) {
      return {
        mode,
        cacheDisposition: 'clear',
        shadow: {
          status: 'invalid',
          kind: 'json',
          message: error instanceof Error ? error.message : 'Household config is not valid JSON.',
        },
      };
    }

    const parsed = parseHouseholdConfig(input);
    if (!parsed.ok) {
      return {
        mode,
        cacheDisposition: 'clear',
        shadow: { status: 'invalid', kind: 'schema', issues: parsed.issues },
      };
    }

    const model = compileHouseholdConfig(parsed.value);
    const comparison = compareRuntimeModels(legacyModel, model);
    const cacheDisposition = writeHouseholdConfigCache(storage, mode, parsed.value)
      ? 'replace'
      : 'retain';
    return {
      mode,
      model,
      cacheDisposition,
      shadow: comparison.equal
        ? { status: 'match', differences: [] }
        : { status: 'mismatch', differences: comparison.differences },
    };
  } catch {
    return {
      mode,
      cacheDisposition: 'clear',
      shadow: {
        status: 'unavailable',
        code: 'HOUSEHOLD_CONFIG_SHADOW_UNEXPECTED',
        message: 'Household config shadow failed unexpectedly.',
      },
    };
  } finally {
    cancelTimeout();
  }
}

export async function loadHouseholdConfigCandidate(
  dependencies: HouseholdConfigShadowDependencies = {},
): Promise<HouseholdConfigCandidate> {
  const candidate = await loadHouseholdConfigCandidateInternal(dependencies);
  if (candidate.cacheDisposition === 'clear'
    && !clearHouseholdConfigCache(dependencies.storage)) {
    return { ...candidate, cacheDisposition: 'retain' };
  }
  return candidate;
}

export async function bootstrapHouseholdConfigShadow(
  dependencies: HouseholdConfigShadowDependencies = {},
): Promise<HouseholdConfigShadowResult> {
  const candidate = await loadHouseholdConfigCandidateInternal(dependencies, 'shadow');
  if (candidate.cacheDisposition === 'clear') clearHouseholdConfigCache(dependencies.storage);
  return candidate.shadow;
}

export function publishHouseholdConfigShadowResult(result: HouseholdConfigShadowResult): void {
  if (typeof window === 'undefined') return;
  const target = window as unknown as { __hmi?: Record<string, unknown> };
  target.__hmi = { ...(target.__hmi ?? {}), householdConfigShadow: result };
}
