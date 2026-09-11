/* Symbol-Persistenz (B-16A/B-22): reine lokale UI-Präferenz pro HA-entity_id. */
import type { DeviceCategory } from './device-config.ts';
import { isSafeIconId } from './icon-path.ts';
import { sharedStorage } from './shared-config.ts';

const DEFAULT_ICONS_BY_CATEGORY: Record<DeviceCategory, string> = {
  light: 'i-bulb', switch: 'i-bolt', fan: 'i-fan', temp: 'i-thermometer', info: 'i-gauge', media: 'i-playlist-music', camera: 'i-camera',
  cover: 'i-window-shutter',
  valve: 'i-valve',
  vacuum: 'i-robot-vacuum',
  lock: 'i-lock',
  humidifier: 'i-air-humidifier',
  water_heater: 'i-water-boiler',
  mower: 'i-robot-mower',
  alarm: 'i-shield-home',
  number: 'i-tune',
  select: 'i-format-list-bulleted',
  button: 'i-gesture-tap',
};

export const DEFAULT_LAMP_ICON = DEFAULT_ICONS_BY_CATEGORY.light;
export const LIGHT_ICON_OVERRIDE_STORAGE_KEY = 'hmi:light-icon-overrides:v1';

export function defaultIconFor(category: DeviceCategory): string {
  return DEFAULT_ICONS_BY_CATEGORY[category];
}

/* ── Sensor-Symbole nach Name (Owner-Wunsch 2026-09-11) ──
   Ein Sensor bringt selten ein Symbol mit, aber fast immer einen sprechenden
   Namen, eine Einheit oder eine device_class. Daraus rät Hauser ein Symbol
   aus dem MDI-Katalog: zuerst die device_class (die verlässlichste Quelle),
   dann die Einheit, dann Wörter im Namen und in der entity_id — deutsch und
   englisch. Trifft nichts, bleibt das neutrale Messinstrument. */
const SENSOR_ICON_BY_DEVICE_CLASS: Record<string, string> = {
  battery: 'i-battery', temperature: 'i-thermometer', humidity: 'i-water-percent',
  power: 'i-flash', energy: 'i-lightning-bolt', voltage: 'i-sine-wave', current: 'i-current-ac',
  apparent_power: 'i-flash', reactive_power: 'i-flash', power_factor: 'i-angle-acute', frequency: 'i-sine-wave',
  illuminance: 'i-brightness-6', pressure: 'i-gauge', atmospheric_pressure: 'i-gauge',
  carbon_dioxide: 'i-molecule-co2', carbon_monoxide: 'i-molecule-co', aqi: 'i-air-filter',
  pm25: 'i-air-filter', pm10: 'i-air-filter', pm1: 'i-air-filter', volatile_organic_compounds: 'i-air-filter',
  volatile_organic_compounds_parts: 'i-air-filter', nitrogen_dioxide: 'i-molecule', ozone: 'i-molecule',
  gas: 'i-meter-gas', water: 'i-water', precipitation: 'i-weather-rainy', precipitation_intensity: 'i-weather-pouring',
  wind_speed: 'i-weather-windy', wind_direction: 'i-compass', speed: 'i-speedometer', distance: 'i-map-marker-distance',
  weight: 'i-weight', volume: 'i-cup-water', volume_flow_rate: 'i-waves', signal_strength: 'i-signal',
  data_rate: 'i-swap-vertical', data_size: 'i-database', duration: 'i-timer', timestamp: 'i-clock-outline',
  date: 'i-calendar', monetary: 'i-cash', moisture: 'i-water-outline', sound_pressure: 'i-volume-high',
  irradiance: 'i-white-balance-sunny', ph: 'i-ph', conductivity: 'i-flash-outline',
  // binary_sensor-Klassen
  motion: 'i-motion-sensor', occupancy: 'i-motion-sensor', presence: 'i-home-account', door: 'i-door',
  window: 'i-window-open', opening: 'i-door-open', garage_door: 'i-garage', smoke: 'i-smoke-detector',
  moving: 'i-run', vibration: 'i-vibrate', light: 'i-brightness-6', connectivity: 'i-wifi', plug: 'i-power-plug',
  problem: 'i-alert-circle-outline', safety: 'i-shield-check', tamper: 'i-shield-alert', running: 'i-play-circle-outline',
  lock: 'i-lock', cold: 'i-snowflake', heat: 'i-fire', update: 'i-update', sound: 'i-volume-high', battery_charging: 'i-battery-charging',
};

const SENSOR_ICON_BY_UNIT: ReadonlyArray<[RegExp, string]> = [
  [/^(°c|°f|k|°)$/i, 'i-thermometer'], // i18n-ignore: deutsche Sensornamen
  [/^(w|kw|mw)$/i, 'i-flash'],
  [/^(wh|kwh|mwh|gwh)$/i, 'i-lightning-bolt'],
  [/^(v|mv|kv)$/i, 'i-sine-wave'],
  [/^(a|ma)$/i, 'i-current-ac'],
  [/^(va|var|kva|kvar)$/i, 'i-flash'],
  [/^hz$/i, 'i-sine-wave'],
  [/^(lx|lm)$/i, 'i-brightness-6'],
  [/^(hpa|mbar|bar|pa|kpa|psi|mmhg|inhg)$/i, 'i-gauge'],
  [/^ppm$/i, 'i-molecule-co2'],
  [/^(µg\/m³|μg\/m³|mg\/m³)$/i, 'i-air-filter'], // i18n-ignore: deutsche Sensornamen
  [/^(dbm|db)$/i, 'i-signal'],
  [/^(m³|l|gal|ft³)$/i, 'i-water'], // i18n-ignore: deutsche Sensornamen
  [/^(m³\/h|l\/min|l\/h|gal\/min)$/i, 'i-waves'], // i18n-ignore: deutsche Sensornamen
  [/^(mm|cm|m|km|in|ft|mi)$/i, 'i-map-marker-distance'],
  [/^(km\/h|m\/s|mph|kn)$/i, 'i-weather-windy'],
  [/^(kg|g|lb|oz)$/i, 'i-weight'],
  [/^(€|eur|\$|usd|£|gbp|chf|ct|c\/kwh|€\/kwh)$/i, 'i-cash'], // i18n-ignore: deutsche Sensornamen
  [/^(s|min|h|d|ms)$/i, 'i-timer'],
  [/^(b|kb|mb|gb|tb|kib|mib|gib)$/i, 'i-database'],
  [/^(bit\/s|kbit\/s|mbit\/s|gbit\/s|b\/s|kb\/s|mb\/s)$/i, 'i-swap-vertical'],
  [/^(w\/m²)$/i, 'i-white-balance-sunny'], // i18n-ignore: deutsche Sensornamen
  [/^(dba?)$/i, 'i-volume-high'],
];

/* Reihenfolge = Vorrang: spezifische Wörter vor allgemeinen (z. B. „Batterie"
   vor „Spannung", weil „Batteriespannung" die Batterie meint). Ein Muster ist
   ein Teilwort-Treffer; nur die ganz kurzen Kürzel brauchen Wortgrenzen, sonst
   fände „a" jedes Wort. Deutsche und englische Wortstämme stehen nebeneinander
   — i18n-ignore, das sind Sensornamen, keine Anzeige. */
const SENSOR_ICON_BY_WORD: ReadonlyArray<[RegExp, string]> = [
  [/batt|akku|accu|ladung|ladestand|charge/, 'i-battery'],
  [/co2|co₂|kohlendioxid|carbon/, 'i-molecule-co2'], // i18n-ignore: deutsche Sensornamen
  [/voc|luftqualit|air ?quality|\baqi\b|feinstaub|pm ?1?[025]|particulate/, 'i-air-filter'],
  [/humid|feucht|moisture|\brh\b/, 'i-water-percent'],
  [/temp|thermo|wärme|waerme/, 'i-thermometer'], // i18n-ignore: deutsche Sensornamen
  [/volt|spannung|\bv\b/, 'i-sine-wave'],
  [/amp|current|stromstärke|stromstaerke|\ba\b/, 'i-current-ac'], // i18n-ignore: deutsche Sensornamen
  [/energ|verbrauch|consumption|kwh|zähler|zaehler|meter|total/, 'i-lightning-bolt'], // i18n-ignore: deutsche Sensornamen
  [/power|leistung|watt|\bload\b|\blast\b/, 'i-flash'],
  [/solar|photovolt|\bpv\b|erzeugung|produktion|production|yield|ertrag/, 'i-solar-power'],
  [/grid|netz|einspeis|export|import|bezug/, 'i-transmission-tower'],
  [/lux|illumin|hellig|brightness|licht|light/, 'i-brightness-6'],
  [/druck|pressure|barometer/, 'i-gauge'],
  [/rain|regen|niederschlag|precip/, 'i-weather-rainy'],
  [/wind|böe|gust/, 'i-weather-windy'], // i18n-ignore: deutsche Sensornamen
  [/\buv\b|sonne|\bsun\b|irradian|strahlung/, 'i-white-balance-sunny'],
  [/wasser|water|leak|leck|flow|durchfluss/, 'i-water'],
  [/\bgas\b|erdgas/, 'i-meter-gas'],
  [/signal|rssi|wifi|wlan|\blqi\b|empfang/, 'i-signal'],
  [/motion|bewegung|occupancy|presence|anwesenheit|\bpir\b/, 'i-motion-sensor'],
  [/\bdoor\b|tür|tuer|contact|kontakt/, 'i-door'], // i18n-ignore: deutsche Sensornamen
  [/window|fenster/, 'i-window-open'],
  [/smoke|rauch|feuer|fire/, 'i-smoke-detector'],
  [/noise|lärm|laerm|sound|geräusch|geraeusch|lautstärke|volume/, 'i-volume-high'], // i18n-ignore: deutsche Sensornamen
  [/speed|geschwindigkeit|tempo/, 'i-speedometer'],
  [/distance|abstand|entfernung|distanz|füllstand|fuellstand|level|pegel/, 'i-map-marker-distance'], // i18n-ignore: deutsche Sensornamen
  [/weight|gewicht|waage|scale/, 'i-weight'],
  [/price|preis|cost|kosten|tarif|money|geld/, 'i-cash'],
  [/\btime\b|zeit|dauer|duration|uptime|laufzeit|timer|runtime/, 'i-timer'],
  [/date|datum|nächste|naechste/, 'i-calendar'], // i18n-ignore: deutsche Sensornamen
  [/\bcpu\b|prozessor|processor/, 'i-chip'],
  [/memory|\bram\b|speicher|disk|storage|festplatte|\bssd\b/, 'i-database'],
  [/traffic|download|upload|bandwidth/, 'i-swap-vertical'],
  [/count|anzahl|requests|pulses/, 'i-counter'],
  [/plant|pflanze|boden|soil|erde|garten|garden/, 'i-sprout'],
  [/heart|puls|herz/, 'i-heart-pulse'],
  [/step|schritt/, 'i-walk'],
  [/vibrat|erschütt|erschuett|shake/, 'i-vibrate'], // i18n-ignore: deutsche Sensornamen
  [/heiz|radiator|boiler|kessel|vorlauf|rücklauf|ruecklauf/, 'i-radiator'], // i18n-ignore: deutsche Sensornamen
  [/wasch|washer|washing|laundry/, 'i-washing-machine'],
  [/trockner|dryer/, 'i-tumble-dryer'],
  [/phase|frequen|\bhz\b/, 'i-sine-wave'],
  [/percent|prozent|anteil|ratio/, 'i-percent'],
  [/status|state|zustand|mode|modus/, 'i-information-outline'],
  [/update|version|firmware/, 'i-update'],
];

export interface SensorIconHints {
  entityId?: string;
  name?: string | null;
  deviceClass?: string | null;
  unit?: string | null;
}

export function sensorIconFor(hints: SensorIconHints): string {
  const deviceClass = hints.deviceClass?.trim().toLowerCase();
  if (deviceClass && SENSOR_ICON_BY_DEVICE_CLASS[deviceClass]) return SENSOR_ICON_BY_DEVICE_CLASS[deviceClass];
  const unit = hints.unit?.trim();
  if (unit) {
    for (const [pattern, icon] of SENSOR_ICON_BY_UNIT) if (pattern.test(unit)) return icon;
  }
  const haystack = `${hints.name ?? ''} ${(hints.entityId ?? '').replace(/^[a-z_]+\./, '').replace(/[_.]/g, ' ')}`.toLowerCase();
  if (haystack.trim()) {
    for (const [pattern, icon] of SENSOR_ICON_BY_WORD) if (pattern.test(haystack)) return icon;
  }
  return DEFAULT_ICONS_BY_CATEGORY.info;
}

const VALID_ICON_IDS = { has: isSafeIconId };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : sharedStorage; } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOverrides(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [entityId, icon] of Object.entries(value)) {
    if (typeof icon === 'string' && VALID_ICON_IDS.has(icon)) out[entityId] = icon;
  }
  return out;
}

export function storedLightIconOverrides(storage: StorageLike | null = browserStorage()): Record<string, string> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(LIGHT_ICON_OVERRIDE_STORAGE_KEY);
    return raw ? normalizeOverrides(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Record<string, string>, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    if (Object.keys(overrides).length) storage.setItem(LIGHT_ICON_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
    else storage.removeItem(LIGHT_ICON_OVERRIDE_STORAGE_KEY);
  } catch { /* Symbolwahl darf die App bei blockiertem Storage nicht brechen. */ }
}

export function seedIcon(icon?: string): string {
  return icon && VALID_ICON_IDS.has(icon) ? icon : DEFAULT_LAMP_ICON;
}

export function iconForLightSeed(light: { entityId: string; icon?: string }, storage: StorageLike | null = browserStorage()): string {
  return storedLightIconOverrides(storage)[light.entityId] ?? seedIcon(light.icon);
}

export function iconForDevice(entityId: string, category: DeviceCategory, seedIcon?: string, storage: StorageLike | null = browserStorage()): string {
  return storedLightIconOverrides(storage)[entityId]
    ?? (seedIcon && VALID_ICON_IDS.has(seedIcon) ? seedIcon : defaultIconFor(category));
}

export function persistLightIconOverride(entityId: string, icon: string, storage: StorageLike | null = browserStorage()): void {
  if (!VALID_ICON_IDS.has(icon)) return;
  writeOverrides({ ...storedLightIconOverrides(storage), [entityId]: icon }, storage);
}

export function resetLightIconOverride(entityId: string, storage: StorageLike | null = browserStorage()): void {
  const overrides = storedLightIconOverrides(storage);
  delete overrides[entityId];
  writeOverrides(overrides, storage);
}
