import { describe, expect, it } from 'vitest';
import type { HomeAccessory } from '../native/bridge.ts';
import { platformEntities, platformEntityId, platformValue, platformWrites } from './platform-entities.ts';

function lamp(): HomeAccessory {
  return {
    id: 'A1', name: 'Stehlampe', roomId: 'R1', reachable: true, category: 'lightbulb',
    services: [
      { id: 'S-INFO', type: 'accessoryInformation', name: 'Info', characteristics: [] },
      {
        id: '2F1C-AB', type: 'lightbulb', name: 'Stehlampe',
        characteristics: [
          { id: 'c-power', type: 'power', value: true, writable: true },
          { id: 'c-bri', type: 'brightness', value: 40, writable: true, min: 0, max: 100, step: 1 },
          { id: 'c-hue', type: 'hue', value: 120, writable: true },
          { id: 'c-sat', type: 'saturation', value: 100, writable: true },
        ],
      },
    ],
  };
}

describe('Plattform-Entitäten', () => {
  it('leitet Entity-IDs deterministisch aus Dienst-IDs ab und überspringt Unbekanntes', () => {
    const entities = platformEntities([lamp()]);
    expect(entities.map((e) => e.entityId)).toEqual(['light.hk_2f1cab']);
    expect(platformEntityId('climate', 'AB-cd')).toBe('climate.hk_abcd');
  });

  it('übersetzt ein Licht mit Farbe in Hausers Lichtwert', () => {
    const [entity] = platformEntities([lamp()]);
    expect(platformValue(entity)).toEqual({ on: true, brightness: 40, color: '#00ff00' });
  });

  it('übersetzt Befehle in Merkmal-Schreibvorgänge', () => {
    const [entity] = platformEntities([lamp()]);
    expect(platformWrites(entity, 'light', 'turn_on', { brightness_pct: 70 })).toEqual([
      { characteristicId: 'c-bri', value: 70 },
      { characteristicId: 'c-power', value: true },
    ]);
    expect(platformWrites(entity, 'light', 'toggle', {})).toEqual([{ characteristicId: 'c-power', value: false }]);
    expect(platformWrites(entity, 'light', 'turn_on', { rgb_color: [255, 0, 0] })).toEqual([
      { characteristicId: 'c-hue', value: 0 },
      { characteristicId: 'c-sat', value: 100 },
      { characteristicId: 'c-power', value: true },
    ]);
  });

  it('bildet Thermostat, Kontakt und Temperatur ab', () => {
    const accessory: HomeAccessory = {
      id: 'A2', name: 'Bad', roomId: null, reachable: true, category: 'thermostat',
      services: [
        { id: 'T1', type: 'thermostat', name: 'Heizung', characteristics: [
          { id: 't-cur', type: 'currentTemperature', value: 21.5, writable: false },
          { id: 't-tgt', type: 'targetTemperature', value: 23, writable: true },
          { id: 't-mode', type: 'targetHeatingCoolingState', value: 1, writable: true },
        ] },
        { id: 'C1', type: 'contactSensor', name: 'Fenster', characteristics: [{ id: 'c-c', type: 'contactState', value: 1, writable: false }] },
        { id: 'X1', type: 'temperatureSensor', name: 'Temp', characteristics: [{ id: 'x-t', type: 'currentTemperature', value: 19.25, writable: false }] },
      ],
    };
    const [climate, contact, sensor] = platformEntities([accessory]);
    expect(platformValue(climate)).toEqual({ target: 23, hvac: 'heat', current: 21.5 });
    expect(platformValue(contact)).toEqual({ on: true });
    expect(platformValue(sensor)).toEqual({ value: 19.25, unit: '°C' });
    expect(platformWrites(climate, 'climate', 'set_temperature', { temperature: 21 })).toEqual([{ characteristicId: 't-tgt', value: 21 }]);
    expect(platformWrites(climate, 'climate', 'set_hvac_mode', { hvac_mode: 'off' })).toEqual([{ characteristicId: 't-mode', value: 0 }]);
  });
});
