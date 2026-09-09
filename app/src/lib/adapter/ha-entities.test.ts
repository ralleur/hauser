import { describe, it, expect } from 'vitest';
import {
  applyEntitiesDiff,
  haToLight,
  haToClimate,
  haToMedia,
  haToSun,
  haToSensor,
  haToLaundryState,
  haToFan,
  haToCover,
  haToVacuum,
  haToLock,
  haToHumidifier,
  haToWaterHeater,
  haToAlarm,
  haToNumber,
  haToSelect,
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
    expect(haToSun({ state: 'above_horizon', attributes: {} })).toEqual<SunValue>({ day: true, elevation: null });
    expect(haToSun({ state: 'below_horizon', attributes: {} })).toEqual<SunValue>({ day: false, elevation: null });
  });
  it('Sonnenhöhe wird übernommen, sonst null (Paket 4)', () => {
    expect(haToSun({ state: 'above_horizon', attributes: { elevation: 1.4 } }).elevation).toBe(1.4);
    expect(haToSun({ state: 'below_horizon', attributes: { elevation: '-3' } }).elevation).toBeNull();
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

describe('haToFan', () => {
  it('liest Stufe, Preset, Oszillation und Richtung aus den Attributen', () => {
    expect(haToFan({
      state: 'on',
      attributes: {
        supported_features: 15,
        percentage: 66.6,
        percentage_step: 33.3,
        preset_mode: 'sleep',
        preset_modes: ['normal', 'sleep', 7],
        oscillating: true,
        direction: 'reverse',
      },
    })).toEqual({
      on: true,
      percentage: 67,
      presetMode: 'sleep',
      oscillating: true,
      direction: 'reverse',
      presetModes: ['normal', 'sleep'],
      supportsSpeed: true,
      supportsPreset: true,
      supportsOscillate: true,
      supportsDirection: true,
    });
  });

  it('ohne supported_features zählt die Anwesenheit des Attributs', () => {
    expect(haToFan({ state: 'off', attributes: { oscillating: false } })).toMatchObject({
      on: false,
      percentage: 0,
      supportsSpeed: false,
      supportsPreset: false,
      supportsOscillate: true,
      supportsDirection: false,
    });
  });

  it('ein reiner An/Aus-Ventilator meldet keine Fähigkeit', () => {
    expect(haToFan({ state: 'on', attributes: {} })).toMatchObject({
      on: true,
      presetModes: [],
      supportsSpeed: false,
      supportsPreset: false,
      supportsOscillate: false,
      supportsDirection: false,
    });
  });
});

describe('R28: weitere steuerbare Domänen', () => {
  it('cover: Position, Neigung und Fähigkeiten aus der Bitmaske', () => {
    expect(haToCover({ state: 'opening', attributes: { supported_features: 143, current_position: 40.4, current_tilt_position: 10 } }))
      .toEqual({
        on: true, position: 40, tilt: 10, moving: 'opening',
        supportsOpen: true, supportsClose: true, supportsStop: true, supportsPosition: true, supportsTilt: true,
      });
    // Ohne Maske: Auf/Zu gelten als gegeben, Position nur mit Attribut.
    expect(haToCover({ state: 'closed', attributes: {} })).toMatchObject({ on: false, position: 0, supportsOpen: true, supportsPosition: false, supportsTilt: false });
  });
  it('vacuum: Zustand, Akku, Saugstufen', () => {
    expect(haToVacuum({ state: 'cleaning', attributes: { supported_features: 8252, battery_level: 87, fan_speed: 'turbo', fan_speed_list: ['quiet', 'turbo'] } }))
      .toMatchObject({ on: true, state: 'cleaning', battery: 87, fanSpeed: 'turbo', fanSpeeds: ['quiet', 'turbo'], supportsStart: true, supportsPause: true, supportsReturn: true, supportsFanSpeed: true, supportsLocate: false });
  });
  it('lock: locking zählt als verriegelt, OPEN-Feature = Türöffner', () => {
    expect(haToLock({ state: 'locking', attributes: { supported_features: 1 } })).toEqual({ locked: true, state: 'locking', supportsOpen: true });
    expect(haToLock({ state: 'jammed', attributes: {} })).toEqual({ locked: false, state: 'jammed', supportsOpen: false });
  });
  it('humidifier und water_heater tragen Grenzen und Modi vom Gerät', () => {
    expect(haToHumidifier({ state: 'on', attributes: { humidity: 55, current_humidity: 41, min_humidity: 30, max_humidity: 80, available_modes: ['auto', 'sleep'], mode: 'auto' } }))
      .toEqual({ on: true, target: 55, mode: 'auto', current: 41, modes: ['auto', 'sleep'], minHumidity: 30, maxHumidity: 80, supportsModes: true });
    expect(haToWaterHeater({ state: 'eco', attributes: { supported_features: 11, temperature: 55, current_temperature: 52, min_temp: 35, max_temp: 70, operation_list: ['eco', 'off'], operation_mode: 'eco' } }))
      .toEqual({ on: true, target: 55, mode: 'eco', current: 52, modes: ['eco', 'off'], minTemp: 35, maxTemp: 70, supportsTarget: true, supportsModes: true, supportsOnOff: true });
  });
  it('alarm: Scharfschaltarten und Codepflicht', () => {
    expect(haToAlarm({ state: 'armed_home', attributes: { supported_features: 7, code_format: 'number', code_arm_required: false } }))
      .toEqual({ state: 'armed_home', codeFormat: 'number', codeArmRequired: false, supportsArmHome: true, supportsArmAway: true, supportsArmNight: true, supportsArmVacation: false, supportsArmCustom: false });
  });
  it('number und select: Wert mit Grenzen, Option aus Liste', () => {
    expect(haToNumber({ state: '21.5', attributes: { min: 5, max: 30, step: 0.5, unit_of_measurement: '°C' } })).toEqual({ value: 21.5, min: 5, max: 30, step: 0.5, unit: '°C' });
    expect(haToNumber({ state: 'unknown', attributes: {} })).toEqual({ value: null, min: 0, max: 100, step: 1, unit: null });
    expect(haToSelect({ state: 'Party', attributes: { options: ['Normal', 'Party'] } })).toEqual({ option: 'Party', options: ['Normal', 'Party'] });
  });
  it('climate: Zusatzmodi und Grenzen nur, wenn das Thermostat sie meldet', () => {
    expect(haToClimate({ state: 'heat_cool', attributes: { temperature: 21, hvac_modes: ['off', 'heat_cool', 'bogus'], fan_modes: ['low', 'high'], fan_mode: 'low', min_temp: 7, max_temp: 35 } }))
      .toEqual({ target: 21, hvac: 'heat_cool', hvacModes: ['off', 'heat_cool'], fanModes: ['low', 'high'], fanMode: 'low', minTemp: 7, maxTemp: 35 });
    expect(haToClimate({ state: 'heat', attributes: { temperature: 20 } })).toEqual({ target: 20, hvac: 'heat' });
  });
  it('haToValue routet die neuen Domänen', () => {
    expect(haToValue('lock.tuer', { state: 'locked', attributes: {} })).toEqual({ locked: true, state: 'locked', supportsOpen: false });
    expect(haToValue('siren.x', { state: 'on', attributes: {} })).toEqual({ on: true });
    expect(haToValue('input_button.x', { state: '2026-09-07T10:00:00+00:00', attributes: {} })).toEqual({ pressedAt: Date.parse('2026-09-07T10:00:00+00:00') });
    expect(haToValue('lawn_mower.x', { state: 'mowing', attributes: { supported_features: 7 } })).toEqual({ on: true, state: 'mowing', supportsStart: true, supportsPause: true, supportsDock: true });
  });
});

describe('haToValue (Domänen-Routing)', () => {
  it('routet nach entity_id-Präfix', () => {
    expect(haToValue('light.x', { state: 'on', attributes: { brightness: 255 } })).toEqual({ on: true, brightness: 100 });
    expect(haToValue('climate.x', { state: 'heat', attributes: { temperature: 20 } })).toEqual({ target: 20, hvac: 'heat' });
    expect((haToValue('media_player.x', { state: 'playing', attributes: {} }) as MediaValue).playing).toBe(true);
  });
  it('read-only-Domänen: sun.sun + sensor.* werden übersetzt', () => {
    expect(haToValue('sun.sun', { state: 'above_horizon', attributes: {} })).toEqual<SunValue>({ day: true, elevation: null });
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
  it('binary_sensor → on/off-Shape, cover → Rollo-Shape mit on-Feld', () => {
    expect(haToValue('binary_sensor.fenster', { state: 'off', attributes: {} })).toEqual({ on: false });
    expect(haToValue('cover.x', { state: 'open', attributes: {} })).toMatchObject({ on: true, moving: null });
    expect(haToValue('cover.x', { state: 'opening', attributes: {} })).toMatchObject({ on: true, moving: 'opening' });
    expect(haToValue('cover.x', { state: 'closed', attributes: {} })).toMatchObject({ on: false, position: 0 });
  });
  it('fan → Ventilator-Shape statt Schalter', () => {
    expect(haToValue('fan.x', { state: 'on', attributes: { supported_features: 3, percentage: 40 } }))
      .toMatchObject({ on: true, percentage: 40, supportsSpeed: true, supportsOscillate: true });
  });
  it('ungemappte Domäne → undefined', () => {
    expect(haToValue('scene.x', { state: 'running', attributes: {} })).toBeUndefined();
    expect(haToValue('automation.x', { state: 'on', attributes: {} })).toBeUndefined();
  });
});
