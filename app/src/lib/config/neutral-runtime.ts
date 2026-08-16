import { FakeBackend, type FakeBackendCatalogItem } from '../adapter/fake-backend.ts';
import type {
  CameraValue,
  ClimateValue,
  LightValue,
  MediaValue,
  SensorValue,
  SunValue,
  SwitchValue,
} from '../adapter/types.ts';
import {
  compileHouseholdConfig,
  parseHouseholdConfig,
  type ConfigIssue,
  type EntityRole,
  type HouseholdRuntimeModel,
} from './household-config.ts';

const HOUSEHOLD_CONFIG_ROUTE = '/api/household-config';
const MANAGED_CATALOG_DOMAINS = new Set([
  'light',
  'switch',
  'sensor',
  'binary_sensor',
  'climate',
  'media_player',
  'cover',
  'fan',
  'input_boolean',
  'vacuum',
]);

export interface NeutralRuntimeReady {
  status: 'ready';
  configId: string;
  backendType: 'fake';
  model: HouseholdRuntimeModel;
  seed: Map<string, unknown>;
  catalog: FakeBackendCatalogItem[];
  backend: FakeBackend;
}

export interface NeutralRuntimeError {
  status: 'error';
  code: string;
  message: string;
  issues?: ConfigIssue[];
}

export type NeutralRuntimeResult = NeutralRuntimeReady | NeutralRuntimeError;
export type NeutralFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type NeutralBackendFactory = (
  seed: Map<string, unknown>,
  latencyMs: number,
  catalog: readonly FakeBackendCatalogItem[],
) => FakeBackend;

/** Builds a complete synthetic cache using only IDs present in the compiled model. */
export function buildNeutralSeed(model: HouseholdRuntimeModel): Map<string, unknown> {
  const roles = new Map<string, EntityRole>();
  for (const room of model.rooms) {
    for (const entity of room.visibleEntities) roles.set(entity.entityId, entity.role);
  }
  const mediaIds = new Set(model.mediaTargets.map(({ entityId }) => entityId));
  const energyPowerIds = new Set<string>();
  const energyKpiIds = new Set<string>();
  if (model.energy) {
    if (model.energy.sensors.productionPower) {
      energyPowerIds.add(model.energy.sensors.productionPower);
    }
    for (const source of model.energy.sensors.consumptionPower) {
      energyPowerIds.add(source.entityId);
    }
    for (const entityId of Object.values(model.energy.kpis)) {
      if (entityId) energyKpiIds.add(entityId);
    }
  }

  const seed = new Map<string, unknown>();
  for (const entityId of model.subscriptionEntityIds) {
    seed.set(entityId, syntheticValue(entityId, {
      role: roles.get(entityId),
      media: mediaIds.has(entityId),
      energyPower: energyPowerIds.has(entityId),
      energyKpi: energyKpiIds.has(entityId),
      sun: entityId === model.globalEntities.sun,
    }));
  }
  return seed;
}

/** Catalog for the visible, manageable entities from this model; no fake defaults are merged. */
export function buildNeutralCatalog(model: HouseholdRuntimeModel): FakeBackendCatalogItem[] {
  return model.rooms.flatMap((room) => room.visibleEntities.flatMap((entity) => {
    const domain = entity.entityId.slice(0, entity.entityId.indexOf('.'));
    if (!MANAGED_CATALOG_DOMAINS.has(domain)) return [];
    return [{
      entityId: entity.entityId,
      domain: domain as FakeBackendCatalogItem['domain'],
      name: entity.name,
      area: room.id,
      ...(domain === 'light'
        ? { capabilities: { dimmable: false, colorTemp: false, color: false } }
        : {}),
    }];
  }));
}

export async function bootstrapNeutralRuntime(
  fetchImpl: NeutralFetch = fetch,
  latencyMs = 40,
  backendFactory: NeutralBackendFactory = (seed, latency, catalog) => (
    new FakeBackend(seed, latency, catalog)
  ),
): Promise<NeutralRuntimeResult> {
  let response: Response;
  try {
    response = await fetchImpl(HOUSEHOLD_CONFIG_ROUTE, { cache: 'no-store' });
  } catch {
    return error(
      'HOUSEHOLD_CONFIG_UNAVAILABLE',
      'Die Haushaltskonfiguration konnte nicht geladen werden.',
    );
  }

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    return error(
      payload.code ?? 'HOUSEHOLD_CONFIG_HTTP_ERROR',
      payload.message ?? `Die Haushaltskonfiguration antwortete mit HTTP ${response.status}.`,
    );
  }

  let input: unknown;
  try {
    input = await response.json();
  } catch {
    return error(
      'HOUSEHOLD_CONFIG_INVALID_JSON',
      'Die Haushaltskonfiguration ist kein gültiges JSON-Dokument.',
    );
  }

  const parsed = parseHouseholdConfig(input);
  if (!parsed.ok) {
    return {
      ...error(
        'HOUSEHOLD_CONFIG_INVALID',
        'Die Haushaltskonfiguration entspricht nicht dem v1-Kontrakt.',
      ),
      issues: parsed.issues,
    };
  }

  let model: HouseholdRuntimeModel;
  try {
    model = compileHouseholdConfig(parsed.value);
  } catch {
    return error(
      'HOUSEHOLD_CONFIG_COMPILE_FAILED',
      'Die Haushaltskonfiguration konnte nicht kompiliert werden.',
    );
  }

  const seed = buildNeutralSeed(model);
  const catalog = buildNeutralCatalog(model);
  let backend: FakeBackend;
  try {
    backend = backendFactory(seed, latencyMs, catalog);
  } catch {
    return error(
      'FAKE_BACKEND_INIT_FAILED',
      'Das isolierte FakeBackend konnte nicht initialisiert werden.',
    );
  }

  return {
    status: 'ready',
    configId: `household-v${model.schemaVersion}:${model.rooms[0]?.id ?? 'empty'}`,
    backendType: 'fake',
    model,
    seed,
    catalog,
    backend,
  };
}

function syntheticValue(
  entityId: string,
  context: {
    role: EntityRole | undefined;
    media: boolean;
    energyPower: boolean;
    energyKpi: boolean;
    sun: boolean;
  },
): unknown {
  const domain = entityId.slice(0, entityId.indexOf('.'));
  if (context.role === 'light' || domain === 'light') {
    return { on: false, brightness: 60, color: null } satisfies LightValue;
  }
  if (context.role === 'climate' || domain === 'climate') {
    return { target: 20, current: 20, hvac: 'off' } satisfies ClimateValue;
  }
  if (context.media || domain === 'media_player') {
    return {
      playing: false,
      volume: 35,
      source: null,
      available: true,
      track: null,
      artist: null,
      duration: 0,
    } satisfies MediaValue;
  }
  if (context.sun || domain === 'sun') return { day: true } satisfies SunValue;
  if (context.role === 'camera' || domain === 'camera') {
    return { available: true, entityPicture: null } satisfies CameraValue;
  }
  if (context.role === 'temperature') {
    return { value: 20, unit: '°C' } satisfies SensorValue;
  }
  if (context.energyPower) return { value: 0, unit: 'W' } satisfies SensorValue;
  if (context.energyKpi) return { value: 0, unit: 'kWh' } satisfies SensorValue;
  if (domain === 'sensor') return { value: 0, unit: null } satisfies SensorValue;
  if (context.role === 'presence' || context.role === 'window'
      || ['switch', 'binary_sensor', 'input_boolean', 'fan', 'cover', 'vacuum'].includes(domain)) {
    return { on: false } satisfies SwitchValue;
  }
  return { state: 'synthetic' };
}

async function readErrorPayload(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
    const record = payload as Record<string, unknown>;
    return {
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
    };
  } catch {
    return {};
  }
}

function error(code: string, message: string): NeutralRuntimeError {
  return { status: 'error', code, message };
}
