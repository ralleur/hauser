import {
  ENERGY_SENSORS as LEGACY_ENERGY_SENSORS,
  HOME_OFF_SCRIPT_ENTITY as LEGACY_HOME_OFF_SCRIPT_ENTITY,
  LEGACY_ENABLED_MODULES,
  LEGACY_ROOM_CAMERA_ENTITIES,
  LEGACY_SCREENS,
  LEGACY_TABS,
  MEDIA_SEED as LEGACY_MEDIA_SEED,
  ROOM_SEED as LEGACY_ROOM_SEED,
  SUN_ENTITY as LEGACY_SUN_ENTITY,
  VACATION_MODE_ENTITY as LEGACY_VACATION_MODE_ENTITY,
  type EnergySensors,
  type LegacyScreenEntry,
  type LegacyScreenId,
  type LightSeed,
  type MediaSeed,
  type RoomSeed,
} from './legacy-household-data.ts';
import { legacyHouseholdRuntimeModel } from './legacy-household-config.ts';
import type {
  HouseholdRuntimeModel,
  LaundryAdapterConfig,
  ModuleId,
  RoomHeroConfig,
  VisibleEntityConfig,
} from './household-config.ts';

export type HouseholdDataSource = 'legacy' | 'active';
export type RuntimeTab = Readonly<{
  id: Exclude<LegacyScreenId, 'shopping' | 'reminders' | 'library-detail'>;
  configName: string;
  icon: string;
}>;
export type SongMediaTargetKey = 'wohnzimmer' | 'kueche';
export type SongMediaTargets = Partial<Record<SongMediaTargetKey, Readonly<{
  entityId: string;
  label: string;
}>>>;

export interface ProjectedHouseholdData {
  source: 'active';
  runtimeModel: HouseholdRuntimeModel;
  ROOM_SEED: RoomSeed[];
  ROOM_HERO_CONFIGS: Readonly<Record<string, RoomHeroConfig | null>>;
  MEDIA_SEED: MediaSeed[];
  ENERGY_SENSORS: EnergySensors;
  SUN_ENTITY: string | null;
  VACATION_MODE_ENTITY: string | null;
  HOME_OFF_SCRIPT_ENTITY: string | null;
  LAUNDRY_ENTITIES: Readonly<{ washer: LaundryAdapterConfig | null; dryer: LaundryAdapterConfig | null }>;
  ROOM_CAMERA_ENTITIES: Readonly<Record<string, string>>;
  NAV_SCREENS: readonly LegacyScreenEntry[];
  NAV_TABS: readonly RuntimeTab[];
  ENABLED_MODULES: readonly ModuleId[];
  SONG_MEDIA_TARGETS: SongMediaTargets;
}

export class HouseholdConfigProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HouseholdConfigProjectionError';
    this.code = code;
  }
}

const songTargetKeys: readonly SongMediaTargetKey[] = ['wohnzimmer', 'kueche'];

function projectRoomHeroConfigs(
  model: HouseholdRuntimeModel,
): Readonly<Record<string, RoomHeroConfig | null>> {
  return Object.fromEntries(model.rooms.map((room) => [
    room.id,
    room.hero === null ? null : {
      assetId: room.hero.assetId,
      focus: {
        panel: { ...room.hero.focus.panel },
        phone: { ...room.hero.focus.phone },
      },
    },
  ]));
}

function projectLaundryEntities(
  laundry: HouseholdRuntimeModel['globalEntities']['laundry'],
): Readonly<{ washer: LaundryAdapterConfig | null; dryer: LaundryAdapterConfig | null }> {
  const cloneAdapter = (adapter: LaundryAdapterConfig | null): LaundryAdapterConfig | null => (
    adapter === null ? null : {
      ...adapter,
      runningStates: [...adapter.runningStates],
      doneStates: [...adapter.doneStates],
    }
  );
  return {
    washer: cloneAdapter(laundry.washer),
    dryer: cloneAdapter(laundry.dryer),
  };
}

export let HOUSEHOLD_DATA_SOURCE: HouseholdDataSource = 'legacy';
export let HOUSEHOLD_RUNTIME_MODEL: HouseholdRuntimeModel = legacyHouseholdRuntimeModel;
export let ROOM_SEED: RoomSeed[] = LEGACY_ROOM_SEED;
export let ROOM_HERO_CONFIGS: Readonly<Record<string, RoomHeroConfig | null>> = projectRoomHeroConfigs(
  legacyHouseholdRuntimeModel,
);
export let MEDIA_SEED: readonly MediaSeed[] = LEGACY_MEDIA_SEED;
export let ENERGY_SENSORS: EnergySensors = LEGACY_ENERGY_SENSORS;
export let SUN_ENTITY: string | null = LEGACY_SUN_ENTITY;
export let VACATION_MODE_ENTITY: string | null = LEGACY_VACATION_MODE_ENTITY;
export let HOME_OFF_SCRIPT_ENTITY: string | null = LEGACY_HOME_OFF_SCRIPT_ENTITY;
export let LAUNDRY_ENTITIES: Readonly<{ washer: LaundryAdapterConfig | null; dryer: LaundryAdapterConfig | null }> = projectLaundryEntities(
  legacyHouseholdRuntimeModel.globalEntities.laundry,
);
export let ROOM_CAMERA_ENTITIES: Readonly<Record<string, string>> = LEGACY_ROOM_CAMERA_ENTITIES;
export let NAV_SCREENS: readonly LegacyScreenEntry[] = LEGACY_SCREENS;
export let NAV_TABS: readonly RuntimeTab[] = LEGACY_TABS;
export let ENABLED_MODULES: readonly ModuleId[] = LEGACY_ENABLED_MODULES;
export let SONG_MEDIA_TARGETS: SongMediaTargets = legacySongTargets();

const legacyLightsByEntityId = new Map(
  LEGACY_ROOM_SEED.flatMap((room) => room.lights.map((light) => [light.entityId, light] as const)),
);
const supportedTabs = new Map(LEGACY_TABS.map((tab) => [tab.id, tab] as const));

function legacySongTargets(): SongMediaTargets {
  return Object.fromEntries(songTargetKeys.map((id) => {
    const target = LEGACY_MEDIA_SEED.find((candidate) => candidate.id === id);
    if (!target) throw new Error(`Legacy song media target is missing: ${id}`);
    return [id, { entityId: target.entityId, label: target.name }];
  }));
}

function presentationMetadata(entityId: string): Partial<LightSeed> {
  const legacy = legacyLightsByEntityId.get(entityId);
  if (!legacy) return {};
  return {
    dimmable: legacy.dimmable,
    colorTemp: legacy.colorTemp,
    color: legacy.color,
    colorTempMin: legacy.colorTempMin,
    colorTempMax: legacy.colorTempMax,
    unit: legacy.unit,
    deviceClass: legacy.deviceClass,
    icon: legacy.icon,
  };
}

function projectLight(entity: VisibleEntityConfig): LightSeed {
  const metadata = presentationMetadata(entity.entityId);
  return {
    id: entity.id,
    name: entity.name,
    entityId: entity.entityId,
    on: false,
    brightness: 0,
    dimmable: metadata.dimmable ?? false,
    colorTemp: metadata.colorTemp ?? false,
    color: metadata.color ?? false,
    ...(metadata.colorTempMin === undefined ? {} : { colorTempMin: metadata.colorTempMin }),
    ...(metadata.colorTempMax === undefined ? {} : { colorTempMax: metadata.colorTempMax }),
    ...(metadata.unit === undefined ? {} : { unit: metadata.unit }),
    ...(metadata.deviceClass === undefined ? {} : { deviceClass: metadata.deviceClass }),
    ...(metadata.icon === undefined ? {} : { icon: metadata.icon }),
  };
}

/* Nicht-Licht-Geräte (Schalter, Saugroboter) landen ebenfalls in
   RoomSeed.lights (historischer Name, faktisch die generische Geräteliste
   eines Raums, s. device-config.ts) — die Kategorie steuert die Kachel/das
   Overlay, nicht der Feldname. */
function projectManagedDevice(entity: VisibleEntityConfig, category: LightSeed['category']): LightSeed {
  return {
    ...projectLight(entity),
    domain: entity.entityId.slice(0, entity.entityId.indexOf('.')) as LightSeed['domain'],
    category,
  };
}

function singleRole(
  roomId: string,
  entities: readonly VisibleEntityConfig[],
  role: VisibleEntityConfig['role'],
): VisibleEntityConfig | undefined {
  const matching = entities.filter((entity) => entity.role === role);
  if (matching.length > 1) {
    throw new HouseholdConfigProjectionError(
      'HOUSEHOLD_CONFIG_AMBIGUOUS_ROOM_ROLE',
      `Room ${roomId} has more than one ${role} entity.`,
    );
  }
  return matching[0];
}

function projectRooms(model: HouseholdRuntimeModel): {
  rooms: RoomSeed[];
  cameras: Readonly<Record<string, string>>;
} {
  const cameras: Record<string, string> = {};
  const rooms = model.rooms.map((room) => {
    const climate = singleRole(room.id, room.visibleEntities, 'climate');
    const temperature = singleRole(room.id, room.visibleEntities, 'temperature');
    const camera = singleRole(room.id, room.visibleEntities, 'camera');
    if (camera) cameras[room.id] = camera.entityId;
    return {
      id: room.id,
      name: room.name,
      presence: false,
      windowOpen: false,
      lights: [
        ...room.visibleEntities.filter(({ role }) => role === 'light').map(projectLight),
        ...room.visibleEntities
          .filter(({ role }) => role === 'switch' || role === 'vacuum')
          .map((entity) => projectManagedDevice(entity, 'switch')),
      ],
      ...(climate ? { climateEntityId: climate.entityId, target: 20, hvac: 'off' as const } : {}),
      ...(temperature ? { tempSensorId: temperature.entityId } : {}),
    };
  });
  return { rooms, cameras };
}

function projectMedia(model: HouseholdRuntimeModel): MediaSeed[] {
  if (model.enabledModules.includes('media') && model.mediaTargets.length === 0) {
    throw new HouseholdConfigProjectionError(
      'HOUSEHOLD_CONFIG_MEDIA_TARGET_REQUIRED',
      'The productive media module requires at least one configured media target.',
    );
  }
  return model.mediaTargets.map((target) => ({
    id: target.id,
    name: target.name,
    entityId: target.entityId,
    available: false,
    playing: false,
    volume: 0,
    source: null,
    track: null,
    artist: null,
    duration: 0,
    position: 0,
  }));
}

function projectEnergy(model: HouseholdRuntimeModel): EnergySensors {
  const energy = model.energy;
  return {
    pv: energy?.sensors.productionPower ?? null,
    load: energy?.sensors.consumptionPower.map((load) => ({
      entityId: load.entityId,
      label: load.name,
      ...(load.group === undefined ? {} : { group: load.group }),
    })) ?? [],
    producedToday: energy?.kpis.producedToday ?? null,
    consumedToday: energy?.kpis.consumedToday ?? null,
    fedInToday: energy?.kpis.fedInToday ?? null,
    drawnToday: energy?.kpis.drawnToday ?? null,
  };
}

function projectNavigation(model: HouseholdRuntimeModel): {
  screens: readonly LegacyScreenEntry[];
  tabs: readonly RuntimeTab[];
} {
  const enabled = new Set(model.enabledModules);
  if (!enabled.has('home')) {
    throw new HouseholdConfigProjectionError(
      'HOUSEHOLD_CONFIG_HOME_MODULE_REQUIRED',
      'The productive shell requires the home module.',
    );
  }

  const targetIds = new Set<string>();
  const tabs = model.navigation.map((item) => {
    if (item.target.type !== 'module') {
      throw new HouseholdConfigProjectionError(
        'HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION',
        `The productive shell cannot render room navigation target ${item.target.id}.`,
      );
    }
    const legacy = supportedTabs.get(item.target.id as RuntimeTab['id']);
    if (!legacy || !enabled.has(item.target.id as ModuleId)) {
      throw new HouseholdConfigProjectionError(
        'HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION',
        `The productive shell cannot render module navigation target ${item.target.id}.`,
      );
    }
    if (targetIds.has(item.target.id)) {
      throw new HouseholdConfigProjectionError(
        'HOUSEHOLD_CONFIG_DUPLICATE_NAVIGATION_TARGET',
        `The productive shell cannot render module ${item.target.id} more than once.`,
      );
    }
    targetIds.add(item.target.id);
    return { id: legacy.id, configName: item.name, icon: legacy.icon };
  });
  if (!targetIds.has('home')) {
    throw new HouseholdConfigProjectionError(
      'HOUSEHOLD_CONFIG_HOME_NAVIGATION_REQUIRED',
      'The productive shell requires a home navigation target.',
    );
  }

  const screens = LEGACY_SCREENS.filter((screen) => {
    if (screen.id === 'library-detail') return enabled.has('library');
    if (screen.id === 'shopping' || screen.id === 'reminders') return enabled.has('notes');
    return enabled.has(screen.id as ModuleId);
  });
  return { screens, tabs };
}

function projectSongTargets(model: HouseholdRuntimeModel): SongMediaTargets {
  const targets = Object.fromEntries(songTargetKeys.flatMap((id) => {
    const target = model.mediaTargets.find((candidate) => candidate.id === id);
    return target ? [[id, { entityId: target.entityId, label: target.name }]] : [];
  })) as SongMediaTargets;
  if (model.enabledModules.includes('songs') && songTargetKeys.some((id) => !targets[id])) {
    throw new HouseholdConfigProjectionError(
      'HOUSEHOLD_CONFIG_SONG_TARGETS_MISSING',
      'The songs module requires the public wohnzimmer and kueche media target keys.',
    );
  }
  return targets;
}

export function projectActiveHouseholdData(model: HouseholdRuntimeModel): ProjectedHouseholdData {
  const { rooms, cameras } = projectRooms(model);
  const { screens, tabs } = projectNavigation(model);
  return {
    source: 'active',
    runtimeModel: model,
    ROOM_SEED: rooms,
    ROOM_HERO_CONFIGS: projectRoomHeroConfigs(model),
    MEDIA_SEED: projectMedia(model),
    ENERGY_SENSORS: projectEnergy(model),
    SUN_ENTITY: model.globalEntities.sun,
    VACATION_MODE_ENTITY: model.globalEntities.vacationMode,
    HOME_OFF_SCRIPT_ENTITY: model.globalEntities.homeOffScript,
    LAUNDRY_ENTITIES: projectLaundryEntities(model.globalEntities.laundry),
    ROOM_CAMERA_ENTITIES: cameras,
    NAV_SCREENS: screens,
    NAV_TABS: tabs,
    ENABLED_MODULES: model.enabledModules,
    SONG_MEDIA_TARGETS: projectSongTargets(model),
  };
}

export function installActiveHouseholdData(model: HouseholdRuntimeModel): void {
  const projected = projectActiveHouseholdData(model);
  HOUSEHOLD_DATA_SOURCE = 'active';
  HOUSEHOLD_RUNTIME_MODEL = projected.runtimeModel;
  ROOM_SEED = projected.ROOM_SEED;
  ROOM_HERO_CONFIGS = projected.ROOM_HERO_CONFIGS;
  MEDIA_SEED = projected.MEDIA_SEED;
  ENERGY_SENSORS = projected.ENERGY_SENSORS;
  SUN_ENTITY = projected.SUN_ENTITY;
  VACATION_MODE_ENTITY = projected.VACATION_MODE_ENTITY;
  HOME_OFF_SCRIPT_ENTITY = projected.HOME_OFF_SCRIPT_ENTITY;
  LAUNDRY_ENTITIES = projected.LAUNDRY_ENTITIES;
  ROOM_CAMERA_ENTITIES = projected.ROOM_CAMERA_ENTITIES;
  NAV_SCREENS = projected.NAV_SCREENS;
  NAV_TABS = projected.NAV_TABS;
  ENABLED_MODULES = projected.ENABLED_MODULES;
  SONG_MEDIA_TARGETS = projected.SONG_MEDIA_TARGETS;
}

export function resetHouseholdDataToLegacy(): void {
  HOUSEHOLD_DATA_SOURCE = 'legacy';
  HOUSEHOLD_RUNTIME_MODEL = legacyHouseholdRuntimeModel;
  ROOM_SEED = LEGACY_ROOM_SEED;
  ROOM_HERO_CONFIGS = projectRoomHeroConfigs(legacyHouseholdRuntimeModel);
  MEDIA_SEED = LEGACY_MEDIA_SEED;
  ENERGY_SENSORS = LEGACY_ENERGY_SENSORS;
  SUN_ENTITY = LEGACY_SUN_ENTITY;
  VACATION_MODE_ENTITY = LEGACY_VACATION_MODE_ENTITY;
  HOME_OFF_SCRIPT_ENTITY = LEGACY_HOME_OFF_SCRIPT_ENTITY;
  LAUNDRY_ENTITIES = projectLaundryEntities(legacyHouseholdRuntimeModel.globalEntities.laundry);
  ROOM_CAMERA_ENTITIES = LEGACY_ROOM_CAMERA_ENTITIES;
  NAV_SCREENS = LEGACY_SCREENS;
  NAV_TABS = LEGACY_TABS;
  ENABLED_MODULES = LEGACY_ENABLED_MODULES;
  SONG_MEDIA_TARGETS = legacySongTargets();
}
