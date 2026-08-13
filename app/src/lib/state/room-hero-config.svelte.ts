import type { RoomHeroConfig } from '../config/household-config.ts';
import { ROOM_HERO_CONFIGS } from '../config/household-runtime-data.ts';

export type RoomHeroConfigProjection = Readonly<Record<string, RoomHeroConfig | null>>;

function cloneConfig(config: RoomHeroConfig | null | undefined): RoomHeroConfig | null {
  if (!config) return null;
  return {
    assetId: config.assetId,
    focus: {
      panel: { x: config.focus.panel.x, y: config.focus.panel.y },
      phone: { x: config.focus.phone.x, y: config.focus.phone.y },
    },
  };
}

function cloneProjection(projection: RoomHeroConfigProjection): Record<string, RoomHeroConfig | null> {
  return Object.fromEntries(
    Object.entries(projection).map(([roomId, config]) => [roomId, cloneConfig(config)]),
  );
}

let configs = $state<Record<string, RoomHeroConfig | null>>(cloneProjection(ROOM_HERO_CONFIGS));

/** Returns an isolated snapshot so consumers cannot mutate the reactive source. */
export function roomHeroConfig(roomId: string | null | undefined): RoomHeroConfig | null {
  if (!roomId || !Object.prototype.hasOwnProperty.call(configs, roomId)) return null;
  return cloneConfig(configs[roomId]);
}

/** Atomically replaces the complete runtime projection. */
export function replaceRoomHeroConfigs(projection: RoomHeroConfigProjection): void {
  configs = cloneProjection(projection);
}

/** Assignment-response seam: immediately sets or clears one room assignment. */
export function setRoomHeroConfig(roomId: string, config: RoomHeroConfig | null): void {
  configs = { ...configs, [roomId]: cloneConfig(config) };
}

export function clearRoomHeroConfig(roomId: string): void {
  setRoomHeroConfig(roomId, null);
}
