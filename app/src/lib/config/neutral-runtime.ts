import { FakeBackend, type FakeBackendCatalogItem } from '../adapter/fake-backend.ts';
import type {
  AlarmValue,
  ButtonValue,
  CameraValue,
  ClimateValue,
  CoverValue,
  FanValue,
  HumidifierValue,
  LockValue,
  MowerValue,
  NumberValue,
  SelectValue,
  VacuumValue,
  WaterHeaterValue,
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
  if (domain === 'fan') {
    return {
      on: false,
      percentage: 0,
      presetMode: null,
      oscillating: false,
      direction: 'forward',
      presetModes: [],
      supportsSpeed: true,
      supportsPreset: false,
      supportsOscillate: true,
      supportsDirection: false,
    } satisfies FanValue;
  }
  if (domain === 'cover' || domain === 'valve') {
    return {
      on: false, position: 0, tilt: 0, moving: null,
      supportsOpen: true, supportsClose: true, supportsStop: false, supportsPosition: false, supportsTilt: false,
    } satisfies CoverValue;
  }
  if (domain === 'vacuum') {
    return {
      on: false, state: 'docked', fanSpeed: null, battery: null, fanSpeeds: [],
      supportsStart: true, supportsPause: false, supportsStop: false, supportsReturn: true, supportsLocate: false, supportsFanSpeed: false,
    } satisfies VacuumValue;
  }
  if (domain === 'lock') return { locked: true, state: 'locked', supportsOpen: false } satisfies LockValue;
  if (domain === 'humidifier') {
    return { on: false, target: 50, mode: null, current: null, modes: [], minHumidity: 0, maxHumidity: 100, supportsModes: false } satisfies HumidifierValue;
  }
  if (domain === 'water_heater') {
    return {
      on: false, target: 50, mode: null, current: null, modes: [], minTemp: 30, maxTemp: 70,
      supportsTarget: true, supportsModes: false, supportsOnOff: false,
    } satisfies WaterHeaterValue;
  }
  if (domain === 'lawn_mower') return { on: false, state: 'docked', supportsStart: true, supportsPause: false, supportsDock: true } satisfies MowerValue;
  if (domain === 'alarm_control_panel') {
    return {
      state: 'disarmed', codeFormat: null, codeArmRequired: false,
      supportsArmHome: false, supportsArmAway: false, supportsArmNight: false, supportsArmVacation: false, supportsArmCustom: false,
    } satisfies AlarmValue;
  }
  if (domain === 'number' || domain === 'input_number') return { value: 0, min: 0, max: 100, step: 1, unit: null } satisfies NumberValue;
  if (domain === 'select' || domain === 'input_select') return { option: null, options: [] } satisfies SelectValue;
  if (domain === 'button' || domain === 'input_button') return { pressedAt: null } satisfies ButtonValue;
  if (context.role === 'presence' || context.role === 'window'
      || ['switch', 'binary_sensor', 'input_boolean', 'siren', 'remote'].includes(domain)) {
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
