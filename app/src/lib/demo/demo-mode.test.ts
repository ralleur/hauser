import { describe, expect, it } from 'vitest';
import { DEMO_DEVICE_CONFIG_KEY, DEMO_LIGHT_PLACEMENT_KEY, installDemoDevices } from './demo-mode.ts';
import { DEVICE_CONFIG_KEY, parseDeviceConfig } from '../state/device-config.ts';
import { IMMERSION_LIGHT_CONFIG_KEY, parseImmersionLightConfig } from '../state/immersion-light.ts';

describe('demo devices', () => {
  it('uses the device manager key without importing it into the start path', () => {
    expect(DEMO_DEVICE_CONFIG_KEY).toBe(DEVICE_CONFIG_KEY);
    expect(DEMO_LIGHT_PLACEMENT_KEY).toBe(IMMERSION_LIGHT_CONFIG_KEY);
  });

  it('places every demo lamp on its drawn lamp, unless the visitor placed them', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    installDemoDevices(storage);
    const seeded = store.get(IMMERSION_LIGHT_CONFIG_KEY);
    if (!seeded) return; // nicht im Demo-Build: nichts vorbelegt
    const rooms = parseImmersionLightConfig(seeded).rooms;
    expect(Object.keys(rooms.wohnzimmer)).toHaveLength(5);
    expect(rooms.schlafzimmer['light.schlafzimmer_bett']).toBeDefined();
    expect(rooms.bad['light.bad_spiegel']).toBeDefined();
    expect(rooms.kueche['light.kueche_ledleiste']).toBeDefined();
    store.set(IMMERSION_LIGHT_CONFIG_KEY, '{"version":1,"rooms":{}}');
    installDemoDevices(storage);
    expect(store.get(IMMERSION_LIGHT_CONFIG_KEY)).toBe('{"version":1,"rooms":{}}');
  });

  it('seeds the ceiling fan only while nothing is stored yet', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    installDemoDevices(storage);
    const seeded = store.get(DEVICE_CONFIG_KEY);
    if (!seeded) return; // nicht im Demo-Build: nichts vorbelegt
    expect(parseDeviceConfig(seeded).devices['fan.demo_ventilator_wohnzimmer']).toMatchObject({ visible: true, roomId: 'schlafzimmer' });
    expect(parseDeviceConfig(seeded).devices['cover.demo_rollo_wohnzimmer']).toMatchObject({ visible: true, roomId: 'wohnzimmer' });
    store.set(DEVICE_CONFIG_KEY, '{"version":1,"devices":{},"order":{}}');
    installDemoDevices(storage);
    expect(store.get(DEVICE_CONFIG_KEY)).toBe('{"version":1,"devices":{},"order":{}}');
  });
});
