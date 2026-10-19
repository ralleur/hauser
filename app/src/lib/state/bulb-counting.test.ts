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
import { appState } from './app.svelte.ts';
import { deviceManager, setCountsAsLight } from './device-manager.svelte.ts';
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
  it('uses the explicit choice and otherwise counts only lights', () => {
    expect(countsForBulb({ domain: 'light' })).toBe(true);
    expect(countsForBulb({ entityId: 'light.lamp' })).toBe(true);
    expect(countsForBulb({ domain: 'switch' })).toBe(false);
    expect(countsForBulb({ entityId: 'cover.blind' })).toBe(false);
    expect(countsForBulb({ domain: 'vacuum' })).toBe(false);
    expect(countsForBulb({ domain: 'light', countsAsLight: false })).toBe(false);
    expect(countsForBulb({ domain: 'switch', countsAsLight: true })).toBe(true);
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

  it('stays dark for a plug or open blind in existing households, too', () => {
    const legacy = runtimeRooms(projectedRoom({}));
    expect(bulbOn(legacy, ['switch.den_plug'])).toBe(false);
    expect(bulbOn(legacy, ['cover.den_blind'])).toBe(false);
    expect(bulbOn(legacy, ['light.den_lamp'])).toBe(true);
    expect(bulbOn(legacy, [])).toBe(false);

    const imported = runtimeRooms(projectedRoom({ lamp: true, plug: false, blind: false, vac: false }));
    expect(bulbOn(imported, ['switch.den_plug', 'cover.den_blind', 'vacuum.den_vac'])).toBe(false);
    expect(bulbOn(imported, ['light.den_lamp'])).toBe(true);
  });

  it('is wired to the same predicate in the component', () => {
    expect(panelRoomSelector).toMatch(/countsForBulb\(light\) && mergedLight\(room\.id, light\.id\)\?\.on/);
  });
});

describe('per-device choice in the device manager', () => {
  afterEach(() => {
    deviceManager.config = EMPTY_DEVICE_CONFIG;
  });

  it('saves a plug marked as a light once and keeps it counting', () => {
    appState.rooms = runtimeRooms(projectedRoom({}));
    const save = vi.mocked(deviceConfigModule.saveDeviceConfig);
    save.mockClear();
    setCountsAsLight('switch.den_plug', true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(deviceManager.config.devices['switch.den_plug']?.countsAsLight).toBe(true);
  });
});
