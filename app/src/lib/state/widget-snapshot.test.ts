import { afterEach, describe, expect, it, vi } from 'vitest';
import neutralSmall from '../../../config/examples/neutral-small.json';
import { runtime } from '../adapter/runtime.svelte.ts';
import { compileHouseholdConfig, parseHouseholdConfig } from '../config/household-config.ts';
import { installActiveHouseholdData, resetHouseholdDataToLegacy } from '../config/household-runtime-data.ts';
import { EMPTY_DEVICE_CONFIG, setDeviceCountsAsLight } from './device-config.ts';
import { deviceManager } from './device-manager.svelte.ts';
import { buildWidgetSnapshot } from './widget-snapshot.ts';

function install(plugCounts: boolean | undefined) {
  const parsed = parseHouseholdConfig({
    ...neutralSmall,
    rooms: [{
      id: 'den', name: 'Den', hero: null,
      visibleEntities: [
        { id: 'lamp', name: 'Lamp', entityId: 'light.den_lamp', role: 'light', countsAsLight: true },
        {
          id: 'plug', name: 'Plug', entityId: 'switch.den_plug', role: 'switch',
          ...(plugCounts === undefined ? {} : { countsAsLight: plugCounts }),
        },
        { id: 'blind', name: 'Blind', entityId: 'cover.den_blind', role: 'cover', countsAsLight: false },
      ],
    }],
    navigation: [{ id: 'home', name: 'Home', order: 0, target: { type: 'module', id: 'home' } }],
    enabledModules: ['home'],
    energy: null,
    mediaTargets: [],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  installActiveHouseholdData(compileHouseholdConfig(parsed.value));
}

function onlyOn(...entityIds: string[]) {
  vi.spyOn(runtime, 'merged').mockImplementation((entityId: string) => (
    entityIds.includes(entityId) ? { on: true, brightness: 100 } : { on: false, brightness: 0 }
  ));
}

afterEach(() => {
  vi.restoreAllMocks();
  resetHouseholdDataToLegacy();
  deviceManager.config = EMPTY_DEVICE_CONFIG;
});

describe('widget snapshot lights count', () => {
  it('ignores a plug and an open blind that are set not to count', () => {
    install(false);
    onlyOn('switch.den_plug', 'cover.den_blind');
    const room = buildWidgetSnapshot().rooms[0];
    expect(room).toMatchObject({ lightsOn: 0, lightsTotal: 1 });
    // Die Geräteliste bleibt vollständig; nur die Zählung ändert sich.
    expect(room.lights.map(({ entityId }) => entityId)).toEqual(['light.den_lamp', 'switch.den_plug', 'cover.den_blind']);
    expect(buildWidgetSnapshot().home.lightsOn).toBe(0);
  });

  it('counts the lamp, and a plug once it is set to count', () => {
    install(true);
    onlyOn('light.den_lamp', 'switch.den_plug', 'cover.den_blind');
    expect(buildWidgetSnapshot().rooms[0]).toMatchObject({ lightsOn: 2, lightsTotal: 2 });
  });

  it('lets the device override win over the setup choice', () => {
    install(false);
    onlyOn('switch.den_plug');
    deviceManager.config = setDeviceCountsAsLight(EMPTY_DEVICE_CONFIG, 'switch.den_plug', true);
    expect(buildWidgetSnapshot().rooms[0]).toMatchObject({ lightsOn: 1, lightsTotal: 2 });
  });

  it('keeps counting every device while the field is missing (existing households)', () => {
    install(undefined);
    onlyOn('switch.den_plug');
    expect(buildWidgetSnapshot().rooms[0]).toMatchObject({ lightsOn: 1, lightsTotal: 2 });
  });
});
