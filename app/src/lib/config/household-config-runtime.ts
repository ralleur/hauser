import {
  loadHouseholdConfigCandidate,
  publishHouseholdConfigShadowResult,
  type HouseholdConfigMode,
  type HouseholdConfigShadowDependencies,
  type HouseholdConfigShadowResult,
} from './household-config-shadow.ts';
import {
  HouseholdConfigProjectionError,
  installActiveHouseholdData,
  resetHouseholdDataToLegacy,
} from './household-runtime-data.ts';

export type HouseholdConfigParityStatus = HouseholdConfigShadowResult['status'];
export type HouseholdConfigRuntimeResult<T = unknown> =
  | {
      mode: HouseholdConfigMode;
      status: 'legacy' | 'active';
      parity: HouseholdConfigParityStatus;
      code?: undefined;
      app: T;
    }
  | {
      mode: 'active' | 'unknown';
      status: 'error';
      parity: HouseholdConfigParityStatus;
      code: string;
    };

export interface HouseholdConfigRuntimeDependencies<T>
  extends HouseholdConfigShadowDependencies {
  startProductiveApp: () => Promise<T>;
}

function activeErrorCode(shadow: HouseholdConfigShadowResult): string {
  if (shadow.status === 'invalid') {
    return shadow.kind === 'json'
      ? 'HOUSEHOLD_CONFIG_INVALID_JSON'
      : 'HOUSEHOLD_CONFIG_INVALID';
  }
  if (shadow.status === 'unavailable') {
    return shadow.code ?? 'HOUSEHOLD_CONFIG_UNAVAILABLE';
  }
  return 'HOUSEHOLD_CONFIG_UNAVAILABLE';
}

function publishRuntimeResult(result: HouseholdConfigRuntimeResult): void {
  if (typeof window === 'undefined') return;
  const target = window as unknown as { __hmi?: Record<string, unknown> };
  const diagnostic = {
    mode: result.mode,
    status: result.status,
    parity: result.parity,
    ...(result.code === undefined ? {} : { code: result.code }),
  };
  target.__hmi = { ...(target.__hmi ?? {}), householdConfigRuntime: diagnostic };
}

/**
 * Resolves the server mode and candidate before the caller imports App.svelte,
 * the runtime singleton or a backend. Shadow always starts the exact legacy
 * source; active starts only after validation, compilation and UI projection.
 */
export async function bootstrapHouseholdConfigRuntime<T>(
  {
    startProductiveApp,
    ...candidateDependencies
  }: HouseholdConfigRuntimeDependencies<T>,
): Promise<HouseholdConfigRuntimeResult<T>> {
  resetHouseholdDataToLegacy();
  const candidate = await loadHouseholdConfigCandidate(candidateDependencies);
  publishHouseholdConfigShadowResult(candidate.shadow);

  if (candidate.mode === 'unknown') {
    const result: HouseholdConfigRuntimeResult<T> = {
      mode: 'unknown',
      status: 'error',
      parity: candidate.shadow.status,
      code: candidate.shadow.status === 'unavailable'
        ? candidate.shadow.code ?? 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE'
        : 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE',
    };
    publishRuntimeResult(result);
    return result;
  }

  if (candidate.mode === 'shadow') {
    const result: HouseholdConfigRuntimeResult<T> = {
      mode: 'shadow',
      status: 'legacy',
      parity: candidate.shadow.status,
      app: await startProductiveApp(),
    };
    publishRuntimeResult(result);
    return result;
  }

  if (!candidate.model) {
    const result: HouseholdConfigRuntimeResult<T> = {
      mode: 'active',
      status: 'error',
      parity: candidate.shadow.status,
      code: activeErrorCode(candidate.shadow),
    };
    publishRuntimeResult(result);
    return result;
  }

  try {
    installActiveHouseholdData(candidate.model);
  } catch (error) {
    const result: HouseholdConfigRuntimeResult<T> = {
      mode: 'active',
      status: 'error',
      parity: candidate.shadow.status,
      code: error instanceof HouseholdConfigProjectionError
        ? error.code
        : 'HOUSEHOLD_CONFIG_PROJECTION_FAILED',
    };
    publishRuntimeResult(result);
    return result;
  }

  const result: HouseholdConfigRuntimeResult<T> = {
    mode: 'active',
    status: 'active',
    parity: candidate.shadow.status,
    app: await startProductiveApp(),
  };
  publishRuntimeResult(result);
  return result;
}
