import { describe, expect, it } from 'vitest';
import neutralSmall from '../../../config/examples/neutral-small.json';
import neutralStudio from '../../../config/examples/neutral-studio.json';
import {
  compareRuntimeModels,
  compileHouseholdConfig,
  parseHouseholdConfig,
  type ConfigIssue,
  type HouseholdConfigV3,
} from './household-config.ts';

function parseValid(input: unknown): HouseholdConfigV3 {
  const result = parseHouseholdConfig(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function parseIssues(input: unknown): ConfigIssue[] {
  const result = parseHouseholdConfig(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected invalid config');
  return result.issues;
}

function expectIssue(input: unknown, code: ConfigIssue['code'], path: string): void {
  expect(parseIssues(input)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code, path }),
  ]));
}

describe('household config v3', () => {
  it('accepts two independent configurations and compiles different runtime models', () => {
    const first = compileHouseholdConfig(parseValid(neutralSmall));
    const second = compileHouseholdConfig(parseValid(neutralStudio));

    expect(first).not.toEqual(second);
    expect(first.rooms.map((room) => room.id)).toEqual(['den', 'entry']);
    expect(second.rooms.map((room: { id: string }) => room.id)).toEqual(['studio', 'patio', 'utility']);
  });

  it('represents unavailable optional global integrations explicitly as null', () => {
    const setupConfig = structuredClone(parseValid(neutralStudio));
    setupConfig.globalEntities = {
      sun: null,
      vacationMode: null,
      homeOffScript: null,
      laundry: { washer: null, dryer: null },
    };
    const runtime = compileHouseholdConfig(parseValid(setupConfig));

    expect(runtime.globalEntities).toEqual(setupConfig.globalEntities);
    expect(runtime.subscriptionEntityIds.every((entityId) => entityId !== '')).toBe(true);
    expect(runtime.commandContracts.every(({ entityId }) => entityId !== '')).toBe(true);
  });

  it('accepts typed binary and enum laundry adapters and subscribes their sources', () => {
    const typed = {
      ...neutralSmall,
      globalEntities: {
        ...neutralSmall.globalEntities,
        laundry: {
          washer: {
            type: 'entity',
            entityId: 'binary_sensor.fixture_washer',
            runningStates: ['on'],
            doneStates: ['off'],
            doneOnInitial: false,
          },
          dryer: {
            type: 'entity',
            entityId: 'sensor.fixture_dryer_status',
            runningStates: ['running', 'drying'],
            doneStates: ['done'],
            doneOnInitial: true,
          },
        },
      },
    };

    const runtime = compileHouseholdConfig(parseValid(typed));
    expect(runtime.globalEntities.laundry).toEqual(typed.globalEntities.laundry);
    expect(runtime.subscriptionEntityIds).toEqual(expect.arrayContaining([
      'binary_sensor.fixture_washer',
      'sensor.fixture_dryer_status',
    ]));

    const selectSource = structuredClone(typed);
    selectSource.globalEntities.laundry.dryer.entityId = 'select.fixture_dryer_status';
    expect(parseValid(selectSource).globalEntities.laundry.dryer?.entityId)
      .toBe('select.fixture_dryer_status');

    const incompatible = structuredClone(typed);
    incompatible.globalEntities.laundry.washer.entityId = 'light.fixture_washer';
    expectIssue(incompatible, 'INVALID_ENTITY_ID', '$.globalEntities.laundry.washer.entityId');

    const overlapping = structuredClone(typed);
    overlapping.globalEntities.laundry.dryer.doneStates = ['running'];
    expectIssue(overlapping, 'INVALID_VALUE', '$.globalEntities.laundry.dryer.doneStates[0]');
  });

  it('fails closed for partial data, wrong types, unknown fields and invalid HA entity IDs', () => {
    expectIssue({}, 'REQUIRED', '$.schemaVersion');
    expectIssue({ ...neutralSmall, rooms: 'den' }, 'TYPE_MISMATCH', '$.rooms');
    expectIssue({ ...neutralSmall, unexpected: true }, 'UNKNOWN_FIELD', '$.unexpected');

    const invalidEntity = structuredClone(neutralSmall);
    invalidEntity.rooms[0].visibleEntities[0].entityId = 'Light.Not Valid';
    expectIssue(invalidEntity, 'INVALID_ENTITY_ID', '$.rooms[0].visibleEntities[0].entityId');

    const emptyId = structuredClone(neutralSmall);
    emptyId.rooms[0].id = '';
    expectIssue(emptyId, 'INVALID_ID', '$.rooms[0].id');
  });

  it('fails closed for sparse root and nested collections without shifting indices', () => {
    const sparseRooms: unknown[] = new Array(neutralSmall.rooms.length);
    sparseRooms[0] = structuredClone(neutralSmall.rooms[0]);
    expectIssue({ ...neutralSmall, rooms: sparseRooms }, 'REQUIRED', '$.rooms[1]');

    const sparseEntities: unknown[] = new Array(neutralSmall.rooms[0].visibleEntities.length);
    sparseEntities[1] = structuredClone(neutralSmall.rooms[0].visibleEntities[1]);
    const nestedRoom = { ...neutralSmall.rooms[0], visibleEntities: sparseEntities };
    const nestedInput = { ...neutralSmall, rooms: [nestedRoom, neutralSmall.rooms[1]] };
    expectIssue(nestedInput, 'REQUIRED', '$.rooms[0].visibleEntities[0]');
  });

  it('rejects unknown schema versions, duplicate IDs and duplicate HA entity IDs', () => {
    expectIssue({ ...neutralSmall, schemaVersion: 4 }, 'UNKNOWN_SCHEMA_VERSION', '$.schemaVersion');

    const duplicateRoom = structuredClone(neutralSmall);
    duplicateRoom.rooms[1].id = duplicateRoom.rooms[0].id;
    expectIssue(duplicateRoom, 'DUPLICATE_ID', '$.rooms[1].id');

    const duplicateEntity = structuredClone(neutralSmall);
    duplicateEntity.globalEntities.sun = duplicateEntity.rooms[0].visibleEntities[0].entityId;
    expectIssue(duplicateEntity, 'DUPLICATE_ENTITY_ID', '$.globalEntities.sun');
  });

  it('rejects dangling references and inconsistent module configuration', () => {
    const danglingRoom = structuredClone(neutralSmall);
    danglingRoom.navigation[1].target.id = 'missing_room';
    expectIssue(danglingRoom, 'UNKNOWN_REFERENCE', '$.navigation[1].target.id');

    const danglingMediaRoom = structuredClone(neutralSmall);
    danglingMediaRoom.mediaTargets[0].roomId = 'missing_room';
    expectIssue(danglingMediaRoom, 'UNKNOWN_REFERENCE', '$.mediaTargets[0].roomId');

    const missingEnergy: Record<string, unknown> = structuredClone(neutralSmall);
    missingEnergy.energy = null;
    expectIssue(missingEnergy, 'INCONSISTENT_MODULE', '$.energy');

    const disabledEnergy: Record<string, unknown> = structuredClone(neutralStudio);
    disabledEnergy.energy = structuredClone(neutralSmall.energy);
    expectIssue(disabledEnergy, 'INCONSISTENT_MODULE', '$.energy');
  });

  it('does not mutate its unknown input', () => {
    const input = structuredClone(neutralSmall);
    const before = JSON.stringify(input);
    parseValid(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('normalizes deterministically and includes only configured HA entity IDs', () => {
    const parsed = parseValid(neutralSmall);
    const first = compileHouseholdConfig(parsed);
    const reordered = structuredClone(neutralSmall);
    reordered.rooms[1].visibleEntities.reverse();
    reordered.navigation.reverse();
    reordered.enabledModules.reverse();
    reordered.mediaTargets.reverse();
    reordered.energy!.sensors.consumptionPower.reverse();
    const second = compileHouseholdConfig(parseValid(reordered));

    expect(second).toEqual(first);

    const reorderedRooms = structuredClone(neutralSmall);
    reorderedRooms.rooms.reverse();
    const roomOrderComparison = compareRuntimeModels(
      first,
      compileHouseholdConfig(parseValid(reorderedRooms)),
    );
    expect(roomOrderComparison.equal).toBe(false);
    expect(roomOrderComparison.differences.some(
      ({ path }: { path: string }) => path === '$.rooms[0].id',
    )).toBe(true);

    expect(first.entityIds).toEqual([
      'binary_sensor.entry_door',
      'input_boolean.dryer_running',
      'input_boolean.washer_running',
      'light.den_main',
      'media_player.den_speaker',
      'sensor.consumption_today',
      'sensor.den_temperature',
      'sensor.solar_energy_today',
      'sensor.solar_power',
      'sensor.workshop_power',
      'sun.fixture_neutral_small',
      'switch.vacation_mode',
    ]);

    const mediaCommand = first.commandContracts.find(
      ({ entityId }: { entityId: string }) => entityId === 'media_player.den_speaker',
    );
    expect(mediaCommand).toEqual({
      entityId: 'media_player.den_speaker',
      domain: 'media_player',
      services: [
        'media_next_track',
        'media_play_pause',
        'media_previous_track',
        'media_stop',
        'play_media',
        'volume_set',
      ],
    });
  });

  it('preserves optional energy groups through validation and compilation', () => {
    const grouped = structuredClone(parseValid(neutralSmall));
    grouped.energy!.sensors.consumptionPower[0].group = 'Workshop group';

    const compiled = compileHouseholdConfig(parseValid(grouped));

    expect(compiled.energy?.sensors.consumptionPower[0]).toMatchObject({
      entityId: 'sensor.workshop_power',
      group: 'Workshop group',
    });
  });

  it('validates role, energy and command target domains fail-closed while other stays generic', () => {
    const counterexamples: Array<{
      path: string;
      mutate: (config: any) => void;
    }> = [
      { path: '$.rooms[0].visibleEntities[0].entityId', mutate: (config) => { config.rooms[0].visibleEntities[0].entityId = 'switch.not_a_light'; } },
      { path: '$.rooms[0].visibleEntities[1].entityId', mutate: (config) => { config.rooms[0].visibleEntities[1].entityId = 'binary_sensor.not_a_temperature'; } },
      { path: '$.rooms[1].visibleEntities[0].entityId', mutate: (config) => { config.rooms[1].visibleEntities[0].entityId = 'sensor.not_a_window'; } },
      { path: '$.energy.sensors.productionPower', mutate: (config) => { config.energy.sensors.productionPower = 'light.not_energy'; } },
      { path: '$.energy.sensors.consumptionPower[0].entityId', mutate: (config) => { config.energy.sensors.consumptionPower[0].entityId = 'switch.not_energy'; } },
      { path: '$.energy.kpis.consumedToday', mutate: (config) => { config.energy.kpis.consumedToday = 'input_number.not_energy'; } },
      { path: '$.mediaTargets[0].entityId', mutate: (config) => { config.mediaTargets[0].entityId = 'switch.not_media'; } },
      { path: '$.globalEntities.vacationMode', mutate: (config) => { config.globalEntities.vacationMode = 'input_boolean.not_vacation'; } },
      { path: '$.globalEntities.homeOffScript', mutate: (config) => { config.globalEntities.homeOffScript = 'switch.not_home_off'; } },
      { path: '$.globalEntities.laundry.washer.entityId', mutate: (config) => { config.globalEntities.laundry.washer.entityId = 'light.not_laundry'; } },
      { path: '$.globalEntities.sun', mutate: (config) => { config.globalEntities.sun = 'sensor.not_sun'; } },
    ];

    for (const counterexample of counterexamples) {
      const invalid = structuredClone(neutralSmall);
      counterexample.mutate(invalid);
      expectIssue(invalid, 'INVALID_ENTITY_ID', counterexample.path);
    }

    const climate = structuredClone(neutralStudio);
    climate.rooms[0].visibleEntities[1].entityId = 'sensor.not_climate';
    expectIssue(climate, 'INVALID_ENTITY_ID', '$.rooms[0].visibleEntities[1].entityId');

    const camera = structuredClone(neutralStudio);
    camera.rooms[1].visibleEntities[1].entityId = 'binary_sensor.not_camera';
    expectIssue(camera, 'INVALID_ENTITY_ID', '$.rooms[1].visibleEntities[1].entityId');

    expect(parseHouseholdConfig(neutralStudio).ok).toBe(true);
  });

  it('accepts presence trackers only from the binary_sensor or device_tracker domains', () => {
    const trackedPresence = structuredClone(neutralStudio);
    trackedPresence.rooms[0].visibleEntities[2].entityId = 'device_tracker.studio_presence';
    expect(parseHouseholdConfig(trackedPresence).ok).toBe(true);

    const invalidPresence = structuredClone(neutralStudio);
    invalidPresence.rooms[0].visibleEntities[2].entityId = 'light.not_presence';
    expectIssue(
      invalidPresence,
      'INVALID_ENTITY_ID',
      '$.rooms[0].visibleEntities[2].entityId',
    );
  });

  it('compares normalized models for equality and reports concrete difference paths', () => {
    const original = compileHouseholdConfig(parseValid(neutralSmall));
    expect(compareRuntimeModels(original, original)).toEqual({ equal: true, differences: [] });

    const changedInput = structuredClone(neutralSmall);
    changedInput.rooms[0].name = 'Reading room';
    const changed = compileHouseholdConfig(parseValid(changedInput));
    const comparison = compareRuntimeModels(original, changed);

    expect(comparison.equal).toBe(false);
    expect(comparison.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VALUE_MISMATCH', path: '$.rooms[0].name' }),
    ]));
  });
});
