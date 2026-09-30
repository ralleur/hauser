import { describe, expect, it } from 'vitest';
import { roomIdForArea, type DeviceConfig, type EntityCatalogItem } from './device-config.ts';
import { followHomeAssistant, parseHaFollowState, type HaFollowState } from './ha-follow.ts';

const rooms = [
  { id: 'flur', name: 'Flur' },
  { id: 'kuche', name: 'Küche' },
];
const empty: DeviceConfig = { version: 1, devices: {}, order: {}, groups: {} };
const DAY = 86_400_000;
const since = 10 * DAY;

function item(entityId: string, area: string | null, createdAt?: number): EntityCatalogItem {
  return { entityId, domain: entityId.split('.')[0] as EntityCatalogItem['domain'], name: entityId, area, ...(createdAt !== undefined ? { createdAt } : {}) };
}

function state(areas: Record<string, string>): HaFollowState {
  return { version: 1, since, areas };
}

describe('R43: Hauser folgt Home Assistant', () => {
  it('findet den Raum eines Bereichs über den Namen, auch mit Umlaut', () => {
    expect(roomIdForArea('Küche', rooms)).toBe('kuche');
    expect(roomIdForArea('küche ', rooms)).toBe('kuche');
    expect(roomIdForArea('Keller', rooms)).toBeNull();
    // Ältere Einrichtung schrieb `kueche`.
    expect(roomIdForArea('Küche', [{ id: 'kueche', name: 'Kochen' }])).toBe('kueche');
  });

  it('merkt sich beim ersten Lauf nur den Stand und zieht nichts', () => {
    const result = followHomeAssistant(empty, [item('light.a', 'Flur', 5 * DAY)], rooms, new Set(['light.a']), null, since);
    expect(result.configChanged).toBe(false);
    expect(result.stateChanged).toBe(true);
    expect(result.state).toEqual({ version: 1, since, areas: { 'light.a': 'Flur' } });
  });

  it('ein gezeigtes Gerät zieht mit, wenn sich sein Bereich in HA ändert', () => {
    const result = followHomeAssistant(empty, [item('light.a', 'Küche')], rooms, new Set(['light.a']), state({ 'light.a': 'Flur' }), since + DAY);
    expect(result.configChanged).toBe(true);
    expect(result.config.devices['light.a']).toEqual({ visible: true, roomId: 'kuche' });
    expect(result.config.order.kuche).toEqual(['light.a']);
  });

  it('ohne Änderung in HA bleibt eine Zuordnung von Hand stehen', () => {
    const manual: DeviceConfig = { ...empty, devices: { 'light.a': { visible: true, roomId: 'kuche' } } };
    const result = followHomeAssistant(manual, [item('light.a', 'Flur')], rooms, new Set(['light.a']), state({ 'light.a': 'Flur' }), since + DAY);
    expect(result.configChanged).toBe(false);
    expect(result.config).toBe(manual);
  });

  it('ein verstecktes Gerät bleibt versteckt, auch wenn es umzieht', () => {
    const hidden: DeviceConfig = { ...empty, devices: { 'light.a': { visible: false } } };
    const result = followHomeAssistant(hidden, [item('light.a', 'Küche')], rooms, new Set(), state({ 'light.a': 'Flur' }), since + DAY);
    expect(result.configChanged).toBe(false);
  });

  it('ein nach dem Stichtag angelegtes Licht erscheint im Raum seines Bereichs', () => {
    const result = followHomeAssistant(empty, [item('light.neu', 'Küche', since + DAY)], rooms, new Set(), state({}), since + 2 * DAY);
    expect(result.config.devices['light.neu']).toEqual({ visible: true, roomId: 'kuche' });
  });

  it('Altbestand, Sensoren, unbekannte Bereiche und Geräte ohne Datum erscheinen nicht von selbst', () => {
    const catalog = [
      item('light.alt', 'Küche', since - DAY),
      item('sensor.neu', 'Küche', since + DAY),
      item('light.keller', 'Keller', since + DAY),
      item('light.ohne_datum', 'Küche'),
      item('light.ohne_bereich', null, since + DAY),
    ];
    const result = followHomeAssistant(empty, catalog, rooms, new Set(), state({}), since + 2 * DAY);
    expect(result.configChanged).toBe(false);
  });

  it('ein neues Gerät, das jemand schon versteckt hat, bleibt versteckt', () => {
    const hidden: DeviceConfig = { ...empty, devices: { 'light.neu': { visible: false } } };
    const result = followHomeAssistant(hidden, [item('light.neu', 'Küche', since + DAY)], rooms, new Set(), state({}), since + 2 * DAY);
    expect(result.configChanged).toBe(false);
  });

  it('R56: ein neues Licht in einem neuen Bereich meldet den Bereich, statt ihn zu merken', () => {
    const catalog = [item('light.keller', ' Keller ', since + DAY), item('light.keller_2', 'Keller', since + DAY)];
    const first = followHomeAssistant(empty, catalog, rooms, new Set(), state({}), since + 2 * DAY);
    expect(first.newAreas).toEqual(['Keller']);
    expect(first.state.areas).toEqual({});
    // Steht der Raum, zieht das Licht im zweiten Lauf ein.
    const second = followHomeAssistant(empty, catalog, [...rooms, { id: 'keller', name: 'Keller' }], new Set(), first.state, since + 2 * DAY);
    expect(second.newAreas).toEqual([]);
    expect(second.config.devices['light.keller']).toEqual({ visible: true, roomId: 'keller' });
    expect(second.config.devices['light.keller_2']).toEqual({ visible: true, roomId: 'keller' });
  });

  it('R56: ein gezeigtes Gerät, das in einen neuen Bereich umzieht, meldet ihn ebenfalls', () => {
    const result = followHomeAssistant(empty, [item('light.a', 'Garten')], rooms, new Set(['light.a']), state({ 'light.a': 'Flur' }), since + DAY);
    expect(result.newAreas).toEqual(['Garten']);
    expect(result.state.areas['light.a']).toBe('Flur');
  });

  it('R56: ein bekannter Bereich ohne Raum wird nicht von selbst wieder ein Raum', () => {
    // „Garage" war schon bekannt; ihr Raum wurde in Hauser gelöscht.
    const result = followHomeAssistant(empty, [item('light.neu', 'Garage', since + DAY)], rooms, new Set(), state({ 'switch.tor': 'Garage' }), since + 2 * DAY);
    expect(result.newAreas).toEqual([]);
    expect(result.configChanged).toBe(false);
  });

  it('R56: Altbestand, Sensoren und Bereiche aus Leerzeichen melden keinen Raum', () => {
    const catalog = [item('light.alt', 'Keller', since - DAY), item('sensor.neu', 'Keller', since + DAY), item('light.leer', '   ', since + DAY)];
    const result = followHomeAssistant(empty, catalog, rooms, new Set(), state({}), since + 2 * DAY);
    expect(result.newAreas).toEqual([]);
  });

  it('verwirft kaputte gespeicherte Stände', () => {
    expect(parseHaFollowState(null)).toBeNull();
    expect(parseHaFollowState('{')).toBeNull();
    expect(parseHaFollowState('{"version":2,"since":1}')).toBeNull();
    expect(parseHaFollowState('{"version":1,"since":"gestern"}')).toBeNull();
    expect(parseHaFollowState('{"version":1,"since":5,"areas":{"light.a":"Flur","light.b":3}}'))
      .toEqual({ version: 1, since: 5, areas: { 'light.a': 'Flur' } });
  });
});
