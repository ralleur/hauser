/* SPDX-License-Identifier: AGPL-3.0-only */

/* Persistiertes Feintuning für den globalen Temperaturregler. Standardmäßig
   nimmt jeder Raum mit Klimaentität teil. Gespeichert werden nur Abweichungen
   sowie optional eine einzelne climate.*-Entität, die den Raumverbund ersetzt. */
import { sharedStorage } from './shared-config.ts';

export interface CentralClimateRoomConfig {
  included?: false;
  delta?: number;
}

export interface CentralClimateConfig {
  version: 1;
  rooms: Record<string, CentralClimateRoomConfig>;
  customEntityId: string | null;
}

export const CENTRAL_CLIMATE_CONFIG_KEY = 'hmi:central-climate:v1';
export const EMPTY_CENTRAL_CLIMATE_CONFIG: CentralClimateConfig = {
  version: 1,
  rooms: {},
  customEntityId: null,
};

function validClimateEntityId(value: unknown): value is string {
  return typeof value === 'string' && /^climate\.[a-z0-9_]+$/.test(value);
}

function normalizeDelta(value: number): number {
  return Math.min(10, Math.max(-10, Math.round(value * 2) / 2));
}

export function parseCentralClimateConfig(raw: string | null): CentralClimateConfig {
  if (!raw) return structuredClone(EMPTY_CENTRAL_CLIMATE_CONFIG);
  try {
    const parsed = JSON.parse(raw) as Partial<CentralClimateConfig>;
    if (parsed.version !== 1 || !parsed.rooms || typeof parsed.rooms !== 'object' || Array.isArray(parsed.rooms)) {
      return structuredClone(EMPTY_CENTRAL_CLIMATE_CONFIG);
    }
    const rooms: Record<string, CentralClimateRoomConfig> = {};
    for (const [roomId, value] of Object.entries(parsed.rooms as Record<string, unknown>)) {
      if (!roomId || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const candidate = value as Partial<CentralClimateRoomConfig>;
      const entry: CentralClimateRoomConfig = {};
      if (candidate.included === false) entry.included = false;
      if (typeof candidate.delta === 'number' && Number.isFinite(candidate.delta)) {
        const delta = normalizeDelta(candidate.delta);
        if (delta !== 0) entry.delta = delta;
      }
      if (Object.keys(entry).length > 0) rooms[roomId] = entry;
    }
    return {
      version: 1,
      rooms,
      customEntityId: validClimateEntityId(parsed.customEntityId) ? parsed.customEntityId : null,
    };
  } catch {
    return structuredClone(EMPTY_CENTRAL_CLIMATE_CONFIG);
  }
}

function load(): CentralClimateConfig {
  try {
    return parseCentralClimateConfig(sharedStorage.getItem(CENTRAL_CLIMATE_CONFIG_KEY));
  } catch {
    return structuredClone(EMPTY_CENTRAL_CLIMATE_CONFIG);
  }
}

export const centralClimateConfig = $state(load());

function save(): void {
  if (Object.keys(centralClimateConfig.rooms).length === 0 && centralClimateConfig.customEntityId === null) {
    sharedStorage.removeItem(CENTRAL_CLIMATE_CONFIG_KEY);
    return;
  }
  sharedStorage.setItem(CENTRAL_CLIMATE_CONFIG_KEY, JSON.stringify(centralClimateConfig));
}

export function centralRoomIncluded(roomId: string): boolean {
  return centralClimateConfig.rooms[roomId]?.included !== false;
}

export function centralRoomDelta(roomId: string): number {
  return centralClimateConfig.rooms[roomId]?.delta ?? 0;
}

export function setCentralRoomIncluded(roomId: string, included: boolean): void {
  const current = centralClimateConfig.rooms[roomId] ?? {};
  writeRoom(roomId, { ...current, included: included ? undefined : false });
}

export function setCentralRoomDelta(roomId: string, delta: number): void {
  const current = centralClimateConfig.rooms[roomId] ?? {};
  const normalized = normalizeDelta(Number.isFinite(delta) ? delta : 0);
  writeRoom(roomId, { ...current, delta: normalized === 0 ? undefined : normalized });
}

function writeRoom(roomId: string, entry: CentralClimateRoomConfig): void {
  const rooms = { ...centralClimateConfig.rooms };
  if (Object.values(entry).every((value) => value === undefined)) delete rooms[roomId];
  else rooms[roomId] = entry;
  centralClimateConfig.rooms = rooms;
  save();
}

export function setCentralClimateEntity(entityId: string | null): void {
  centralClimateConfig.customEntityId = validClimateEntityId(entityId) ? entityId : null;
  save();
}

export function configuredCentralClimateIds(): string[] {
  return centralClimateConfig.customEntityId ? [centralClimateConfig.customEntityId] : [];
}
