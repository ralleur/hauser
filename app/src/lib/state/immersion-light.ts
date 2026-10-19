import { sharedStorage } from './shared-config.ts';

/* Position eines Geräts im Raumbild. Lampen nutzen Radius, Ellipse und
   Drehung als Lichtzone; alle anderen Geräte sind ein Punkt, ihre Zonenfelder
   bleiben unbeachtet. */
export interface ImmersionLightPlacement {
  /** Relative Koordinate im unverzerrten Hero-Asset (0…1). */
  x: number;
  y: number;
  /** Radius relativ zur Asset-Breite; bei einer Ellipse die waagrechte Halbachse. */
  radius: number;
  /** Senkrechte Halbachse, ebenfalls relativ zur Asset-Breite. Ohne Eintrag ein Kreis. */
  ry?: number;
  /** Drehung der Ellipse in Grad im Uhrzeigersinn, -180…180. Ohne Eintrag 0. */
  rotation?: number;
}

/* Grenzen der Zone, relativ zur Bildbreite. Die iOS-App liest dieselben Felder. */
export const LIGHT_ZONE_MIN = 0.008;
export const LIGHT_ZONE_MAX = 0.4;

export function placementRy(placement: ImmersionLightPlacement): number {
  return placement.ry ?? placement.radius;
}

export function placementRotation(placement: ImmersionLightPlacement): number {
  return placement.rotation ?? 0;
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
        // Seit „Geräte zuweisen“ (Owner 2026-10-19) jedes Gerät, nicht nur `light.*`.
        if (!/^[a-z_]+\.\S+$/.test(entityId) || !placement || typeof placement !== 'object') continue;
        const p = placement as Record<string, unknown>;
        if (!validUnit(p.x) || !validUnit(p.y)) continue;
        const radius = validAxis(p.radius) ? p.radius : 0.16;
        const placementValue: ImmersionLightPlacement = { x: p.x, y: p.y, radius };
        if (validAxis(p.ry) && p.ry !== radius) placementValue.ry = p.ry;
        if (typeof p.rotation === 'number' && Number.isFinite(p.rotation) && p.rotation !== 0) {
          placementValue.rotation = ((((p.rotation + 180) % 360) + 360) % 360) - 180;
        }
        placements[entityId] = placementValue;
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

function validAxis(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= LIGHT_ZONE_MIN && value <= LIGHT_ZONE_MAX;
}
