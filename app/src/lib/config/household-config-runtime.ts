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

/**
 * B-27 B3: Ein Reload lohnt nur, wenn der persistierte Snapshot sich geändert
 * hat — ersetzt oder geräumt. Überlebt der alte Snapshot (`retain`, etwa weil
 * der Speicher schreibgeschützt ist), führte der Neustart in exakt dieselbe
 * Lage und damit in eine Reload-Schleife. Dann bleibt die App auf dem zuvor
 * validierten Modell stehen und meldet den Zustand nur.
 */
function reloadUnlessCacheUnchanged<T>(
  candidate: HouseholdConfigCandidate,
  mode: HouseholdConfigMode | 'unknown',
  code: string,
): HouseholdConfigFirstPaintValidation<T> {
  return candidate.cacheDisposition === 'retain'
    ? { status: 'blocked', mode, code }
    : { status: 'reload_required', mode, code };
}

async function validateHouseholdConfigAfterFirstPaint<T>(
  initialActiveModel: HouseholdRuntimeModel | null,
  /** Bereits gemountete produktive App (B-27 B2) oder `null` bei Minimal-Shell. */
  mountedApp: T | null,
  {
    startAuthorizedApp,
    healthStatus,
    storage,
    ...candidateDependencies
  }: HouseholdConfigFirstPaintDependencies<T>,
): Promise<HouseholdConfigFirstPaintValidation<T>> {
  /* B-27 B1: Health und Config-Kandidat hängen nicht voneinander ab. Seriell
     kostete der schlechteste Fall zwei volle Timeouts nacheinander. */
  const [health, candidate] = await Promise.all([
    healthStatus().catch((): HouseholdConfigHealthStatus => null),
    loadHouseholdConfigCandidate({ ...candidateDependencies, storage }),
  ]);

  if (health === 'setup_required') {
    /* Nach dem Kandidatenlauf geräumt, damit ein paralleler Cache-Schreibvorgang
       den Setup-Zustand nicht überlebt. */
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

  publishHouseholdConfigShadowResult(candidate.shadow);

  /* B-27 B3: Ein Reload ist genau dann nötig, wenn bereits produktive
     Singletons gegen das alte Modell gebaut wurden — nach B2 ist das der
     Cache-First-Mount. Die frühere Bedingung hing an `!initialActiveModel` und
     lud deshalb jeden ersten erfolgreichen Fetch neu, obwohl sich nichts
     geändert hatte. Ohne produktiven Mount korrigiert die Validierung still. */
  const productiveMounted = mountedApp !== null;

  if (candidate.mode === 'unknown') {
    const code = candidate.shadow.status === 'unavailable'
      ? candidate.shadow.code ?? 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE'
      : 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE';
    blockedRuntimeResult('unknown', candidate.shadow, code);
    if (productiveMounted) {
      return reloadUnlessCacheUnchanged(candidate, 'unknown', code);
    }
    resetHouseholdDataToLegacy();
    return { status: 'blocked', mode: 'unknown', code };
  }

  if (candidate.mode === 'shadow') {
    /* Der Server ist auf Shadow zurückgefallen. Ein aus dem Active-Cache
       gestarteter Baum läuft dann gegen das falsche Modell. */
    if (productiveMounted) {
      return reloadUnlessCacheUnchanged(candidate, 'shadow', 'HOUSEHOLD_CONFIG_MODE_CHANGED');
    }
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
    const code = activeErrorCode(candidate.shadow);
    blockedRuntimeResult('active', candidate.shadow, code);
    if (productiveMounted) {
      return reloadUnlessCacheUnchanged(candidate, 'active', code);
    }
    resetHouseholdDataToLegacy();
    return { status: 'blocked', mode: 'active', code };
  }

  try {
    projectActiveHouseholdData(candidate.model);
  } catch (error) {
    const cacheCleared = clearHouseholdConfigCache(storage);
    const code = projectionErrorCode(error);
    blockedRuntimeResult('active', candidate.shadow, code);
    if (productiveMounted) {
      return cacheCleared
        ? { status: 'reload_required', mode: 'active', code }
        : { status: 'blocked', mode: 'active', code };
    }
    resetHouseholdDataToLegacy();
    return { status: 'blocked', mode: 'active', code };
  }

  const unchanged = initialActiveModel !== null
    && compareRuntimeModels(initialActiveModel, candidate.model).equal;

  if (productiveMounted) {
    /* Abweichung unter einem laufenden Baum: die Singletons stehen bereits, ein
       Reload ist der kleinste sichere Cutover. Bei Gleichstand bleibt alles
       stehen — insbesondere wird das Modell NICHT erneut installiert, sonst
       würden die Bindings unter den gemounteten Komponenten getauscht. */
    if (!unchanged) {
      return reloadUnlessCacheUnchanged(candidate, 'active', 'HOUSEHOLD_CONFIG_CACHE_REFRESHED');
    }
    const result: HouseholdConfigRuntimeResult<T> = {
      mode: 'active',
      status: 'active',
      parity: candidate.shadow.status,
      app: mountedApp,
    };
    publishRuntimeResult(result);
    return { status: 'authorized', mode: 'active', app: mountedApp };
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
 * Installs a valid last-known snapshot synchronously and mounts from it before
 * the caller may schedule health/config requests.
 *
 * B-27 B2: Liegt ein gültiger, zuvor validierter Active-Snapshot vor, mountet
 * direkt die produktive App — die Validierung läuft danach und korrigiert nur
 * bei Abweichung. Die Minimal-Shell ist damit reiner Fehlerpfad (fehlender oder
 * unbrauchbarer Cache, Shadow-Modus). Siehe ADR-028.
 */
export async function bootstrapHouseholdConfigFirstPaint<T>(
  dependencies: HouseholdConfigFirstPaintDependencies<T>,
): Promise<HouseholdConfigFirstPaintBootstrap<T>> {
  const {
    storage,
    legacyModel,
    startLocalShell,
    startAuthorizedApp,
    scheduleValidation,
  } = dependencies;
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

  let app: T;
  let mountedApp: T | null = null;
  if (initialActiveModel) {
    try {
      app = await startAuthorizedApp();
      mountedApp = app;
    } catch {
      /* Die produktiven Module sind nicht ladbar — zurück auf den Fehlerpfad.
         Das Modell wird verworfen, damit die Validierung nicht von produktiven
         Singletons ausgeht, die es nicht gibt. */
      resetHouseholdDataToLegacy();
      initialActiveModel = null;
      source = 'legacy';
      app = await startLocalShell();
    }
  } else {
    app = await startLocalShell();
  }

  let resolveValidation!: (result: HouseholdConfigFirstPaintValidation<T>) => void;
  const validation = new Promise<HouseholdConfigFirstPaintValidation<T>>((resolve) => {
    resolveValidation = resolve;
  });
  try {
    scheduleValidation(() => {
      void validateHouseholdConfigAfterFirstPaint(initialActiveModel, mountedApp, dependencies)
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
