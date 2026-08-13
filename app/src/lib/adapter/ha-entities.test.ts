import { describe, it, expect } from 'vitest';
import {
  applyEntitiesDiff,
  haToLight,
  haToClimate,
  haToMedia,
  haToSun,
  haToSensor,
  haToLaundryState,
  haToValue,
  miredToKelvin,
  rgbToHex,
  type RawEntity,
} from './ha-entities.ts';
import type { LightValue, ClimateValue, MediaValue, SunValue, SensorValue } from './types.ts';

describe('applyEntitiesDiff (subscribe_entities Kompakt-Format)', () => {
  it('a = added: setzt vollen Zustand', () => {
    const cache = new Map<string, RawEntity>();
    const changed = applyEntitiesDiff(cache, {
      a: { 'light.x': { s: 'on', a: { brightness: 128 } } },
    });
    expect(changed).toEqual(['light.x']);
    expect(cache.get('light.x')).toEqual({ state: 'on', attributes: { brightness: 128 } });
  });

  it('übernimmt `lc` als Millisekunden-Zeitbasis und hält sie bei Attribut-Updates', () => {
    const cache = new Map<string, RawEntity>();
    applyEntitiesDiff(cache, {
      a: { 'input_boolean.waschmaschine_laeuft': { s: 'on', a: {}, lc: 1_784_888_380.25 } },
    });
    expect(cache.get('input_boolean.waschmaschine_laeuft')?.changedAt).toBe(1_784_888_380_250);
    applyEntitiesDiff(cache, {
      c: { 'input_boolean.waschmaschine_laeuft': { '+': { a: { friendly_name: 'Waschmaschine' } } } },
    });
    expect(cache.get('input_boolean.waschmaschine_laeuft')?.changedAt).toBe(1_784_888_380_250);
    expect(haToValue('input_boolean.waschmaschine_laeuft', cache.get('input_boolean.waschmaschine_laeuft')!))
      .toEqual({ on: true, changedAt: 1_784_888_380_250 });
  });

  it('c = changed: + überschreibt state/attrs, - entfernt attr-keys (Array)', () => {
    const cache = new Map<string, RawEntity>([
      ['light.x', { state: 'on', attributes: { brightness: 128, color_temp: 300 } }],
    ]);
    const changed = applyEntitiesDiff(cache, {
      c: { 'light.x': { '+': { s: 'off' }, '-': { a: ['brightness', 'color_temp'] } } },
    });
    expect(changed).toEqual(['light.x']);
    expect(cache.get('light.x')).toEqual({ state: 'off', attributes: {} });
  });

  it('c = changed: mergt neue Attribute in bestehende', () => {
    const cache = new Map<string, RawEntity>([
      ['climate.x', { state: 'heat', attributes: { temperature: 20, current_temperature: 21 } }],
    ]);
    applyEntitiesDiff(cache, { c: { 'climate.x': { '+': { a: { temperature: 22 } } } } });
    expect(cache.get('climate.x')).toEqual({
      state: 'heat',
      attributes: { temperature: 22, current_temperature: 21 },
    });
  });

  it('r = removed: löscht die Entität (Dict-Form)', () => {
    const cache = new Map<string, RawEntity>([['light.x', { state: 'on', attributes: {} }]]);
    const changed = applyEntitiesDiff(cache, { r: { 'light.x': null } });
    expect(changed).toEqual(['light.x']);
    expect(cache.has('light.x')).toBe(false);
  });
});

describe('haToLight', () => {
  it('brightness 0–255 → 0–100 %', () => {
    expect(haToLight({ state: 'on', attributes: { brightness: 255 } })).toEqual<LightValue>({ on: true, brightness: 100 });
    expect(haToLight({ state: 'on', attributes: { brightness: 128 } }).brightness).toBe(50);
  });
  it('aus ohne brightness-Attribut → hält vorherigen Wert (Slider springt nicht auf 0)', () => {
    expect(haToLight({ state: 'off', attributes: {} }, { brightness: 75 })).toEqual<LightValue>({ on: false, brightness: 75 });
  });
  it('color_temp_kelvin → colorTemp (Kelvin bevorzugt)', () => {
    expect(haToLight({ state: 'on', attributes: { brightness: 255, color_temp_kelvin: 3000, color_mode: 'color_temp' } }))
      .toEqual<LightValue>({ on: true, brightness: 100, colorTemp: 3000, color: null });
  });
  it('nur Mireds vorhanden → wird zu Kelvin umgerechnet', () => {
    expect(haToLight({ state: 'on', attributes: { brightness: 255, color_temp: 370, color_mode: 'color_temp' } }).colorTemp)
      .toBe(miredToKelvin(370));
  });
  it('Farbmodus (hs/rgb) → color als Hex', () => {
    expect(haToLight({ state: 'on', attributes: { brightness: 255, color_mode: 'hs', rgb_color: [255, 160, 0] } }).color)
      .toBe('#ffa000');
  });
  it('aus ohne Attribute → hält vorherige Farbe/Temperatur', () => {
    const v = haToLight({ state: 'off', attributes: {} }, { brightness: 40, colorTemp: 2700, color: '#ff0000' });
    expect(v).toEqual<LightValue>({ on: false, brightness: 40, colorTemp: 2700, color: '#ff0000' });
  });
});

describe('Farb-Helfer', () => {
  it('miredToKelvin: 250 mired → 4000 K', () => {
    expect(miredToKelvin(250)).toBe(4000);
  });
  it('rgbToHex: clamped, 2-stellig', () => {
    expect(rgbToHex([255, 0, 16])).toBe('#ff0010');
    expect(rgbToHex([300, -5, 128])).toBe('#ff0080');
  });
});

describe('haToClimate', () => {
  it('state → hvac, temperature → target', () => {
    expect(haToClimate({ state: 'heat', attributes: { temperature: 21 } })).toEqual<ClimateValue>({ target: 21, hvac: 'heat' });
    expect(haToClimate({ state: 'off', attributes: { temperature: 17 } }).hvac).toBe('off');
  });
  it('unbekannter state → off', () => {
    expect(haToClimate({ state: 'unavailable', attributes: {} }).hvac).toBe('off');
  });
  it('current_temperature → current (nur wenn numerisch)', () => {
    expect(haToClimate({ state: 'heat', attributes: { temperature: 21, current_temperature: 22.4 } }))
      .toEqual<ClimateValue>({ target: 21, hvac: 'heat', current: 22.4 });
    // fehlend/nicht-numerisch → current bleibt weg (Fallback greift in der UI)
    expect(haToClimate({ state: 'heat', attributes: { temperature: 21 } }).current).toBeUndefined();
    expect(haToClimate({ state: 'heat', attributes: { temperature: 21, current_temperature: 'x' } }).current).toBeUndefined();
  });
});

describe('haToMedia', () => {
  it('playing/volume/metadaten', () => {
    const v = haToMedia({
      state: 'playing',
      attributes: { volume_level: 0.45, media_title: 'Weightless', media_artist: 'Marconi Union', media_duration: 485, source: 'Spotify' },
    });
    expect(v).toEqual<MediaValue>({
      playing: true, volume: 45, source: 'Spotify', available: true,
      track: 'Weightless', artist: 'Marconi Union', duration: 485,
    });
  });
  it('unavailable → available:false', () => {
    expect(haToMedia({ state: 'unavailable', attributes: {} }).available).toBe(false);
  });
  it('volume fehlt → hält vorherigen Wert', () => {
    expect(haToMedia({ state: 'off', attributes: {} }, 30).volume).toBe(30);
  });
});

describe('haToSun', () => {
  it('above_horizon → day:true, sonst false', () => {
    expect(haToSun({ state: 'above_horizon', attributes: {} })).toEqual<SunValue>({ day: true });
    expect(haToSun({ state: 'below_horizon', attributes: {} })).toEqual<SunValue>({ day: false });
  });
});

describe('haToSensor', () => {
  it('numerischer state + Einheit', () => {
    expect(haToSensor({ state: '3.24', attributes: { unit_of_measurement: 'kW' } }))
      .toEqual<SensorValue>({ value: 3.24, unit: 'kW' });
  });
  it('unavailable/unknown/leer/nicht-numerisch → value null', () => {
    expect(haToSensor({ state: 'unavailable', attributes: {} }).value).toBeNull();
    expect(haToSensor({ state: 'unknown', attributes: {} }).value).toBeNull();
    expect(haToSensor({ state: '', attributes: {} }).value).toBeNull();
    expect(haToSensor({ state: 'foo', attributes: {} }).value).toBeNull();
  });
  it('fehlende Einheit → unit null', () => {
    expect(haToSensor({ state: '900', attributes: {} })).toEqual<SensorValue>({ value: 900, unit: null });
  });
});

describe('haToLaundryState', () => {
  it.each([
    ['input_select.fixture_laundry', 'running'],
    ['select.fixture_laundry', 'done'],
    ['sensor.fixture_laundry', 'drying'],
    ['binary_sensor.fixture_laundry', 'unknown'],
    ['input_boolean.fixture_laundry', 'unavailable'],
  ])('preserves the raw HA state for %s', (_entityId, state) => {
    expect(haToLaundryState({ state, attributes: {}, changedAt: 1_784_888_380_250 }))
      .toEqual({ state, changedAt: 1_784_888_380_250 });
  });
});

describe('haToValue (Domänen-Routing)', () => {
  it('routet nach entity_id-Präfix', () => {
    expect(haToValue('light.x', { state: 'on', attributes: { brightness: 255 } })).toEqual({ on: true, brightness: 100 });
    expect(haToValue('climate.x', { state: 'heat', attributes: { temperature: 20 } })).toEqual({ target: 20, hvac: 'heat' });
    expect((haToValue('media_player.x', { state: 'playing', attributes: {} }) as MediaValue).playing).toBe(true);
  });
  it('read-only-Domänen: sun.sun + sensor.* werden übersetzt', () => {
    expect(haToValue('sun.sun', { state: 'above_horizon', attributes: {} })).toEqual<SunValue>({ day: true });
    expect(haToValue('sensor.pv', { state: '2.1', attributes: { unit_of_measurement: 'kW' } }))
      .toEqual<SensorValue>({ value: 2.1, unit: 'kW' });
  });
  it('Kamera liefert Verfügbarkeit und signierten Proxy-Pfad', () => {
    expect(haToValue('camera.balkon', {
      state: 'streaming',
      attributes: { entity_picture: '/api/camera_proxy/camera.balkon?token=test' },
    })).toEqual({
      available: true,
      entityPicture: '/api/camera_proxy/camera.balkon?token=test',
    });
  });
  it('schaltbare Zusatz-Domänen: fan/cover/binary_sensor → on/off-Shape', () => {
    expect(haToValue('fan.x', { state: 'on', attributes: {} })).toEqual({ on: true });
    expect(haToValue('binary_sensor.fenster', { state: 'off', attributes: {} })).toEqual({ on: false });
    expect(haToValue('cover.x', { state: 'open', attributes: {} })).toEqual({ on: true });
    expect(haToValue('cover.x', { state: 'opening', attributes: {} })).toEqual({ on: true });
    expect(haToValue('cover.x', { state: 'closed', attributes: {} })).toEqual({ on: false });
  });
  it('ungemappte Domäne → undefined', () => {
    expect(haToValue('select.x', { state: 'running', attributes: {} })).toBeUndefined();
    expect(haToValue('automation.x', { state: 'on', attributes: {} })).toBeUndefined();
  });
});
