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
}

export interface HouseholdConfigShadowDependencies {
  fetcher?: typeof fetch;
  legacyModel?: HouseholdRuntimeModel;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => () => void;
  timeoutMs?: number;
}

export const HOUSEHOLD_CONFIG_SHADOW_TIMEOUT_MS = 1_000;
const TIMED_OUT = Symbol('household-config-shadow-timeout');

function defaultScheduleTimeout(callback: () => void, timeoutMs: number): () => void {
  const handle = setTimeout(callback, timeoutMs);
  return () => clearTimeout(handle);
}

export function normalizeHouseholdConfigModeHeader(value: string | null): HouseholdConfigMode | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'active' || normalized === 'shadow' ? normalized : null;
}

function modeUnavailable(message: string): HouseholdConfigCandidate {
  return {
    mode: 'unknown',
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
      if (fetchedMode === TIMED_OUT) return modeUnavailable('Household config mode request timed out.');
      if (!fetchedMode.ok) return modeUnavailable(`Household config mode request failed with HTTP ${fetchedMode.status}.`);
      const resolvedMode = normalizeHouseholdConfigModeHeader(
        fetchedMode.headers.get('x-hmi-household-config-mode'),
      );
      if (!resolvedMode) return modeUnavailable('Household config mode response was missing or invalid.');
      mode = resolvedMode;
    } catch (error) {
      return modeUnavailable(error instanceof Error ? error.message : 'Household config mode request failed.');
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
      return { mode, shadow: timeoutResult() };
    }
    response = fetched;
  } catch (error) {
    if (controller.signal.aborted) return { mode, shadow: timeoutResult() };
    return {
      mode,
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
    return modeUnavailable('Household config mode changed or was missing during bootstrap.');
  }
  let text: string;
  try {
    const responseText = await Promise.race([response.text(), timeout]);
    if (responseText === TIMED_OUT) {
      return { mode, shadow: timeoutResult(response.status) };
    }
    text = responseText;
  } catch (error) {
    if (controller.signal.aborted) return { mode, shadow: timeoutResult(response.status) };
    return {
      mode,
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
      return { mode, shadow: unavailableFromResponse(response.status, payload) };
    }

    let input: unknown;
    try {
      input = JSON.parse(text) as unknown;
    } catch (error) {
      return {
        mode,
        shadow: {
          status: 'invalid',
          kind: 'json',
          message: error instanceof Error ? error.message : 'Household config is not valid JSON.',
        },
      };
    }

    const parsed = parseHouseholdConfig(input);
    if (!parsed.ok) return { mode, shadow: { status: 'invalid', kind: 'schema', issues: parsed.issues } };

    const model = compileHouseholdConfig(parsed.value);
    const comparison = compareRuntimeModels(legacyModel, model);
    return {
      mode,
      model,
      shadow: comparison.equal
        ? { status: 'match', differences: [] }
        : { status: 'mismatch', differences: comparison.differences },
    };
  } catch {
    return {
      mode,
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
  return loadHouseholdConfigCandidateInternal(dependencies);
}

export async function bootstrapHouseholdConfigShadow(
  dependencies: HouseholdConfigShadowDependencies = {},
): Promise<HouseholdConfigShadowResult> {
  return (await loadHouseholdConfigCandidateInternal(dependencies, 'shadow')).shadow;
}

export function publishHouseholdConfigShadowResult(result: HouseholdConfigShadowResult): void {
  if (typeof window === 'undefined') return;
  const target = window as unknown as { __hmi?: Record<string, unknown> };
  target.__hmi = { ...(target.__hmi ?? {}), householdConfigShadow: result };
}
