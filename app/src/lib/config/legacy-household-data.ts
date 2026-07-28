/*
 * Pure static sources for the currently controlling legacy household.
 * No runes, storage, timers, backend or command modules belong in this graph.
 */

export type LegacyManagedDomain =
  | 'light'
  | 'switch'
  | 'sensor'
  | 'binary_sensor'
  | 'climate'
  | 'media_player'
  | 'cover'
  | 'fan'
  | 'input_boolean';
export type LegacyDeviceCategory = 'light' | 'switch' | 'temp' | 'info' | 'media';

export interface Light {
  id: string;
  entityId: string;
  domain?: LegacyManagedDomain;
  name: string;
  dimmable: boolean;
  category?: LegacyDeviceCategory;
  colorTemp?: boolean;
  color?: boolean;
  colorTempMin?: number;
  colorTempMax?: number;
  unit?: string | null;
  deviceClass?: string | null;
  icon?: string;
}

export interface Room {
  id: string;
  name: string;
  presence: boolean;
  windowOpen: boolean;
  lights: Light[];
}

export interface LightSeed extends Light {
  on: boolean;
  brightness: number;
  entityId: string;
  colorTemp?: boolean;
  color?: boolean;
  icon?: string;
  colorTempK?: number;
  colorHex?: string | null;
}

export interface RoomSeed extends Room {
  target?: number;
  hvac?: 'heat' | 'cool' | 'off';
  lights: LightSeed[];
  climateEntityId?: string;
  tempSensorId?: string;
  current?: number;
}

export interface MediaPlayerMeta { id: string; name: string }

export interface MediaSeed extends MediaPlayerMeta {
  entityId: string;
  available: boolean;
  playing: boolean;
  volume: number;
  source: string | null;
  track: string | null;
  artist: string | null;
  duration: number;
  position: number;
}

export const ROOM_SEED: RoomSeed[] = [
  {
    id: 'wohnzimmer', name: 'Wohnzimmer', target: 21.0, current: 23.5,
    hvac: 'heat', presence: true, windowOpen: false,
    climateEntityId: 'climate.wohnzimmer',
    lights: [
      { id: 'kugellampen', name: 'Kugellampen', entityId: 'light.wohnzimmer_kugellampen', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 2700, colorHex: null },
      { id: 'esstisch', name: 'Esstisch', entityId: 'light.wohnzimmer_esstisch', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 3000, colorHex: null, icon: 'i-lamp-pendant' },
      { id: 'kugel_tv', name: 'Kugellampe TV', entityId: 'light.wohnzimmer_tv', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 2700, colorHex: null },
      { id: 'kugel_fenster', name: 'Kugellampe Fenster', entityId: 'light.wohnzimmer_fensterlampe', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 4000, colorHex: null },
    ],
  },
  {
    id: 'kinderzimmer', name: 'Kinderzimmer', presence: false, windowOpen: false,
    lights: [],
  },
  {
    id: 'schlafzimmer', name: 'Schlafzimmer', target: 16.0, current: 23.0,
    hvac: 'heat', presence: false, windowOpen: false,
    climateEntityId: 'climate.schlafzimmer',
    lights: [
      { id: 'bett', name: 'Bett', entityId: 'light.schlafzimmer_bett', on: false, brightness: 50, dimmable: true, colorTemp: true, color: true, colorTempK: 2700, colorHex: null },
      { id: 'schreibtisch', name: 'Schreibtisch', entityId: 'light.schlafzimmer_schreibtisch', on: false, brightness: 50, dimmable: true, colorTemp: true, colorTempK: 4000 },
    ],
  },
  {
    id: 'bad', name: 'Bad', target: 17.0, current: 22.5,
    hvac: 'heat', presence: false, windowOpen: false,
    climateEntityId: 'climate.bad',
    lights: [
      { id: 'spiegel', name: 'Spiegellicht', entityId: 'light.bad_spiegel', on: false, brightness: 50, dimmable: true, colorTemp: true, colorTempK: 4000 },
    ],
  },
  {
    id: 'kueche', name: 'Küche', presence: false, windowOpen: false,
    lights: [
      { id: 'ledfridge', name: 'LED-Leiste', entityId: 'light.kueche_ledleiste', on: false, brightness: 50, dimmable: true, color: true, colorHex: null, icon: 'i-led-strip' },
    ],
  },
  {
    id: 'flur', name: 'Flur', presence: false, windowOpen: false,
    lights: [],
  },
];

export const MEDIA_SEED = [
  {
    id: 'wohnzimmer', name: 'Wohnzimmer', entityId: 'media_player.wohnzimmer_speaker',
    available: true, playing: false, track: null, artist: null, source: null,
    volume: 30, duration: 0, position: 0,
  },
  {
    id: 'kueche', name: 'Küche', entityId: 'media_player.kueche_speaker',
    available: true, playing: false, track: null, artist: null, source: null,
    volume: 30, duration: 0, position: 0,
  },
] as const satisfies readonly MediaSeed[];

export const SUN_ENTITY = 'sun.sun';

export type EnergySensorRef = string | readonly string[] | null;

export interface LoadSource {
  entityId: string;
  label: string;
  group?: string;
}

export interface EnergySensors {
  pv: EnergySensorRef;
  load: readonly LoadSource[];
  producedToday: EnergySensorRef;
  consumedToday: EnergySensorRef;
  fedInToday: EnergySensorRef;
  drawnToday: EnergySensorRef;
}

export function energyRefIds(ref: EnergySensorRef | readonly LoadSource[]): string[] {
  if (!ref) return [];
  if (typeof ref === 'string') return [ref];
  return ref.map((item) => (typeof item === 'string' ? item : item.entityId));
}

export const ENERGY_SENSORS: EnergySensors = {
  pv: null,
  load: [
    { entityId: 'sensor.strom_leiste_kanal_1_power', label: 'Steckdosenleiste Kanal 1', group: 'Steckdosenleiste' },
    { entityId: 'sensor.strom_leiste_kanal_2_power', label: 'Steckdosenleiste Kanal 2', group: 'Steckdosenleiste' },
    { entityId: 'sensor.waschmaschine_strom_power', label: 'Waschmaschine' },
    { entityId: 'sensor.strom_schreibtisch_links_power', label: 'Schreibtisch links' },
    { entityId: 'sensor.strom_bad_klein_power', label: 'Bad (klein)' },
    { entityId: 'sensor.strom_schlafzimmer_tuer_power', label: 'Schlafzimmer Tür' },
    { entityId: 'sensor.strom_wohnzimmer_regal_power', label: 'Wohnzimmer Regal' },
    { entityId: 'sensor.strom_couch_lang_power', label: 'Couch' },
    { entityId: 'sensor.strom_glastuer_power', label: 'Glastür' },
    { entityId: 'sensor.strom_spuele_power', label: 'Spüle' },
    { entityId: 'sensor.strom_kinderzimmer_tuer_power', label: 'Kinderzimmer Tür' },
    { entityId: 'sensor.strom_zigbee_steckdose_power', label: 'Zigbee-Steckdose' },
    { entityId: 'sensor.strom_trockner_power', label: 'Trockner' },
    { entityId: 'sensor.strom_kaffeemaschine_power', label: 'Kaffeemaschine' },
    { entityId: 'sensor.strom_server_power', label: 'Server' },
  ],
  producedToday: null,
  consumedToday: 'sensor.hmi_erfasste_last_taeglich',
  fedInToday: null,
  drawnToday: null,
};

export const VACATION_MODE_ENTITY = 'switch.urlaubsmodus';
export const HOME_OFF_SCRIPT_ENTITY = 'script.hmi_home_ausser_schlafzimmer_aus';
export const LAUNDRY_ENTITIES = {
  washer: 'input_boolean.waschmaschine_laeuft',
  dryer: 'input_boolean.trockner_laeuft',
} as const;
export const LEGACY_ROOM_CAMERA_ENTITIES: Readonly<Record<string, string>> = {
  wohnzimmer: 'camera.balkon',
};

export type LegacyScreenId =
  | 'home'
  | 'energy'
  | 'calendar'
  | 'notes'
  | 'shopping'
  | 'reminders'
  | 'media'
  | 'songs'
  | 'library'
  | 'library-detail'
  | 'ablage'
  | 'system';

export interface LegacyScreenEntry {
  id: LegacyScreenId;
  tab: string;
  phoneOnly?: boolean;
}

export const LEGACY_SCREENS: readonly LegacyScreenEntry[] = [
  { id: 'home', tab: 'home' },
  { id: 'energy', tab: 'energy' },
  { id: 'calendar', tab: 'calendar' },
  { id: 'notes', tab: 'notes' },
  { id: 'shopping', tab: 'notes', phoneOnly: true },
  { id: 'reminders', tab: 'notes', phoneOnly: true },
  { id: 'media', tab: 'media' },
  { id: 'songs', tab: 'songs' },
  { id: 'library', tab: 'library' },
  { id: 'library-detail', tab: 'library' },
  { id: 'ablage', tab: 'ablage' },
  { id: 'system', tab: 'system' },
];

export const LEGACY_TABS = [
  { id: 'home', configName: 'Home', icon: 'i-home' },
  { id: 'energy', configName: 'Energie', icon: 'i-bolt' },
  { id: 'calendar', configName: 'Kalender', icon: 'i-calendar' },
  { id: 'notes', configName: 'Notizen', icon: 'i-note-text-outline' },
  { id: 'media', configName: 'Media', icon: 'i-media' },
  { id: 'songs', configName: 'Songs', icon: 'i-music-note-plus' },
  { id: 'library', configName: 'Bibliothek', icon: 'i-library' },
  { id: 'ablage', configName: 'Ablage', icon: 'i-archive-outline' },
  { id: 'system', configName: 'System', icon: 'i-system' },
] as const;

export const LEGACY_ENABLED_MODULES = [
  'home',
  'energy',
  'calendar',
  'notes',
  'shopping',
  'reminders',
  'media',
  'songs',
  'library',
  'ablage',
  'system',
  'laundry',
  'vacation',
] as const;
