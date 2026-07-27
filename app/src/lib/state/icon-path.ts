const ICON_ASSET_ALIASES: Readonly<Record<string, string>> = {
  // Core navigation (Tabler → MDI)
  home: 'home', music: 'music', library: 'library', system: 'cog',
  // Light icons
  bulb: 'lightbulb', 'lamp-floor': 'floor-lamp', 'lamp-pendant': 'ceiling-light',
  'lamp-ceiling': 'ceiling-light', 'lamp-table': 'desk-lamp', 'led-strip': 'led-strip',
  // Device icons
  person: 'account', window: 'window-closed', flame: 'fire', snow: 'snowflake',
  power: 'power-standby', sun: 'white-balance-sunny', moon: 'weather-night',
  // UI controls
  back: 'chevron-left', prev: 'skip-previous', next: 'skip-next',
  grid: 'view-grid', cc: 'closed-caption',
  // Media
  speaker: 'speaker', tv: 'television', fan: 'fan',
  play: 'play', pause: 'pause', media: 'playlist-music',
  // Smart home
  blinds: 'blinds', bolt: 'lightning-bolt', plug: 'power-plug',
  thermometer: 'thermometer', droplet: 'water', gauge: 'gauge',
  door: 'door-closed', garage: 'garage', shield: 'shield',
  check: 'check', plus: 'plus', minus: 'minus',
  'chevron-up': 'chevron-up', 'chevron-down': 'chevron-down',
  search: 'magnify',
};

const SAFE_ICON_ID = /^i-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSafeIconId(id: string): boolean {
  return SAFE_ICON_ID.test(id);
}

export function iconAssetNameFromId(id: string): string | null {
  if (!isSafeIconId(id)) return null;
  const name = id.slice(2);
  return ICON_ASSET_ALIASES[name] ?? name;
}

export function iconAssetUrlFromId(id: string): string | null {
  const asset = iconAssetNameFromId(id);
  return asset ? `${import.meta.env.BASE_URL}mdi-icons/${asset}.svg` : null;
}
