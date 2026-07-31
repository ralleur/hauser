import {
  clearHouseholdConfigCache,
  loadHouseholdConfigCandidate,
  publishHouseholdConfigShadowResult,
  readCachedHouseholdConfigCandidate,
  type HouseholdConfigCandidate,
  type HouseholdConfigMode,
  type HouseholdConfigShadowDependencies,
  type HouseholdConfigShadowResult,
} from './household-config-shadow.ts';
import {
  HouseholdConfigProjectionError,
  installActiveHouseholdData,
  projectActiveHouseholdData,
  resetHouseholdDataToLegacy,
} from './household-runtime-data.ts';
import { compareRuntimeModels, type HouseholdRuntimeModel } from './household-config.ts';

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

export type HouseholdConfigHealthStatus = 'ready' | 'setup_required' | null;
export type HouseholdConfigFirstPaintSource = 'legacy' | 'shadow-cache' | 'active-cache';
export type HouseholdConfigFirstPaintValidation<T> =
  | {
      status: 'authorized';
      mode: HouseholdConfigMode;
      app: T;
    }
  | {
      status: 'reload_required';
      mode: HouseholdConfigMode | 'unknown';
      code: string;
    }
  | {
      status: 'setup_required';
      mode: 'unknown';
      code: 'HOUSEHOLD_CONFIG_SETUP_REQUIRED';
    }
  | {
      status: 'blocked';
      mode: HouseholdConfigMode | 'unknown';
      code: string;
    };

export interface HouseholdConfigFirstPaintDependencies<T>
  extends HouseholdConfigShadowDependencies {
  /** Renders only the already imported local shell. It must not start a backend. */
  startLocalShell: () => Promise<T>;
  /** Replaces the local shell with App.svelte after config authorization. */
  startAuthorizedApp: () => Promise<T>;
  healthStatus: () => Promise<HouseholdConfigHealthStatus>;
  /** main.ts provides its two-frame post-paint scheduler here. */
  scheduleValidation: (task: () => void) => void;
}

export interface HouseholdConfigFirstPaintBootstrap<T> {
  app: T;
  source: HouseholdConfigFirstPaintSource;
  validation: Promise<HouseholdConfigFirstPaintValidation<T>>;
}

function projectionErrorCode(error: unknown): string {
  return error instanceof HouseholdConfigProjectionError
    ? error.code
    : 'HOUSEHOLD_CONFIG_PROJECTION_FAILED';
}

function blockedRuntimeResult(
  mode: 'active' | 'unknown',
  shadow: HouseholdConfigShadowResult,
  code: string,
): HouseholdConfigRuntimeResult {
  const result: HouseholdConfigRuntimeResult = {
    mode,
    status: 'error',
    parity: shadow.status,
    code,
  };
  publishRuntimeResult(result);
  return result;
}

async function validateHouseholdConfigAfterFirstPaint<T>(
  initialActiveModel: HouseholdRuntimeModel | null,
  {
    startAuthorizedApp,
    healthStatus,
    storage,
    ...candidateDependencies
  }: HouseholdConfigFirstPaintDependencies<T>,
): Promise<HouseholdConfigFirstPaintValidation<T>> {
  let health: HouseholdConfigHealthStatus = null;
  try { health = await healthStatus(); } catch { /* config route still decides */ }
  if (health === 'setup_required') {
    clearHouseholdConfigCache(storage);
    resetHouseholdDataToLegacy();
    blockedRuntimeResult('unknown', {
      status: 'unavailable',
      code: 'HOUSEHOLD_CONFIG_SETUP_REQUIRED',
      message: 'Household setup is required.',
    }, 'HOUSEHOLD_CONFIG_SETUP_REQUIRED');
    return {
      status: 'setup_required',
      mode: 'unknown',
      code: 'HOUSEHOLD_CONFIG_SETUP_REQUIRED',
    };
  }

  const candidate = await loadHouseholdConfigCandidate({
    ...candidateDependencies,
    storage,
  });
  publishHouseholdConfigShadowResult(candidate.shadow);

  if (candidate.mode === 'unknown') {
    resetHouseholdDataToLegacy();
    const code = candidate.shadow.status === 'unavailable'
      ? candidate.shadow.code ?? 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE'
      : 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE';
    blockedRuntimeResult('unknown', candidate.shadow, code);
    return initialActiveModel && candidate.cacheDisposition === 'clear'
      ? { status: 'reload_required', mode: 'unknown', code }
      : { status: 'blocked', mode: 'unknown', code };
  }

  if (candidate.mode === 'shadow') {
    resetHouseholdDataToLegacy();
    const app = await startAuthorizedApp();
    const result: HouseholdConfigRuntimeResult<T> = {
      mode: 'shadow',
      status: 'legacy',
      parity: candidate.shadow.status,
      app,
    };
    publishRuntimeResult(result);
    return { status: 'authorized', mode: 'shadow', app };
  }

  if (!candidate.model) {
    resetHouseholdDataToLegacy();
    const code = activeErrorCode(candidate.shadow);
    blockedRuntimeResult('active', candidate.shadow, code);
    return initialActiveModel && candidate.cacheDisposition === 'clear'
      ? { status: 'reload_required', mode: 'active', code }
      : { status: 'blocked', mode: 'active', code };
  }

  try {
    projectActiveHouseholdData(candidate.model);
  } catch (error) {
    const cacheCleared = clearHouseholdConfigCache(storage);
    resetHouseholdDataToLegacy();
    const code = projectionErrorCode(error);
    blockedRuntimeResult('active', candidate.shadow, code);
    return initialActiveModel && cacheCleared
      ? { status: 'reload_required', mode: 'active', code }
      : { status: 'blocked', mode: 'active', code };
  }

  if (!initialActiveModel || !compareRuntimeModels(initialActiveModel, candidate.model).equal) {
    if (candidate.cacheDisposition === 'replace') {
      return {
        status: 'reload_required',
        mode: 'active',
        code: 'HOUSEHOLD_CONFIG_CACHE_REFRESHED',
      };
    }
  }

  installActiveHouseholdData(candidate.model);
  const app = await startAuthorizedApp();
  const result: HouseholdConfigRuntimeResult<T> = {
    mode: 'active',
    status: 'active',
    parity: candidate.shadow.status,
    app,
  };
  publishRuntimeResult(result);
  return { status: 'authorized', mode: 'active', app };
}

/**
 * Installs a valid last-known snapshot synchronously and mounts the isolated
 * local shell before the caller may schedule health/config requests. The shell
 * has no productive state, theme-effect, device-manager or backend imports.
 */
export async function bootstrapHouseholdConfigFirstPaint<T>(
  dependencies: HouseholdConfigFirstPaintDependencies<T>,
): Promise<HouseholdConfigFirstPaintBootstrap<T>> {
  const { storage, legacyModel, startLocalShell, scheduleValidation } = dependencies;
  resetHouseholdDataToLegacy();
  let cached: HouseholdConfigCandidate | null = readCachedHouseholdConfigCandidate({
    storage,
    legacyModel,
  });
  let source: HouseholdConfigFirstPaintSource = cached?.mode === 'shadow'
    ? 'shadow-cache'
    : 'legacy';
  let initialActiveModel: HouseholdRuntimeModel | null = null;

  if (cached?.mode === 'active' && cached.model) {
    try {
      installActiveHouseholdData(cached.model);
      initialActiveModel = cached.model;
      source = 'active-cache';
    } catch {
      clearHouseholdConfigCache(storage);
      resetHouseholdDataToLegacy();
      cached = null;
    }
  }

  const app = await startLocalShell();
  let resolveValidation!: (result: HouseholdConfigFirstPaintValidation<T>) => void;
  const validation = new Promise<HouseholdConfigFirstPaintValidation<T>>((resolve) => {
    resolveValidation = resolve;
  });
  try {
    scheduleValidation(() => {
      void validateHouseholdConfigAfterFirstPaint(initialActiveModel, dependencies)
        .then(resolveValidation)
        .catch(() => resolveValidation({
          status: 'blocked',
          mode: 'unknown',
          code: 'HOUSEHOLD_CONFIG_VALIDATION_FAILED',
        }));
    });
  } catch {
    resolveValidation({
      status: 'blocked',
      mode: 'unknown',
      code: 'HOUSEHOLD_CONFIG_VALIDATION_SCHEDULING_FAILED',
    });
  }

  return { app, source, validation };
}

export async function bootstrapCachedHouseholdConfigRuntime<T>(
  {
    startProductiveApp,
    storage,
    legacyModel,
  }: Pick<HouseholdConfigRuntimeDependencies<T>, 'startProductiveApp' | 'storage' | 'legacyModel'>,
): Promise<HouseholdConfigRuntimeResult<T> | null> {
  resetHouseholdDataToLegacy();
  const candidate = readCachedHouseholdConfigCandidate({ storage, legacyModel });
  if (!candidate) return null;
  publishHouseholdConfigShadowResult(candidate.shadow);

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

  if (!candidate.model) return null;
  try {
    installActiveHouseholdData(candidate.model);
  } catch {
    clearHouseholdConfigCache(storage);
    resetHouseholdDataToLegacy();
    return null;
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

/** Aktualisiert nur den validierten Snapshot. Laufende Singletons werden nicht
 * unter ihnen ausgetauscht; eine geänderte Konfiguration gilt beim nächsten Start. */
export async function refreshHouseholdConfigRuntimeCache(
  dependencies: HouseholdConfigShadowDependencies = {},
): Promise<void> {
  const candidate = await loadHouseholdConfigCandidate(dependencies);
  publishHouseholdConfigShadowResult(candidate.shadow);
  if (candidate.mode === 'active' && candidate.model) {
    try {
      projectActiveHouseholdData(candidate.model);
    } catch {
      clearHouseholdConfigCache(dependencies.storage);
    }
  }
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
    clearHouseholdConfigCache(candidateDependencies.storage);
    resetHouseholdDataToLegacy();
    const result: HouseholdConfigRuntimeResult<T> = {
      mode: 'active',
      status: 'error',
      parity: candidate.shadow.status,
      code: projectionErrorCode(error),
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
