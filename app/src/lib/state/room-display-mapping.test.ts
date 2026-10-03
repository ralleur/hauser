import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityCatalogItem } from './fake-discovery-catalog.ts';

const fixtures = vi.hoisted(() => ({
  rooms: [] as { id: string; name: string; lights: { entityId: string }[] }[],
  catalog: [] as EntityCatalogItem[],
}));
vi.mock('./app.svelte.ts', () => ({ appState: fixtures }));
vi.mock('./device-manager.svelte.ts', () => ({ deviceManager: fixtures }));
vi.mock('./commands.ts', () => ({ setRoomContactResolver() {}, setRoomSensorResolver() {} }));
vi.mock('./entities.ts', () => ({ presenceEntityIds: () => [], windowEntityIds: () => [], setClimateHiddenResolver() {} }));
vi.mock('./shared-config.ts', () => ({ sharedStorage: { getItem: () => null } }));

import { autoSensorId, roomContactCandidates } from './room-display-config.svelte.ts';

beforeEach(() => { fixtures.rooms = []; fixtures.catalog = []; });

describe('Automatische Raumzuordnung', () => {
  it.each(['kuche', 'kueche'])('behält Sensoren nach Umbenennen der Küche mit ID %s', (id) => {
    fixtures.rooms = [{ id, name: 'Küche', lights: [] }];
    fixtures.catalog = [
      { entityId: 'sensor.kueche_feuchte', name: 'Feuchte', domain: 'sensor', deviceClass: 'humidity', area: 'Küche' },
      { entityId: 'sensor.kueche_co2', name: 'CO₂', domain: 'sensor', deviceClass: 'carbon_dioxide', area: 'Küche' },
    ];
    expect(autoSensorId(id, 'humidity')).toBe('sensor.kueche_feuchte');
    fixtures.rooms[0].name = 'Kochstudio';
    expect(autoSensorId(id, 'humidity')).toBe('sensor.kueche_feuchte');
    expect(autoSensorId(id, 'co2')).toBe('sensor.kueche_co2');
  });

  it('trennt nichtlateinische Bereichsnamen und ignoriert unbekannte Bereiche', () => {
    fixtures.rooms = [{ id: 'room_a', name: '厨房', lights: [] }, { id: 'room_b', name: '卧室', lights: [] }];
    fixtures.catalog = [
      { entityId: 'binary_sensor.kitchen', name: 'Kitchen', domain: 'binary_sensor', deviceClass: 'window', area: '厨房' },
      { entityId: 'binary_sensor.bedroom', name: 'Bedroom', domain: 'binary_sensor', deviceClass: 'window', area: '卧室' },
      { entityId: 'binary_sensor.unknown', name: 'Unknown', domain: 'binary_sensor', deviceClass: 'window', area: '浴室' },
    ];
    expect(roomContactCandidates('room_a', 'window').map((x) => x.entityId)).toEqual(['binary_sensor.kitchen']);
    expect(roomContactCandidates('room_b', 'window').map((x) => x.entityId)).toEqual(['binary_sensor.bedroom']);
  });

  it('bevorzugt den exakten Namen gegenüber einer gleichlautenden fremden ID', () => {
    fixtures.rooms = [{ id: 'kuche', name: 'Büro', lights: [] }, { id: 'room_b', name: 'Küche', lights: [] }];
    fixtures.catalog = [{ entityId: 'sensor.humidity', name: 'Humidity', domain: 'sensor', deviceClass: 'humidity', area: 'Küche' }];
    expect(autoSensorId('kuche', 'humidity')).toBe('');
    expect(autoSensorId('room_b', 'humidity')).toBe('sensor.humidity');
  });
});
