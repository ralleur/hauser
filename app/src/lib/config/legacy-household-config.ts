import {
  ENERGY_SENSORS,
  HOME_OFF_SCRIPT_ENTITY,
  LAUNDRY_ENTITIES,
  LEGACY_ENABLED_MODULES,
  LEGACY_ROOM_CAMERA_ENTITIES,
  LEGACY_TABS,
  MEDIA_SEED,
  ROOM_SEED,
  SUN_ENTITY,
  VACATION_MODE_ENTITY,
  energyRefIds,
  type EnergySensorRef,
} from './legacy-household-data.ts';
import { compileHouseholdConfig } from './household-config-compiler.ts';
import { HOUSEHOLD_SCHEMA_VERSION } from './household-config.ts';
import type {
  EnergyConfig,
  HouseholdConfigV4,
  HouseholdRuntimeModel,
  VisibleEntityConfig,
} from './household-config.ts';

function singleEnergyEntity(ref: EnergySensorRef, source: string): string | null {
  const ids = energyRefIds(ref);
  if (ids.length > 1) {
    throw new Error(`${source} cannot be represented by the scalar Config-v1 energy field.`);
  }
  return ids[0] ?? null;
}

function projectEnergy(): EnergyConfig {
  return {
    sensors: {
      productionPower: singleEnergyEntity(ENERGY_SENSORS.pv, 'ENERGY_SENSORS.pv'),
      consumptionPower: ENERGY_SENSORS.load.map((load, index) => ({
        id: `load_${index + 1}`,
        name: load.label,
        entityId: load.entityId,
        ...(load.group === undefined ? {} : { group: load.group }),
      })),
    },
    kpis: {
      producedToday: singleEnergyEntity(
        ENERGY_SENSORS.producedToday,
        'ENERGY_SENSORS.producedToday',
      ),
      consumedToday: singleEnergyEntity(
        ENERGY_SENSORS.consumedToday,
        'ENERGY_SENSORS.consumedToday',
      ),
      fedInToday: singleEnergyEntity(ENERGY_SENSORS.fedInToday, 'ENERGY_SENSORS.fedInToday'),
      drawnToday: singleEnergyEntity(ENERGY_SENSORS.drawnToday, 'ENERGY_SENSORS.drawnToday'),
    },
  };
}

/**
 * Pure projection of the currently controlling installation constants. It does
 * not import the adapter runtime or command module and never alters a source.
 */
export function projectLegacyHouseholdConfig(): HouseholdConfigV4 {
  const roomIds = new Set(ROOM_SEED.map(({ id }) => id));
  return {
    schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
    rooms: ROOM_SEED.map((room) => {
      const visibleEntities: VisibleEntityConfig[] = room.lights.map((light) => ({
        id: light.id,
        name: light.name,
        entityId: light.entityId,
        role: 'light',
      }));
      if (room.climateEntityId) {
        visibleEntities.push({
          id: 'climate',
          name: 'Klima',
          entityId: room.climateEntityId,
          role: 'climate',
        });
      }
      if (room.tempSensorId) {
        visibleEntities.push({
          id: 'temperature',
          name: 'Temperatur',
          entityId: room.tempSensorId,
          role: 'temperature',
        });
      }
      const cameraEntityId = LEGACY_ROOM_CAMERA_ENTITIES[room.id];
      if (cameraEntityId) {
        visibleEntities.push({
          id: 'camera',
          name: 'Kamera',
          entityId: cameraEntityId,
          role: 'camera',
        });
      }
      return { id: room.id, name: room.name, visibleEntities, hero: null };
    }),
    /* Nur aktive Module tragen einen Navigationseintrag — sonst weist die
       Pruefung das Dokument zurueck (INCONSISTENT_MODULE). */
    navigation: LEGACY_TABS
      .filter((tab) => (LEGACY_ENABLED_MODULES as readonly string[]).includes(tab.id))
      .map((tab, order) => ({
        id: tab.id,
        name: tab.configName,
        order,
        target: { type: 'module' as const, id: tab.id },
      })),
    enabledModules: [...LEGACY_ENABLED_MODULES],
    energy: projectEnergy(),
    mediaTargets: MEDIA_SEED.map((player) => ({
      id: player.id,
      name: player.name,
      entityId: player.entityId,
      roomId: roomIds.has(player.id) ? player.id : null,
    })),
    globalEntities: {
      sun: SUN_ENTITY,
      vacationMode: VACATION_MODE_ENTITY,
      homeOffScript: HOME_OFF_SCRIPT_ENTITY,
      laundry: {
        washer: LAUNDRY_ENTITIES.washer ? {
          type: 'entity',
          entityId: LAUNDRY_ENTITIES.washer,
          runningStates: ['on'],
          doneStates: ['off'],
          doneOnInitial: false,
        } : null,
        dryer: LAUNDRY_ENTITIES.dryer ? {
          type: 'entity',
          entityId: LAUNDRY_ENTITIES.dryer,
          runningStates: ['on'],
          doneStates: ['off'],
          doneOnInitial: false,
        } : null,
      },
    },
  };
}

export const legacyHouseholdRuntimeModel: HouseholdRuntimeModel = compileHouseholdConfig(
  projectLegacyHouseholdConfig(),
);
