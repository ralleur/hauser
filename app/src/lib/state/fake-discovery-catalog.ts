/* Side-effect-free catalog contract and FakeBackend defaults.
   Keep this module independent of storage and application runtime state so
   isolated runtimes can consume the same catalog truth without loading them. */

import type {
  AlarmValue, ButtonValue, CoverValue, FanValue, HumidifierValue, LockValue, MowerValue,
  NumberValue, SelectValue, VacuumValue, WaterHeaterValue,
} from '../adapter/types.ts';

export const MANAGED_DOMAINS = [
  'light', 'switch', 'sensor', 'binary_sensor', 'climate', 'media_player', 'cover', 'fan', 'input_boolean', 'vacuum', 'camera',
  'valve', 'lock', 'humidifier', 'water_heater', 'lawn_mower', 'alarm_control_panel', 'siren', 'remote',
  'number', 'input_number', 'select', 'input_select', 'button', 'input_button',
] as const;
export type ManagedDomain = (typeof MANAGED_DOMAINS)[number];

export interface EntityCatalogItem {
  entityId: string;
  domain: ManagedDomain;
  name: string;
  area?: string | null;
  unit?: string | null;
  deviceClass?: string | null;
  capabilities?: Partial<{
    dimmable: boolean;
    colorTemp: boolean;
    color: boolean;
    colorTempMin: number;
    colorTempMax: number;
  }>;
}

/* Startwert einer fan-Entität im Fake/Offline-Betrieb: Ventilatoren tragen
   mehr als on/off, und welche Fähigkeiten es sind, meldet sonst nur Home
   Assistant. Ohne diesen Seed bliebe das Ventilator-Overlay leer. */
export const FAKE_FAN_SEED: FanValue = {
  on: false,
  percentage: 0,
  presetMode: 'normal',
  oscillating: false,
  direction: 'forward',
  presetModes: ['normal', 'breeze', 'sleep', 'turbo'],
  supportsSpeed: true,
  supportsPreset: true,
  supportsOscillate: true,
  supportsDirection: true,
};

/* Startwerte der übrigen steuerbaren Domänen (R28), nach demselben Muster:
   ohne Seed wüsste das Fake-Backend nicht, was das Demo-Gerät kann. */
export const FAKE_COVER_SEED: CoverValue = {
  on: true, position: 100, tilt: 50, moving: null,
  supportsOpen: true, supportsClose: true, supportsStop: true, supportsPosition: true, supportsTilt: true,
};
export const FAKE_VALVE_SEED: CoverValue = {
  on: true, position: 100, tilt: 0, moving: null,
  supportsOpen: true, supportsClose: true, supportsStop: false, supportsPosition: true, supportsTilt: false,
};
export const FAKE_VACUUM_SEED: VacuumValue = {
  on: false, state: 'docked', fanSpeed: 'standard', battery: 87,
  fanSpeeds: ['quiet', 'standard', 'turbo', 'max'],
  supportsStart: true, supportsPause: true, supportsStop: true, supportsReturn: true, supportsLocate: true, supportsFanSpeed: true,
};
export const FAKE_LOCK_SEED: LockValue = { locked: true, state: 'locked', supportsOpen: true };
export const FAKE_HUMIDIFIER_SEED: HumidifierValue = {
  on: false, target: 50, mode: 'auto', current: 43, modes: ['auto', 'sleep', 'boost'],
  minHumidity: 30, maxHumidity: 70, supportsModes: true,
};
export const FAKE_WATER_HEATER_SEED: WaterHeaterValue = {
  on: true, target: 55, mode: 'eco', current: 52, modes: ['eco', 'electric', 'performance', 'off'],
  minTemp: 35, maxTemp: 70, supportsTarget: true, supportsModes: true, supportsOnOff: true,
};
export const FAKE_MOWER_SEED: MowerValue = {
  on: false, state: 'docked', supportsStart: true, supportsPause: true, supportsDock: true,
};
export const FAKE_ALARM_SEED: AlarmValue = {
  state: 'disarmed', codeFormat: null, codeArmRequired: false,
  supportsArmHome: true, supportsArmAway: true, supportsArmNight: true, supportsArmVacation: false, supportsArmCustom: false,
};
export const FAKE_NUMBER_SEED: NumberValue = { value: 21, min: 5, max: 30, step: 0.5, unit: '°C' };
export const FAKE_SELECT_SEED: SelectValue = { option: 'Normal', options: ['Normal', 'Party', 'Nacht', 'Urlaub'] };
export const FAKE_BUTTON_SEED: ButtonValue = { pressedAt: null };

/* Seed je Domäne für Fake/Offline: alles ohne eigenen Wert ist ein Schalter. */
export function fakeSeedFor(domain: ManagedDomain): unknown {
  switch (domain) {
    case 'fan': return { ...FAKE_FAN_SEED };
    case 'cover': return { ...FAKE_COVER_SEED };
    case 'valve': return { ...FAKE_VALVE_SEED };
    case 'vacuum': return { ...FAKE_VACUUM_SEED, fanSpeeds: [...FAKE_VACUUM_SEED.fanSpeeds] };
    case 'lock': return { ...FAKE_LOCK_SEED };
    case 'humidifier': return { ...FAKE_HUMIDIFIER_SEED, modes: [...FAKE_HUMIDIFIER_SEED.modes] };
    case 'water_heater': return { ...FAKE_WATER_HEATER_SEED, modes: [...FAKE_WATER_HEATER_SEED.modes] };
    case 'lawn_mower': return { ...FAKE_MOWER_SEED };
    case 'alarm_control_panel': return { ...FAKE_ALARM_SEED };
    case 'number': case 'input_number': return { ...FAKE_NUMBER_SEED };
    case 'select': case 'input_select': return { ...FAKE_SELECT_SEED, options: [...FAKE_SELECT_SEED.options] };
    case 'button': case 'input_button': return { ...FAKE_BUTTON_SEED };
    default: return { on: false };
  }
}

export const FAKE_DISCOVERY_CATALOG: EntityCatalogItem[] = [
  { entityId: 'cover.demo_rollo_wohnzimmer', domain: 'cover', name: 'Rollo Wohnzimmer', area: 'wohnzimmer' },
  { entityId: 'vacuum.demo_staubsauger', domain: 'vacuum', name: 'Staubsauger', area: 'flur' },
  { entityId: 'lock.demo_haustuer', domain: 'lock', name: 'Haustür', area: 'flur' },
  { entityId: 'humidifier.demo_befeuchter_schlafzimmer', domain: 'humidifier', name: 'Befeuchter', area: 'schlafzimmer' },
  { entityId: 'water_heater.demo_warmwasser', domain: 'water_heater', name: 'Warmwasser', area: 'buero' },
  { entityId: 'valve.demo_gartenwasser', domain: 'valve', name: 'Gartenwasser', area: 'buero' },
  { entityId: 'lawn_mower.demo_maehroboter', domain: 'lawn_mower', name: 'Mähroboter', area: 'buero' },
  { entityId: 'alarm_control_panel.demo_alarmanlage', domain: 'alarm_control_panel', name: 'Alarmanlage', area: 'flur' },
  { entityId: 'input_number.demo_nachtabsenkung', domain: 'input_number', name: 'Nachtabsenkung', area: 'schlafzimmer' },
  { entityId: 'input_select.demo_hausmodus', domain: 'input_select', name: 'Hausmodus', area: 'wohnzimmer' },
  { entityId: 'input_button.demo_klingel', domain: 'input_button', name: 'Klingel stumm', area: 'flur' },
  {
    entityId: 'fan.demo_ventilator_wohnzimmer',
    domain: 'fan',
    name: 'Ventilator Wohnzimmer',
    area: 'wohnzimmer',
  },
  {
    entityId: 'switch.steckdose_wohnzimmer_regal',
    domain: 'switch',
    name: 'Regal Steckdose',
    area: 'wohnzimmer',
  },
  {
    entityId: 'light.flur_deckenlicht',
    domain: 'light',
    name: 'Deckenlicht Flur',
    area: 'flur',
    capabilities: { dimmable: false, colorTemp: false, color: false },
  },
  {
    // Tunable-White mit gemeldeter Kelvin-Range (B-16B): die Farbtemp-Skala
    // der Detail-Ebene folgt min/max des Geräts statt der fixen UI-Range.
    entityId: 'light.demo_stehlampe',
    domain: 'light',
    name: 'Stehlampe',
    area: 'schlafzimmer',
    capabilities: { dimmable: true, colorTemp: true, color: false, colorTempMin: 2700, colorTempMax: 5000 },
  },
  {
    entityId: 'sensor.demo_aussentemperatur',
    domain: 'sensor',
    name: 'Außentemperatur',
    area: 'wohnzimmer',
    unit: '°C',
    deviceClass: 'temperature',
  },
  {
    entityId: 'climate.demo_buero',
    domain: 'climate',
    name: 'Heizung Büro',
    area: 'buero',
  },
];
