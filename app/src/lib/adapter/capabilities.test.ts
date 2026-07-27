import { describe, expect, it } from 'vitest';
import { lightCapabilitiesFromHaAttributes, catalogItemFromHaState } from './capabilities.ts';

describe('light capability detection from HA attributes', () => {
  it('leitet dimmbar, Farbe, Farbtemperatur und Kelvin-Grenzen aus supported_color_modes ab', () => {
    expect(lightCapabilitiesFromHaAttributes({
      supported_color_modes: ['brightness', 'color_temp', 'hs'],
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6500,
    })).toEqual({ dimmable: true, colorTemp: true, color: true, colorTempMin: 2000, colorTempMax: 6500 });
  });

  it('onoff-only Licht bleibt ohne Detail-Controls', () => {
    expect(lightCapabilitiesFromHaAttributes({ supported_color_modes: ['onoff'] }))
      .toEqual({ dimmable: false, colorTemp: false, color: false });
  });

  it('brightness-Attribut ist Fallback, wenn supported_color_modes fehlt', () => {
    const capabilities = lightCapabilitiesFromHaAttributes({ brightness: 128 });
    expect(capabilities && capabilities.dimmable).toBe(true);
  });
});

describe('HA state catalog projection', () => {
  it('nimmt verwaltete Domänen auf (light/switch/sensor …), filtert den Rest', () => {
    const states = [
      { entity_id: 'light.kueche', state: 'on', attributes: { friendly_name: 'Küche', supported_color_modes: ['brightness'] } },
      { entity_id: 'switch.regal', state: 'off', attributes: { friendly_name: 'Regal' } },
      { entity_id: 'sensor.temp', state: '21', attributes: { friendly_name: 'Temp', unit_of_measurement: '°C', device_class: 'temperature' } },
      { entity_id: 'automation.morgens', state: 'on', attributes: { friendly_name: 'Automation' } },
    ];
    expect(states.map(catalogItemFromHaState).filter(Boolean)).toEqual([
      { entityId: 'light.kueche', domain: 'light', name: 'Küche', area: null, capabilities: { dimmable: true, colorTemp: false, color: false } },
      { entityId: 'switch.regal', domain: 'switch', name: 'Regal', area: null, capabilities: {} },
      { entityId: 'sensor.temp', domain: 'sensor', name: 'Temp', area: null, capabilities: {}, unit: '°C', deviceClass: 'temperature' },
    ]);
  });

  it('binary_sensor trägt device_class auch ohne Einheit', () => {
    const item = catalogItemFromHaState({
      entity_id: 'binary_sensor.fenster_bad', state: 'off',
      attributes: { friendly_name: 'Fenster Bad', device_class: 'window' },
    });
    expect(item).toMatchObject({ domain: 'binary_sensor', unit: null, deviceClass: 'window' });
  });
});
