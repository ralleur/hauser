import { describe, expect, it } from 'vitest';
import { compileHouseholdConfig, parseHouseholdConfig } from './household-config.ts';
import { projectActiveHouseholdData } from './household-runtime-data.ts';
import {
  buildSetupHouseholdSuggestion,
  canMoveSetupEntity,
  moveSetupEntity,
  omitSetupEntity,
  type SetupDiscoverySnapshot,
} from './setup-household.ts';

function snapshot(): SetupDiscoverySnapshot {
  return {
    areas: [
      { area_id: 'living-area', name: 'Living Room' },
      { area_id: 'hall-area', name: 'Hall' },
    ],
    devices: [{ id: 'device-hall', area_id: 'hall-area' }],
    entities: [
      { entity_id: 'light.living_ceiling', area_id: 'living-area', device_id: null },
      { entity_id: 'climate.living_main', area_id: 'living-area', device_id: null },
      { entity_id: 'climate.living_secondary', area_id: 'living-area', device_id: null },
      { entity_id: 'binary_sensor.hall_door', area_id: null, device_id: 'device-hall' },
      { entity_id: 'sensor.unassigned_temperature', area_id: null, device_id: null },
      { entity_id: 'switch.hidden', area_id: 'living-area', device_id: null, hidden_by: 'user' },
    ],
    states: [
      { entity_id: 'sun.sun', attributes: { friendly_name: 'Sun' } },
      { entity_id: 'light.living_ceiling', attributes: { friendly_name: 'Ceiling' } },
      { entity_id: 'climate.living_main', attributes: { friendly_name: 'Main climate' } },
      { entity_id: 'climate.living_secondary', attributes: { friendly_name: 'Secondary climate' } },
      { entity_id: 'binary_sensor.hall_door', attributes: { friendly_name: 'Front door', device_class: 'door' } },
      { entity_id: 'sensor.unassigned_temperature', attributes: { device_class: 'temperature' } },
      { entity_id: 'switch.hidden', attributes: {} },
    ],
  };
}

describe('deterministic setup household suggestion', () => {
  it('uses HA areas, device inheritance and only unambiguous productive roles', () => {
    const suggestion = buildSetupHouseholdSuggestion(snapshot());

    expect(suggestion.inferredRooms).toBe(false);
    expect(suggestion.config.rooms.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'hall', name: 'Hall' },
      { id: 'living_room', name: 'Living Room' },
    ]);
    expect(suggestion.config.rooms[0].visibleEntities).toEqual([
      expect.objectContaining({ entityId: 'binary_sensor.hall_door', role: 'window' }),
    ]);
    expect(suggestion.config.rooms[1].visibleEntities.map(({ entityId }) => entityId)).toEqual([
      'climate.living_main',
      'light.living_ceiling',
    ]);
    expect(suggestion.ignoredEntityIds).toEqual([
      'climate.living_secondary',
      'sensor.unassigned_temperature',
      'switch.hidden',
    ]);
    expect(suggestion.config.globalEntities).toEqual({
      sun: 'sun.sun',
      vacationMode: null,
      homeOffScript: null,
      laundry: { washer: null, dryer: null },
    });

    const parsed = parseHouseholdConfig(suggestion.config);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(() => projectActiveHouseholdData(compileHouseholdConfig(parsed.value))).not.toThrow();
  });

  it('falls back deterministically to conservative name prefixes when HA has no areas', () => {
    const noAreas = snapshot();
    noAreas.areas = [];
    noAreas.devices = [];
    noAreas.entities = [
      { entity_id: 'light.kitchen_ceiling', area_id: null, device_id: null },
      { entity_id: 'light.living_floor', area_id: null, device_id: null },
    ];
    noAreas.states = noAreas.states.filter(({ entity_id }) => entity_id === 'sun.sun');
    noAreas.states.push(
      { entity_id: 'light.kitchen_ceiling', attributes: {} },
      { entity_id: 'light.living_floor', attributes: {} },
    );

    const suggestion = buildSetupHouseholdSuggestion(noAreas);
    expect(suggestion.inferredRooms).toBe(true);
    expect(suggestion.config.rooms.map(({ id }) => id)).toEqual(['kitchen', 'living']);
  });

  it('moves and omits proposed entities without mutating the scanned suggestion', () => {
    const original = buildSetupHouseholdSuggestion(snapshot()).config;
    expect(canMoveSetupEntity(original, 'light.living_ceiling', 'hall')).toBe(true);

    const moved = moveSetupEntity(original, 'light.living_ceiling', 'hall');
    expect(moved).not.toBe(original);
    expect(original.rooms[1].visibleEntities.map(({ entityId }) => entityId)).toContain('light.living_ceiling');
    expect(moved.rooms[0].visibleEntities.map(({ entityId }) => entityId)).toContain('light.living_ceiling');

    const omitted = omitSetupEntity(moved, 'binary_sensor.hall_door');
    expect(omitted.rooms.flatMap((room) => room.visibleEntities).map(({ entityId }) => entityId))
      .not.toContain('binary_sensor.hall_door');
    expect(parseHouseholdConfig(omitted).ok).toBe(true);
  });

  it('rejects a move that would create two singleton roles in one room', () => {
    const config = buildSetupHouseholdSuggestion(snapshot()).config;
    const hallClimate = structuredClone(
      config.rooms[1].visibleEntities.find((entity) => entity.role === 'climate'),
    )!;
    hallClimate.entityId = 'climate.hall';
    hallClimate.id = 'hall_climate';
    config.rooms[0].visibleEntities.push(hallClimate);

    expect(canMoveSetupEntity(config, 'climate.living_main', 'hall')).toBe(false);
    expect(moveSetupEntity(config, 'climate.living_main', 'hall')).toBe(config);
  });
});
