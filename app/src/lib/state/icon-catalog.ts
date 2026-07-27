import type { DeviceCategory } from './device-config.ts';
import { GENERATED_ICON_REGISTRY, type GeneratedIcon } from './icon-registry.generated.ts';

export type IconCategory = 'all' | 'light' | 'switch' | 'climate' | 'media' | 'system';
export interface IconEntry extends GeneratedIcon { searchText: string }

export const DEFAULT_ICONS_BY_CATEGORY: Record<DeviceCategory, string> = {
  light: 'i-lightbulb',
  switch: 'i-lightning-bolt',
  temp: 'i-thermometer',
  info: 'i-gauge',
  media: 'i-playlist-music',
};

const GERMAN_SEARCH_TERMS: Record<string, readonly string[]> = {
  lampe: ['lightbulb', 'lamp', 'light', 'floor-lamp', 'ceiling-light', 'desk-lamp', 'chandelier', 'led-strip'],
  licht: ['lightbulb', 'lamp', 'light'],
  stehlampe: ['floor-lamp'],
  haengelampe: ['ceiling-light', 'chandelier'],
  deckenlampe: ['ceiling-light'],
  tischlampe: ['desk-lamp'],
  steckdose: ['power-socket', 'socket', 'outlet', 'power-plug'],
  schalter: ['toggle-switch', 'switch', 'power'],
  tuer: ['door', 'door-closed'],
  fenster: ['window', 'window-closed'],
  garage: ['garage'],
  heizung: ['radiator', 'fire', 'thermometer'],
  klima: ['thermometer', 'snowflake', 'wind', 'air-conditioner'],
  kuehlung: ['snowflake', 'air-conditioner'],
  temperatur: ['thermometer'],
  feuchte: ['water', 'humidity', 'water-percent'],
  wasser: ['water', 'water-pump'],
  lueftung: ['fan', 'air-conditioner', 'wind'],
  rollladen: ['blinds', 'roller-shade'],
  jalousie: ['blinds'],
  fernseher: ['television', 'tv'],
  lautsprecher: ['speaker', 'volume-high'],
  musik: ['music', 'speaker', 'headphones'],
  kamera: ['camera', 'video'],
  praesenz: ['account', 'walk', 'human'],
  bewegung: ['motion-sensor', 'walk', 'run'],
  rauch: ['smoke-detector', 'smoke'],
  sicherheit: ['shield', 'lock', 'alarm'],
  batterie: ['battery'],
  strom: ['lightning-bolt', 'power-plug', 'power'],
  energie: ['lightning-bolt', 'battery', 'solar-power'],
  router: ['router', 'wifi', 'network'],
  netzwerk: ['router', 'wifi', 'network'],
};

function normalize(value: string): string {
  return value.toLocaleLowerCase('de-DE').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const germanByIcon = new Map<string, string[]>();
for (const [term, needles] of Object.entries(GERMAN_SEARCH_TERMS)) {
  for (const icon of GENERATED_ICON_REGISTRY) {
    if (!needles.some((needle) => icon.name === needle || icon.name.includes(`${needle}-`) || icon.name.includes(`-${needle}`))) continue;
    const terms = germanByIcon.get(icon.name) ?? [];
    terms.push(term);
    germanByIcon.set(icon.name, terms);
  }
}

export const ICON_REGISTRY: readonly IconEntry[] = GENERATED_ICON_REGISTRY.map((icon) => ({
  ...icon,
  searchText: normalize(`${icon.name} ${(germanByIcon.get(icon.name) ?? []).join(' ')}`),
}));

const ICON_BY_ID = new Map(ICON_REGISTRY.map((icon) => [icon.id, icon]));

export function isKnownIcon(id: string): boolean {
  return ICON_BY_ID.has(id);
}

export function iconAssetName(id: string): string | null {
  return ICON_BY_ID.get(id)?.asset ?? null;
}

export function iconAssetUrl(id: string): string | null {
  const asset = iconAssetName(id);
  return asset ? `${import.meta.env.BASE_URL}mdi-icons/${asset}.svg` : null;
}

export function searchIcons(query: string, category: IconCategory = 'all', limit = 240): IconEntry[] {
  const terms = normalize(query).split(' ').filter(Boolean);
  const categoryFiltered = ICON_REGISTRY.filter((icon) => category === 'all' || icon.categories.includes(category));
  if (!terms.length) return categoryFiltered.slice(0, limit);
  return categoryFiltered
    .filter((icon) => terms.every((term) => icon.searchText.includes(term)))
    .sort((a, b) => score(a, terms) - score(b, terms) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function score(icon: IconEntry, terms: readonly string[]): number {
  const first = terms[0] ?? '';
  if (icon.name === first) return 0;
  if (icon.name.startsWith(first)) return 1;
  if (icon.name.includes(first)) return 2;
  return 3;
}
