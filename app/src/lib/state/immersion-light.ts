import { sharedStorage } from './shared-config.ts';

export interface ImmersionLightPlacement {
  /** Relative Koordinate im unverzerrten Hero-Asset (0…1). */
  x: number;
  y: number;
  /** Radius relativ zur Asset-Breite. */
  radius: number;
}

export interface ImmersionLightConfig {
  version: 1;
  rooms: Record<string, Record<string, ImmersionLightPlacement>>;
}

export interface ImmersionLightStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const IMMERSION_LIGHT_CONFIG_KEY = 'hmi:immersion-light:v1';
export const EMPTY_IMMERSION_LIGHT_CONFIG: ImmersionLightConfig = { version: 1, rooms: {} };

export function parseImmersionLightConfig(raw: string | null): ImmersionLightConfig {
  if (!raw) return structuredClone(EMPTY_IMMERSION_LIGHT_CONFIG);
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; rooms?: unknown };
    if (parsed.version !== 1 || !parsed.rooms || typeof parsed.rooms !== 'object' || Array.isArray(parsed.rooms)) {
      return structuredClone(EMPTY_IMMERSION_LIGHT_CONFIG);
    }
    const rooms: ImmersionLightConfig['rooms'] = {};
    for (const [roomId, value] of Object.entries(parsed.rooms as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const placements: Record<string, ImmersionLightPlacement> = {};
      for (const [entityId, placement] of Object.entries(value as Record<string, unknown>)) {
        if (!entityId.startsWith('light.') || !placement || typeof placement !== 'object') continue;
        const p = placement as Record<string, unknown>;
        if (!validUnit(p.x) || !validUnit(p.y)) continue;
        const radius = typeof p.radius === 'number' && p.radius >= 0.04 && p.radius <= 0.4 ? p.radius : 0.16;
        placements[entityId] = { x: p.x, y: p.y, radius };
      }
      if (Object.keys(placements).length) rooms[roomId] = placements;
    }
    return { version: 1, rooms };
  } catch {
    return structuredClone(EMPTY_IMMERSION_LIGHT_CONFIG);
  }
}

export function loadImmersionLightConfig(
  storage: ImmersionLightStorage = sharedStorage,
): ImmersionLightConfig {
  return parseImmersionLightConfig(storage.getItem(IMMERSION_LIGHT_CONFIG_KEY));
}

export function saveImmersionLightConfig(
  config: ImmersionLightConfig,
  storage: ImmersionLightStorage = sharedStorage,
): void {
  storage.setItem(IMMERSION_LIGHT_CONFIG_KEY, JSON.stringify(config));
}

function validUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
