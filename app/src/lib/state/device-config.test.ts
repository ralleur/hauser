import { describe, expect, it } from 'vitest';
import {
  assignDeviceRoom,
  buildRuntimeRooms,
  EMPTY_DEVICE_CONFIG,
  loadDeviceConfig,
  mergeCatalog,
  parseDeviceConfig,
  reorderDevice,
  seedCatalog,
  setDeviceName,
  setDeviceVisibility,
  setRoomOrder,
  type DeviceStorage,
  DEVICE_CONFIG_KEY,
} from './device-config.ts';
import { ROOM_SEED, type RoomSeed } from './app.svelte.ts';

class MemoryStorage implements DeviceStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const rooms = ROOM_SEED.slice(0, 2) as RoomSeed[];
const catalog = seedCatalog(rooms);

describe('device-config persistence', () => {
  it('kaputte LocalStorage-Daten werden ignoriert', () => {
    const storage = new MemoryStorage();
    storage.setItem(DEVICE_CONFIG_KEY, '{kaputt');
    expect(loadDeviceConfig(storage)).toEqual(EMPTY_DEVICE_CONFIG);
    expect(parseDeviceConfig(JSON.stringify({ version: 99, devices: [] }))).toEqual(EMPTY_DEVICE_CONFIG);
  });

  it('validiert unbekannte Entity-Domains weg', () => {
    const parsed = parseDeviceConfig(JSON.stringify({
      version: 1,
      devices: {
        'automation.foo': { visible: true, roomId: 'wohnzimmer' },
        'switch.foo': { visible: true, roomId: 'wohnzimmer' },
      },
      order: { wohnzimmer: ['automation.foo', 'switch.foo'] },
    }));
    expect(parsed.devices).toEqual({ 'switch.foo': { visible: true, roomId: 'wohnzimmer' } });
    expect(parsed.order.wohnzimmer).toEqual(['switch.foo']);
  });

  it('speichert nur bereinigte, nicht-leere Namen-Overrides', () => {
    const renamed = setDeviceName(EMPTY_DEVICE_CONFIG, 'light.test', '  Leselampe  ');
    expect(renamed.devices['light.test']).toEqual({ name: 'Leselampe' });
    expect(parseDeviceConfig(JSON.stringify(renamed))).toEqual(renamed);

    const reset = setDeviceName(renamed, 'light.test', null);
    expect(reset.devices['light.test']).toBeUndefined();
    expect(setDeviceName(EMPTY_DEVICE_CONFIG, 'light.test', '   ')).toEqual(EMPTY_DEVICE_CONFIG);
  });
});

describe('device runtime projection', () => {
  it('Seed ohne Overrides bleibt unverändert', () => {
    const projected = buildRuntimeRooms(rooms, catalog, EMPTY_DEVICE_CONFIG);
    expect(projected.map((r) => [r.id, r.lights.map((l) => l.entityId)])).toEqual(
      rooms.map((r) => [r.id, r.lights.map((l) => l.entityId)]),
    );
  });

  it('hidden entfernt Gerät aus Projektion', () => {
    const entityId = rooms[0].lights[0].entityId;
    const config = setDeviceVisibility(EMPTY_DEVICE_CONFIG, entityId, false);
    const projected = buildRuntimeRooms(rooms, catalog, config);
    expect(projected[0].lights.map((l) => l.entityId)).not.toContain(entityId);
  });

  it('add/visible fügt bestehende HA-Entity in Raum ein', () => {
    const fullCatalog = mergeCatalog(catalog, [{
      entityId: 'switch.steckdose_test',
      domain: 'switch',
      name: 'Steckdose Test',
      area: 'wohnzimmer',
    }]);
    const config = setDeviceVisibility(EMPTY_DEVICE_CONFIG, 'switch.steckdose_test', true, 'wohnzimmer');
    const projected = buildRuntimeRooms(rooms, fullCatalog, config);
    const device = projected[0].lights.find((l) => l.entityId === 'switch.steckdose_test');
    expect(device).toMatchObject({ domain: 'switch', category: 'switch', name: 'Steckdose Test', dimmable: false, icon: 'i-bolt' });
  });

  it('sensor/climate/media werden mit Kategorie, Metadaten und Default-Symbol projiziert', () => {
    const fullCatalog = mergeCatalog(catalog, [
      { entityId: 'sensor.aussentemp', domain: 'sensor', name: 'Außen', area: 'wohnzimmer', unit: '°C', deviceClass: 'temperature' },
      { entityId: 'climate.buero', domain: 'climate', name: 'Heizung Büro', area: 'wohnzimmer' },
      { entityId: 'media_player.tv', domain: 'media_player', name: 'Fernseher', area: 'wohnzimmer' },
      { entityId: 'binary_sensor.fenster', domain: 'binary_sensor', name: 'Fenster', area: 'wohnzimmer', deviceClass: 'window' },
    ]);
    let config = EMPTY_DEVICE_CONFIG;
    for (const id of ['sensor.aussentemp', 'climate.buero', 'media_player.tv', 'binary_sensor.fenster']) {
      config = setDeviceVisibility(config, id, true, 'wohnzimmer');
    }
    const projected = buildRuntimeRooms(rooms, fullCatalog, config);
    const byId = new Map(projected[0].lights.map((l) => [l.entityId, l]));
    expect(byId.get('sensor.aussentemp')).toMatchObject({ category: 'info', unit: '°C', deviceClass: 'temperature', icon: 'i-gauge' });
    expect(byId.get('climate.buero')).toMatchObject({ category: 'temp', icon: 'i-thermometer' });
    expect(byId.get('media_player.tv')).toMatchObject({ category: 'media', icon: 'i-playlist-music' });
    expect(byId.get('binary_sensor.fenster')).toMatchObject({ category: 'info', deviceClass: 'window' });
  });

  it('Namen-Override gilt für alle Gerätekategorien in der Projektion', () => {
    const discovered = [
      { entityId: 'switch.test', domain: 'switch' as const, name: 'Schalter', area: 'wohnzimmer' },
      { entityId: 'sensor.test', domain: 'sensor' as const, name: 'Sensor', area: 'wohnzimmer' },
      { entityId: 'climate.test', domain: 'climate' as const, name: 'Klima', area: 'wohnzimmer' },
      { entityId: 'media_player.test', domain: 'media_player' as const, name: 'Media', area: 'wohnzimmer' },
    ];
    const fullCatalog = mergeCatalog(catalog, discovered);
    let config = EMPTY_DEVICE_CONFIG;
    for (const item of discovered) {
      config = setDeviceVisibility(config, item.entityId, true, 'wohnzimmer');
      config = setDeviceName(config, item.entityId, `Neu ${item.name}`);
    }
    config = setDeviceName(config, rooms[0].lights[0].entityId, 'Neue Lampe');

    const projected = buildRuntimeRooms(rooms, fullCatalog, config);
    const names = new Map(projected[0].lights.map((device) => [device.entityId, device.name]));
    expect(names.get(rooms[0].lights[0].entityId)).toBe('Neue Lampe');
    for (const item of discovered) expect(names.get(item.entityId)).toBe(`Neu ${item.name}`);
  });

  it('Raumzuordnung verschiebt ein Gerät', () => {
    const entityId = rooms[0].lights[0].entityId;
    const config = assignDeviceRoom(EMPTY_DEVICE_CONFIG, entityId, rooms[1].id);
    const projected = buildRuntimeRooms(rooms, catalog, config);
    expect(projected[0].lights.map((l) => l.entityId)).not.toContain(entityId);
    expect(projected[1].lights.map((l) => l.entityId)).toContain(entityId);
  });

  it('setRoomOrder übernimmt die komplette Reihenfolge (RoomEdit-Pfeile)', () => {
    const ids = rooms[0].lights.map((l) => l.entityId);
    const swapped = [ids[1], ids[0], ...ids.slice(2)];
    const config = setRoomOrder(EMPTY_DEVICE_CONFIG, rooms[0].id, ['automation.invalid', ...swapped]);
    expect(config.order[rooms[0].id]).toEqual(swapped); // unbekannte Domains fliegen raus
    const projected = buildRuntimeRooms(rooms, catalog, config);
    expect(projected[0].lights.map((l) => l.entityId)).toEqual(swapped);
  });

  it('Hinzufügen ans Ende: setRoomOrder nach assignDeviceRoom rankt neu ans Ende', () => {
    const ids = rooms[0].lights.map((l) => l.entityId);
    const extra = 'switch.steckdose_neu';
    const fullCatalog = mergeCatalog(catalog, [{ entityId: extra, domain: 'switch', name: 'Neu', area: rooms[0].id }]);
    let config = assignDeviceRoom(EMPTY_DEVICE_CONFIG, extra, rooms[0].id);
    config = setRoomOrder(config, rooms[0].id, [...ids, extra]);
    const projected = buildRuntimeRooms(rooms, fullCatalog, config);
    expect(projected[0].lights.map((l) => l.entityId)).toEqual([...ids, extra]);
  });

  it('order sortiert Geräte stabil', () => {
    const ids = rooms[0].lights.slice(0, 2).map((l) => l.entityId);
    let config = reorderDevice(EMPTY_DEVICE_CONFIG, rooms[0].id, ids[1], ids[0]);
    config = reorderDevice(config, rooms[0].id, ids[0], null);
    const projected = buildRuntimeRooms(rooms, catalog, config);
    const visible = projected[0].lights.map((l) => l.entityId).filter((id) => ids.includes(id));
    expect(visible).toEqual([ids[1], ids[0]]);
  });
});
