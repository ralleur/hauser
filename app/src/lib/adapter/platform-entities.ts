/* Plattform-Weg (Plan 21, Stufe 3): Übersetzung zwischen dem neutralen
   Zuhause-Schnappschuss (Apple Home / Google Home) und Hausers HA-förmigem
   Entity-Modell. Reine Funktionen; die App-Seite (hauser-app) leitet die
   Entity-IDs nach derselben Regel ab, damit Haushaltskonfiguration und
   Live-Zustand zusammenpassen: `<domain>.hk_<Dienst-ID ohne Bindestriche>`. */
import type { HomeAccessory, HomeCharacteristic, HomeService } from '../native/bridge.ts';
import type { ClimateValue, CoverValue, FanValue, LightValue, LockValue, SensorValue, SwitchValue } from './types.ts';

export type PlatformDomain = 'light' | 'switch' | 'climate' | 'sensor' | 'binary_sensor' | 'cover' | 'lock' | 'fan';

const SERVICE_DOMAIN: Record<string, PlatformDomain> = {
  lightbulb: 'light',
  switch: 'switch',
  outlet: 'switch',
  thermostat: 'climate',
  heaterCooler: 'climate',
  temperatureSensor: 'sensor',
  humiditySensor: 'sensor',
  contactSensor: 'binary_sensor',
  motionSensor: 'binary_sensor',
  occupancySensor: 'binary_sensor',
  windowCovering: 'cover',
  window: 'cover',
  door: 'cover',
  garageDoorOpener: 'cover',
  lockMechanism: 'lock',
  fan: 'fan',
  fanV2: 'fan',
};

export function platformDomainFor(serviceType: string): PlatformDomain | null {
  return SERVICE_DOMAIN[serviceType] ?? null;
}

export function platformEntityId(domain: PlatformDomain, serviceId: string): string {
  return `${domain}.hk_${serviceId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

export interface PlatformEntity {
  entityId: string;
  domain: PlatformDomain;
  accessory: HomeAccessory;
  service: HomeService;
}

export function platformEntities(accessories: readonly HomeAccessory[]): PlatformEntity[] {
  const out: PlatformEntity[] = [];
  for (const accessory of accessories) {
    for (const service of accessory.services) {
      const domain = platformDomainFor(service.type);
      if (!domain) continue;
      out.push({ entityId: platformEntityId(domain, service.id), domain, accessory, service });
    }
  }
  return out;
}

function ch(service: HomeService, type: string): HomeCharacteristic | undefined {
  return service.characteristics.find((c) => c.type === type);
}
function num(service: HomeService, type: string): number | null {
  const value = ch(service, type)?.value;
  return typeof value === 'number' ? value : null;
}
function bool(service: HomeService, type: string): boolean {
  const value = ch(service, type)?.value;
  return value === true || value === 1;
}

function hsvToHex(h: number, s: number, v = 100): string {
  const c = (v / 100) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v / 100 - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexToHs(hex: string): { h: number; s: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h: Math.round(h), s: Math.round(max === 0 ? 0 : (d / max) * 100) };
}

/** Wert eines Dienstes in Hausers Entity-Form. */
export function platformValue(entity: PlatformEntity): unknown {
  const { service, domain } = entity;
  switch (domain) {
    case 'light': {
      const hue = num(service, 'hue');
      const sat = num(service, 'saturation');
      const mired = num(service, 'colorTemperature');
      const value: LightValue = {
        on: bool(service, 'power'),
        brightness: num(service, 'brightness') ?? (bool(service, 'power') ? 100 : 0),
      };
      if (mired) value.colorTemp = Math.round(1_000_000 / mired);
      if (hue !== null && sat !== null) value.color = sat > 0 ? hsvToHex(hue, sat) : null;
      return value;
    }
    case 'switch': {
      const value: SwitchValue = { on: bool(service, 'power') || bool(service, 'active') };
      return value;
    }
    case 'climate': {
      const target = num(service, 'targetTemperature') ?? num(service, 'heatingThreshold') ?? 20;
      const mode = num(service, 'targetHeatingCoolingState') ?? num(service, 'targetHeaterCoolerState');
      const active = ch(service, 'active') ? bool(service, 'active') : true;
      const value: ClimateValue = {
        target,
        hvac: !active || mode === 0 ? 'off' : mode === 1 ? 'heat' : mode === 2 ? 'cool' : 'heat_cool',
      };
      const current = num(service, 'currentTemperature');
      if (current !== null) value.current = current;
      return value;
    }
    case 'sensor': {
      const temperature = num(service, 'currentTemperature');
      const humidity = num(service, 'currentRelativeHumidity');
      const value: SensorValue = temperature !== null
        ? { value: temperature, unit: '°C' }
        : { value: humidity, unit: humidity !== null ? '%' : null };
      return value;
    }
    case 'binary_sensor': {
      const contact = ch(service, 'contactState');
      if (contact) return { on: contact.value === 1 } satisfies SwitchValue;
      return { on: bool(service, 'motionDetected') || bool(service, 'occupancyDetected') } satisfies SwitchValue;
    }
    case 'cover': {
      const position = num(service, 'currentPosition') ?? (num(service, 'currentDoorState') === 0 ? 100 : 0);
      const state = num(service, 'positionState');
      const value: CoverValue = {
        on: position > 0,
        position,
        tilt: 0,
        moving: state === 1 ? 'opening' : state === 0 ? 'closing' : null,
        supportsOpen: true,
        supportsClose: true,
        supportsStop: false,
        supportsPosition: !!ch(service, 'targetPosition'),
        supportsTilt: false,
      } as CoverValue;
      return value;
    }
    case 'lock': {
      const current = num(service, 'lockCurrentState');
      const value: LockValue = { locked: current === 1, state: current === 1 ? 'locked' : current === 0 ? 'unlocked' : 'unknown', supportsOpen: false };
      return value;
    }
    case 'fan': {
      const on = bool(service, 'power') || bool(service, 'active');
      const value: FanValue = {
        on,
        percentage: num(service, 'rotationSpeed') ?? (on ? 100 : 0),
        presetMode: null,
        oscillating: bool(service, 'swingMode'),
        direction: num(service, 'rotationDirection') === 1 ? 'reverse' : 'forward',
        presetModes: [],
        supportsSpeed: !!ch(service, 'rotationSpeed'),
        supportsPreset: false,
        supportsOscillate: !!ch(service, 'swingMode'),
        supportsDirection: !!ch(service, 'rotationDirection'),
      };
      return value;
    }
  }
}

export interface PlatformWrite { characteristicId: string; value: unknown }

/** HA-Service-Aufruf → Merkmal-Schreibvorgänge. Unbekanntes wird ignoriert. */
export function platformWrites(entity: PlatformEntity, domain: string, serviceName: string, data: Record<string, unknown>): PlatformWrite[] {
  const { service } = entity;
  const writes: PlatformWrite[] = [];
  const set = (type: string, value: unknown) => {
    const c = ch(service, type);
    if (c && c.writable) writes.push({ characteristicId: c.id, value });
  };
  const currentOn = bool(service, 'power') || bool(service, 'active');
  const on = serviceName === 'turn_on' ? true : serviceName === 'turn_off' ? false : serviceName === 'toggle' ? !currentOn : null;
  switch (domain) {
    case 'light':
      if (typeof data.brightness_pct === 'number') set('brightness', Math.round(data.brightness_pct));
      if (typeof data.color_temp_kelvin === 'number') set('colorTemperature', Math.round(1_000_000 / data.color_temp_kelvin));
      if (typeof data.rgb_color === 'string' || Array.isArray(data.rgb_color)) {
        const hex = Array.isArray(data.rgb_color)
          ? `#${(data.rgb_color as number[]).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
          : String(data.rgb_color);
        const hs = hexToHs(hex);
        if (hs) { set('hue', hs.h); set('saturation', hs.s); }
      }
      if (on !== null) set('power', on);
      break;
    case 'switch':
      if (on !== null) { set('power', on); set('active', on ? 1 : 0); }
      break;
    case 'climate':
      if (serviceName === 'set_temperature' && typeof data.temperature === 'number') {
        set('targetTemperature', data.temperature);
        set('heatingThreshold', data.temperature);
      }
      if (serviceName === 'set_hvac_mode' && typeof data.hvac_mode === 'string') {
        const mode = data.hvac_mode === 'off' ? 0 : data.hvac_mode === 'heat' ? 1 : data.hvac_mode === 'cool' ? 2 : 3;
        set('targetHeatingCoolingState', mode);
        if (ch(service, 'active')) set('active', mode === 0 ? 0 : 1);
        if (mode !== 0) set('targetHeaterCoolerState', mode === 1 ? 1 : mode === 2 ? 2 : 0);
      }
      if (on !== null) { set('targetHeatingCoolingState', on ? 3 : 0); set('active', on ? 1 : 0); }
      break;
    case 'cover':
      if (serviceName === 'open_cover') { set('targetPosition', 100); set('targetDoorState', 0); }
      if (serviceName === 'close_cover') { set('targetPosition', 0); set('targetDoorState', 1); }
      if (serviceName === 'set_cover_position' && typeof data.position === 'number') set('targetPosition', Math.round(data.position));
      break;
    case 'lock':
      if (serviceName === 'lock') set('lockTargetState', 1);
      if (serviceName === 'unlock') set('lockTargetState', 0);
      break;
    case 'fan':
      if (serviceName === 'set_percentage' && typeof data.percentage === 'number') { set('rotationSpeed', data.percentage); set('active', data.percentage > 0 ? 1 : 0); set('power', data.percentage > 0); }
      if (serviceName === 'oscillate' && typeof data.oscillating === 'boolean') set('swingMode', data.oscillating ? 1 : 0);
      if (serviceName === 'set_direction' && typeof data.direction === 'string') set('rotationDirection', data.direction === 'reverse' ? 1 : 0);
      if (on !== null) { set('power', on); set('active', on ? 1 : 0); if (on && typeof data.percentage === 'number') set('rotationSpeed', data.percentage); }
      break;
    default:
      break;
  }
  return writes;
}
