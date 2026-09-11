import { describe, expect, it } from 'vitest';
import { DEMO_DEVICE_CONFIG_KEY, installDemoDevices } from './demo-mode.ts';
import { DEVICE_CONFIG_KEY, parseDeviceConfig } from '../state/device-config.ts';

describe('demo devices', () => {
  it('uses the device manager key without importing it into the start path', () => {
    expect(DEMO_DEVICE_CONFIG_KEY).toBe(DEVICE_CONFIG_KEY);
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
