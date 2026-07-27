import { domainOf, type EntityCatalogItem } from '../state/device-config.ts';

const COLOR_MODES = new Set(['hs', 'rgb', 'rgbw', 'rgbww', 'xy']);
const TEMP_MODES = new Set(['color_temp']);
const BRIGHTNESS_MODES = new Set(['brightness', 'color_temp', 'hs', 'rgb', 'rgbw', 'rgbww', 'xy', 'white']);

export interface HassStateLike {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export function lightCapabilitiesFromHaAttributes(attributes: Record<string, unknown>): EntityCatalogItem['capabilities'] {
  const modesRaw = attributes.supported_color_modes;
  const modes = Array.isArray(modesRaw) ? modesRaw.filter((m): m is string => typeof m === 'string') : [];
  const hasModes = modes.length > 0;
  const capabilities: EntityCatalogItem['capabilities'] = {
    dimmable: hasModes ? modes.some((m) => BRIGHTNESS_MODES.has(m)) : typeof attributes.brightness === 'number',
    colorTemp: hasModes ? modes.some((m) => TEMP_MODES.has(m)) : typeof attributes.color_temp_kelvin === 'number' || typeof attributes.color_temp === 'number',
    color: hasModes ? modes.some((m) => COLOR_MODES.has(m)) : Array.isArray(attributes.rgb_color),
  };
  if (typeof attributes.min_color_temp_kelvin === 'number') capabilities.colorTempMin = attributes.min_color_temp_kelvin;
  if (typeof attributes.max_color_temp_kelvin === 'number') capabilities.colorTempMax = attributes.max_color_temp_kelvin;
  return capabilities;
}

export function catalogItemFromHaState(state: HassStateLike): EntityCatalogItem | null {
  const domain = domainOf(state.entity_id);
  if (!domain) return null;
  const name = typeof state.attributes.friendly_name === 'string'
    ? state.attributes.friendly_name
    : state.entity_id;
  const area = typeof state.attributes.area_id === 'string'
    ? state.attributes.area_id
    : typeof state.attributes.area === 'string'
      ? state.attributes.area
      : null;
  const item: EntityCatalogItem = {
    entityId: state.entity_id,
    domain,
    name,
    area,
    capabilities: domain === 'light' ? lightCapabilitiesFromHaAttributes(state.attributes) : {},
  };
  // Anzeige-Metadaten der info-Kategorie: Einheit + device_class (Fenster/
  // Bewegung/Temperatur …) direkt aus den HA-Attributen.
  if (domain === 'sensor' || domain === 'binary_sensor') {
    item.unit = typeof state.attributes.unit_of_measurement === 'string' ? state.attributes.unit_of_measurement : null;
    item.deviceClass = typeof state.attributes.device_class === 'string' ? state.attributes.device_class : null;
  }
  return item;
}
