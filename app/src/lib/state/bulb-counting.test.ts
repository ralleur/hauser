import { afterEach, describe, expect, it, vi } from 'vitest';
import neutralSmall from '../../../config/examples/neutral-small.json';
import panelRoomSelector from '../components/PanelRoomSelector.svelte?raw';
import { compileHouseholdConfig, parseHouseholdConfig } from '../config/household-config.ts';
import { projectActiveHouseholdData } from '../config/household-runtime-data.ts';
import {
  buildRuntimeRooms,
  countsForBulb,
  EMPTY_DEVICE_CONFIG,
  mergeCatalog,
  parseDeviceConfig,
  seedCatalog,
  setDeviceCountsAsLight,
} from './device-config.ts';
import { setRoomCountsAsLight } from './bulb-choice.ts';
import { appState } from './app.svelte.ts';
import { deviceManager, updateConfig } from './device-manager.svelte.ts';
import * as deviceConfigModule from './device-config.ts';
import { projectPhoneRooms } from './phone-home.ts';

/* Durchreichen, aber zählbar: so sieht der Test, wie oft gespeichert wird. */
vi.mock('./device-config.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./device-config.ts')>();
  return { ...original, saveDeviceConfig: vi.fn(original.saveDeviceConfig) };
});

/* Ein Raum mit einer Lampe, einer Steckdose, einem Rollo und einem Sauger.
   `flags` bestimmt, was die Einrichtung je Gerät festgehalten hat; fehlt ein
   Eintrag, fehlt das Feld (bestehende Haushalte). */
function projectedRoom(flags: Record<string, boolean | undefined>) {
  const entity = (id: string, entityId: string, role: string) => ({
    id, name: id, entityId, role, ...(flags[id] === undefined ? {} : { countsAsLight: flags[id] }),
  });
  const parsed = parseHouseholdConfig({
    ...neutralSmall,
    rooms: [{
      id: 'den', name: 'Den', hero: null,
      visibleEntities: [
        entity('lamp', 'light.den_lamp', 'light'),
        entity('plug', 'switch.den_plug', 'switch'),
        entity('blind', 'cover.den_blind', 'cover'),
        entity('vac', 'vacuum.den_vac', 'vacuum'),
      ],
    }],
    navigation: [{ id: 'home', name: 'Home', order: 0, target: { type: 'module', id: 'home' } }],
    enabledModules: ['home'],
    energy: null,
    mediaTargets: [],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return projectActiveHouseholdData(compileHouseholdConfig(parsed.value)).ROOM_SEED;
}

const discovered = [
  { entityId: 'light.den_lamp', domain: 'light' as const, name: 'lamp', area: 'den' },
  { entityId: 'switch.den_plug', domain: 'switch' as const, name: 'plug', area: 'den' },
  { entityId: 'cover.den_blind', domain: 'cover' as const, name: 'blind', area: 'den' },
  { entityId: 'vacuum.den_vac', domain: 'vacuum' as const, name: 'vac', area: 'den' },
];

function runtimeRooms(seed: ReturnType<typeof projectedRoom>, config = EMPTY_DEVICE_CONFIG) {
  return buildRuntimeRooms(seed, mergeCatalog(seedCatalog(seed), discovered), config);
}

/* Was die Raumzusammenfassung sagt, wenn nur `on` brennt. */
function phoneLightsOn(rooms: ReturnType<typeof runtimeRooms>, on: readonly string[]) {
  return projectPhoneRooms(rooms, {
    temperature: () => null,
    climate: () => null,
    light: (roomId, lightId) => {
      const device = rooms.find((room) => room.id === roomId)?.lights.find((light) => light.id === lightId);
      return { on: !!device && on.includes(device.entityId), brightness: 0 };
    },
  })[0];
}

describe('countsForBulb', () => {
  it('uses the explicit choice and otherwise the surface default', () => {
    expect(countsForBulb({})).toBe(true);
    expect(countsForBulb({}, false)).toBe(false);
    expect(countsForBulb({ countsAsLight: false })).toBe(false);
    expect(countsForBulb({ countsAsLight: true }, false)).toBe(true);
  });
});

describe('household config to runtime rooms', () => {
  it('carries the per-device choice from the setup into the room devices', () => {
    const rooms = runtimeRooms(projectedRoom({ lamp: true, plug: false, blind: false }));
    const flags = Object.fromEntries(rooms[0].lights.map((light) => [light.entityId, light.countsAsLight]));
    expect(flags).toEqual({
      'light.den_lamp': true,
      'switch.den_plug': false,
      'cover.den_blind': false,
      'vacuum.den_vac': undefined,
    });
  });

  it('a device override beats the setup choice in both directions', () => {
    const seed = projectedRoom({ lamp: true, plug: false });
    let config = setDeviceCountsAsLight(EMPTY_DEVICE_CONFIG, 'switch.den_plug', true);
    config = setDeviceCountsAsLight(config, 'light.den_lamp', false);
    const rooms = runtimeRooms(seed, config);
    const byId = new Map(rooms[0].lights.map((light) => [light.entityId, light.countsAsLight]));
    expect(byId.get('switch.den_plug')).toBe(true);
    expect(byId.get('light.den_lamp')).toBe(false);
  });

  it('persists the override through the shared device config and ignores bad values', () => {
    const config = setDeviceCountsAsLight(EMPTY_DEVICE_CONFIG, 'switch.den_plug', false);
    expect(parseDeviceConfig(JSON.stringify(config))).toEqual(config);
    expect(parseDeviceConfig(JSON.stringify({
      version: 1, devices: { 'switch.den_plug': { countsAsLight: 'no' } }, order: {}, groups: {},
    })).devices['switch.den_plug']).toEqual({});
    // Gruppen sind keine verwalteten Entitäten: für sie wird nichts gespeichert.
    expect(setDeviceCountsAsLight(EMPTY_DEVICE_CONFIG, 'group.hauser_1', true)).toEqual(EMPTY_DEVICE_CONFIG);
  });
});

describe('room lightbulb count (phone summary)', () => {
  const everything = ['light.den_lamp', 'switch.den_plug', 'cover.den_blind', 'vacuum.den_vac'];

  it('stays dark with plug, open blind and vacuum on once the setup says they do not count', () => {
    const rooms = runtimeRooms(projectedRoom({ lamp: true, plug: false, blind: false, vac: false }));
    const summary = phoneLightsOn(rooms, ['switch.den_plug', 'cover.den_blind', 'vacuum.den_vac']);
    expect(summary).toMatchObject({ lightsOn: 0, lightsTotal: 1 });
    expect(phoneLightsOn(rooms, ['light.den_lamp'])).toMatchObject({ lightsOn: 1, lightsTotal: 1 });
    expect(phoneLightsOn(rooms, everything)).toMatchObject({ lightsOn: 1, lightsTotal: 1 });
  });

  it('counts a plug the user marks as a light, and drops a lamp marked as not', () => {
    const rooms = runtimeRooms(projectedRoom({ lamp: true, plug: true }));
    expect(phoneLightsOn(rooms, ['switch.den_plug'])).toMatchObject({ lightsOn: 1, lightsTotal: 2 });
    expect(phoneLightsOn(rooms, [])).toMatchObject({ lightsOn: 0, lightsTotal: 2 });
    const muted = runtimeRooms(projectedRoom({ lamp: false }));
    expect(phoneLightsOn(muted, ['light.den_lamp'])).toMatchObject({ lightsOn: 0, lightsTotal: 0 });
  });

  it('keeps the previous phone behaviour when the field is missing (only lights count)', () => {
    const rooms = runtimeRooms(projectedRoom({}));
    expect(phoneLightsOn(rooms, ['switch.den_plug', 'cover.den_blind'])).toMatchObject({ lightsOn: 0, lightsTotal: 1 });
    expect(phoneLightsOn(rooms, ['light.den_lamp'])).toMatchObject({ lightsOn: 1, lightsTotal: 1 });
  });
});

describe('room lightbulb count (panel room selector)', () => {
  /* Dieselbe Rechnung wie im Ausdruck der Komponente: gezählt wird, was
     zählt UND an ist. */
  const bulbOn = (rooms: ReturnType<typeof runtimeRooms>, on: readonly string[]) =>
    rooms[0].lights.filter((light) => countsForBulb(light) && on.includes(light.entityId)).length > 0;

  it('lights up for a plug or open blind only while the field is missing', () => {
    const legacy = runtimeRooms(projectedRoom({}));
    expect(bulbOn(legacy, ['switch.den_plug'])).toBe(true);
    expect(bulbOn(legacy, ['cover.den_blind'])).toBe(true);
    expect(bulbOn(legacy, [])).toBe(false);

    const imported = runtimeRooms(projectedRoom({ lamp: true, plug: false, blind: false, vac: false }));
    expect(bulbOn(imported, ['switch.den_plug', 'cover.den_blind', 'vacuum.den_vac'])).toBe(false);
    expect(bulbOn(imported, ['light.den_lamp'])).toBe(true);
  });

  it('is wired to the same predicate in the component', () => {
    expect(panelRoomSelector).toMatch(/countsForBulb\(light\) && mergedLight\(room\.id, light\.id\)\?\.on/);
  });
});

describe('room bulk choice', () => {
  const mixed = () => runtimeRooms(projectedRoom({})).flatMap((room) => room.lights);
  const flagsOf = (config: ReturnType<typeof setRoomCountsAsLight>) =>
    Object.fromEntries(Object.entries(config.devices).map(([id, value]) => [id, value.countsAsLight]));

  it('count only lights: lamps on, plug, blind and vacuum off', () => {
    expect(flagsOf(setRoomCountsAsLight(EMPTY_DEVICE_CONFIG, mixed(), true))).toEqual({
      'light.den_lamp': true,
      'switch.den_plug': false,
      'cover.den_blind': false,
      'vacuum.den_vac': false,
    });
  });

  it('count everything: all candidates on', () => {
    expect(Object.values(flagsOf(setRoomCountsAsLight(EMPTY_DEVICE_CONFIG, mixed(), false)))).toEqual([true, true, true, true]);
  });

  it('handles rooms that only hold lights or only hold switches', () => {
    const lights = mixed().filter((device) => device.domain === 'light');
    const switches = mixed().filter((device) => device.domain === 'switch');
    expect(Object.values(flagsOf(setRoomCountsAsLight(EMPTY_DEVICE_CONFIG, lights, true)))).toEqual([true]);
    expect(Object.values(flagsOf(setRoomCountsAsLight(EMPTY_DEVICE_CONFIG, switches, true)))).toEqual([false]);
    expect(setRoomCountsAsLight(EMPTY_DEVICE_CONFIG, [], true)).toEqual(EMPTY_DEVICE_CONFIG);
  });

  it('overwrites earlier choices but keeps the other override fields, without mutating the input', () => {
    const before = setDeviceCountsAsLight(
      { ...EMPTY_DEVICE_CONFIG, devices: { 'switch.den_plug': { name: 'Stecker', visible: true } } },
      'switch.den_plug', true,
    );
    const after = setRoomCountsAsLight(before, mixed(), true);
    expect(after.devices['switch.den_plug']).toEqual({ name: 'Stecker', visible: true, countsAsLight: false });
    expect(before.devices['switch.den_plug']?.countsAsLight).toBe(true);
  });

  it('ignores groups and non-candidate categories', () => {
    const devices = [
      { entityId: 'group.hauser_1', domain: 'light', category: 'light' as const },
      { entityId: 'sensor.den_temp', domain: 'sensor', category: 'info' as const },
      { entityId: 'fan.den_fan', domain: 'fan', category: 'fan' as const },
      { entityId: 'light.den_lamp', domain: 'light', category: 'light' as const },
    ];
    expect(flagsOf(setRoomCountsAsLight(EMPTY_DEVICE_CONFIG, devices, true))).toEqual({ 'light.den_lamp': true });
  });
});

describe('room bulk choice in the device manager', () => {
  afterEach(() => {
    deviceManager.config = EMPTY_DEVICE_CONFIG;
  });

  it('applies the whole room with a single save', () => {
    const seed = projectedRoom({});
    appState.rooms = runtimeRooms(seed);
    const save = vi.mocked(deviceConfigModule.saveDeviceConfig);
    save.mockClear();
    updateConfig(setRoomCountsAsLight(deviceManager.config, appState.rooms.find((room) => room.id === 'den')!.lights, true));
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(Object.entries(deviceManager.config.devices).map(([id, value]) => [id, value.countsAsLight]))).toEqual({
      'light.den_lamp': true,
      'switch.den_plug': false,
      'cover.den_blind': false,
      'vacuum.den_vac': false,
    });
  });
});
