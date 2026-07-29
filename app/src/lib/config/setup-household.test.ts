import { describe, expect, it } from 'vitest';
import { compileHouseholdConfig, parseHouseholdConfig } from './household-config.ts';
import { projectActiveHouseholdData } from './household-runtime-data.ts';
import {
  addSetupRoom,
  buildSetupHouseholdSuggestion,
  canRemoveSetupRoom,
  canMoveSetupEntity,
  moveSetupEntity,
  moveSetupRoom,
  omitSetupEntity,
  removeSetupRoom,
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

  it('adds rooms with stable unique ids and reorders them without mutating the input', () => {
    const original = buildSetupHouseholdSuggestion(snapshot()).config;
    const proxied = new Proxy({
      ...original,
      globalEntities: new Proxy(original.globalEntities, {}),
    }, {});
    const first = addSetupRoom(proxied, 'Gäste & Hobby');
    const second = addSetupRoom(first, 'Gäste & Hobby');

    expect(original.rooms).toHaveLength(2);
    expect(second.rooms.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'hall', name: 'Hall' },
      { id: 'living_room', name: 'Living Room' },
      { id: 'gaste_hobby', name: 'Gäste & Hobby' },
      { id: 'gaste_hobby_2', name: 'Gäste & Hobby' },
    ]);

    const moved = moveSetupRoom(second, 'gaste_hobby_2', -1);
    expect(moved.rooms.map(({ id }) => id)).toEqual([
      'hall', 'living_room', 'gaste_hobby_2', 'gaste_hobby',
    ]);
    expect(moveSetupRoom(moved, 'hall', -1)).toBe(moved);
  });

  it('removes a room only through an explicit reference-safe strategy', () => {
    const config = buildSetupHouseholdSuggestion(snapshot()).config;
    config.navigation.push({
      id: 'hall_shortcut', name: 'Hall', order: 2, target: { type: 'room', id: 'hall' },
    });
    config.enabledModules.push('media');
    config.mediaTargets.push({
      id: 'hall_speaker', name: 'Hall speaker', entityId: 'media_player.hall', roomId: 'hall',
    });

    expect(canRemoveSetupRoom(config, 'hall', { type: 'move', targetRoomId: 'living_room' })).toBe(true);
    const moved = removeSetupRoom(config, 'hall', { type: 'move', targetRoomId: 'living_room' });
    expect(moved).not.toBe(config);
    expect(moved.rooms.map(({ id }) => id)).toEqual(['living_room']);
    expect(moved.rooms[0].visibleEntities.map(({ entityId }) => entityId)).toContain('binary_sensor.hall_door');
    expect(moved.navigation.find(({ id }) => id === 'hall_shortcut')?.target).toEqual({
      type: 'room', id: 'living_room',
    });
    expect(moved.mediaTargets[0].roomId).toBe('living_room');
    expect(parseHouseholdConfig(moved).ok).toBe(true);

    const omitted = removeSetupRoom(config, 'hall', { type: 'omit' });
    expect(omitted.rooms.map(({ id }) => id)).toEqual(['living_room']);
    expect(omitted.navigation.some(({ id }) => id === 'hall_shortcut')).toBe(false);
    expect(omitted.mediaTargets[0].roomId).toBeNull();
    expect(parseHouseholdConfig(omitted).ok).toBe(true);

    expect(removeSetupRoom(moved, 'living_room', { type: 'omit' })).toBe(moved);
  });

  it('blocks bulk moves that would create ambiguous singleton roles', () => {
    const config = buildSetupHouseholdSuggestion(snapshot()).config;
    const secondClimate = structuredClone(
      config.rooms.find(({ id }) => id === 'living_room')!.visibleEntities
        .find(({ role }) => role === 'climate'),
    )!;
    secondClimate.id = 'hall_climate';
    secondClimate.entityId = 'climate.hall';
    config.rooms.find(({ id }) => id === 'hall')!.visibleEntities.push(secondClimate);

    const removal = { type: 'move' as const, targetRoomId: 'living_room' };
    expect(canRemoveSetupRoom(config, 'hall', removal)).toBe(false);
    expect(removeSetupRoom(config, 'hall', removal)).toBe(config);
  });
});
