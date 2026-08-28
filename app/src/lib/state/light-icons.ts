/* Symbol-Persistenz (B-16A/B-22): reine lokale UI-Präferenz pro HA-entity_id. */
import type { DeviceCategory } from './device-config.ts';
import { isSafeIconId } from './icon-path.ts';
import { sharedStorage } from './shared-config.ts';

const DEFAULT_ICONS_BY_CATEGORY: Record<DeviceCategory, string> = {
  light: 'i-bulb', switch: 'i-bolt', temp: 'i-thermometer', info: 'i-gauge', media: 'i-playlist-music', camera: 'i-camera',
};

export const DEFAULT_LAMP_ICON = DEFAULT_ICONS_BY_CATEGORY.light;
export const LIGHT_ICON_OVERRIDE_STORAGE_KEY = 'hmi:light-icon-overrides:v1';

export function defaultIconFor(category: DeviceCategory): string {
  return DEFAULT_ICONS_BY_CATEGORY[category];
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
