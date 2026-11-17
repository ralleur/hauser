import { describe, expect, it, vi } from 'vitest';
import { applyDemoImageLink, demoResponse, DEMO_DEVICE_CONFIG_KEY, DEMO_LIGHT_PLACEMENT_KEY, installDemoDevices } from './demo-mode.ts';
import { LAYOUT_CONFIG_KEY, parseLayoutConfig } from '../state/layout-config.ts';
import { DEVICE_CONFIG_KEY, parseDeviceConfig } from '../state/device-config.ts';
import { IMMERSION_LIGHT_CONFIG_KEY, parseImmersionLightConfig } from '../state/immersion-light.ts';

vi.mock('./recording-mode.ts', async importOriginal => ({
  ...await importOriginal<typeof import('./recording-mode.ts')>(), IS_DEMO: true,
}));

describe('demo devices', () => {
  it('uses fictional people for both reminder titles and the configured residents', async () => {
    const reminders = await demoResponse('/api/reminders', 'GET')!.json();
    const config = await demoResponse('/api/config', 'GET')!.json();
    const persons = JSON.parse(config.values['hmi:reminder-persons:v1']);
    expect(persons.map((person: { id: string }) => person.id)).toEqual(['mia', 'leo', 'beide']);
    expect(reminders.items.some((item: { title: string }) => item.title.startsWith('Mia - '))).toBe(true);
    expect(reminders.items.some((item: { title: string }) => item.title.startsWith('Leo - '))).toBe(true);
    expect(JSON.stringify({ reminders, persons })).not.toMatch(/Sam|Alex/i);
  });
  it('includes the commute in a public demo, with a reusable map and simulated traffic', async () => {
    const status = await demoResponse('/api/commute', 'GET')!.json();
    const preview = await demoResponse('/api/admin/commute/preview', 'POST')!.json();
    expect(status.config.entryId).toBe('demo-koeln-aachen');
    expect(status.route.simulated).toBe(true);
    expect(status.route.mapStatus).toBe('ready');
    expect(status.route.roads.length).toBeGreaterThan(100);
    expect(status.route.areas.length).toBeGreaterThan(0);
    expect(status.route.line).toHaveLength(15);
    expect(preview.route.mapKey).toBe(status.route.mapKey);
    expect(preview.route.sections[0].points.length).toBeGreaterThan(1);
  });

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

  it('replaces the untouched wide seed of earlier visits with the close zones', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    installDemoDevices(storage);
    const seeded = store.get(IMMERSION_LIGHT_CONFIG_KEY);
    if (!seeded) return; // nicht im Demo-Build: nichts vorbelegt
    /* Die breite Vorbelegung bis 0.48.1 im Speicher eines früheren Besuchs. */
    const wide = JSON.parse(seeded);
    wide.rooms.wohnzimmer['light.wohnzimmer_kugellampen'] = { x: 0.457, y: 0.199, radius: 0.03 };
    wide.rooms.wohnzimmer['light.wohnzimmer_esstisch'] = { x: 0.889, y: 0.14, radius: 0.062, ry: 0.052 };
    wide.rooms.wohnzimmer['light.wohnzimmer_fensterlampe'] = { x: 0.653, y: 0.298, radius: 0.032, ry: 0.022, rotation: -18 };
    wide.rooms.wohnzimmer['light.wohnzimmer_tv'] = { x: 0.479, y: 0.398, radius: 0.024 };
    wide.rooms.wohnzimmer['cover.demo_rollo_wohnzimmer'] = { x: 0.36, y: 0.3, radius: 0.16 };
    wide.rooms.schlafzimmer['light.schlafzimmer_bett'] = { x: 0.658, y: 0.475, radius: 0.034, ry: 0.04 };
    wide.rooms.bad['light.bad_spiegel'] = { x: 0.058, y: 0.062, radius: 0.058, ry: 0.05 };
    wide.rooms.kueche['light.kueche_ledleiste'] = { x: 0.9, y: 0.328, radius: 0.105, ry: 0.03 };
    store.set(IMMERSION_LIGHT_CONFIG_KEY, JSON.stringify(wide));
    installDemoDevices(storage);
    expect(store.get(IMMERSION_LIGHT_CONFIG_KEY)).toBe(seeded);
  });

  it.each(['current', '0.49', 'shade/window'])('corrects the untouched %s image seed and preserves visitor edits', (version) => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    installDemoDevices(storage);
    const seeded = store.get(IMMERSION_LIGHT_CONFIG_KEY)!;
    const previous = JSON.parse(seeded);
    previous.rooms.wohnzimmer['light.wohnzimmer_kugellampen'] = { x: 0.4575, y: 0.199, radius: 0.022 };
    previous.rooms.wohnzimmer['light.wohnzimmer_tv'] = { x: 0.476, y: 0.398, radius: 0.013 };
    if (version !== 'shade/window') {
      previous.rooms.wohnzimmer['light.wohnzimmer_esstisch'] = { x: 0.894, y: 0.119, radius: 0.058, ry: 0.034 };
      previous.rooms.wohnzimmer['cover.demo_rollo_wohnzimmer'] = { x: 0.36, y: 0.3, radius: 0.16 };
    }
    if (version === '0.49') previous.rooms.wohnzimmer['light.wohnzimmer_fensterlampe'] = { x: 0.648, y: 0.293, radius: 0.025, ry: 0.016, rotation: -18 };
    store.set(IMMERSION_LIGHT_CONFIG_KEY, JSON.stringify(previous));
    installDemoDevices(storage);
    expect(store.get(IMMERSION_LIGHT_CONFIG_KEY)).toBe(seeded);
    const rooms = parseImmersionLightConfig(seeded).rooms;
    const blind = rooms.wohnzimmer['cover.demo_rollo_wohnzimmer'];
    expect(blind.points).toHaveLength(4);
    expect(blind.points!.every(p => p.x < 0.31 && p.y > 0.2 && p.y < 0.48)).toBe(true);
    const shade = rooms.wohnzimmer['light.wohnzimmer_esstisch'];
    expect(shade.y).toBeGreaterThan(0.14);
    expect(shade.ry! / shade.radius).toBeLessThan(0.2);
    expect(shade.rotation).toBeLessThan(0);

    previous.rooms.wohnzimmer['light.wohnzimmer_esstisch'].x = 0.8;
    const own = JSON.stringify(previous);
    store.set(IMMERSION_LIGHT_CONFIG_KEY, own);
    installDemoDevices(storage);
    expect(store.get(IMMERSION_LIGHT_CONFIG_KEY)).toBe(own);
  });

  it('opens image control in the living room from demo/#image and restores the layout afterwards', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    const session = new Map<string, string>();
    const own = '{"version":1,"widthPreset":"wide","homeView":"rooms","slots":[{"id":"slot-1","roomId":"kueche"}]}';
    store.set(LAYOUT_CONFIG_KEY, own);
    applyDemoImageLink('#image', storage, { setItem: (k, v) => { session.set(k, v); } });
    const layout = parseLayoutConfig(store.get(LAYOUT_CONFIG_KEY) ?? null);
    expect(layout).toMatchObject({ homeView: 'image', widthPreset: 'wide', slots: [{ id: 'slot-1', roomId: 'wohnzimmer' }] });
    expect(session.get('hmi:demo-greeted')).toBe('1');
    applyDemoImageLink('#image', storage, null);
    applyDemoImageLink('', storage, null);
    expect(store.get(LAYOUT_CONFIG_KEY)).toBe(own);
    store.delete(LAYOUT_CONFIG_KEY);
    applyDemoImageLink('#IMAGE', storage, null);
    expect(parseLayoutConfig(store.get(LAYOUT_CONFIG_KEY) ?? null).homeView).toBe('image');
    applyDemoImageLink('#energy', storage, null);
    expect(store.has(LAYOUT_CONFIG_KEY)).toBe(false);
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
