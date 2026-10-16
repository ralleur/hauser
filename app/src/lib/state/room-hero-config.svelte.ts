import { cloneRoomHero, type RoomHeroConfig, type RoomHeroSet } from '../config/household-config.ts';
import { ROOM_HERO_CONFIGS } from '../config/household-runtime-data.ts';

export type RoomHeroConfigProjection = Readonly<Record<string, RoomHeroConfig | null>>;

function cloneProjection(projection: RoomHeroConfigProjection): Record<string, RoomHeroConfig | null> {
  return Object.fromEntries(
    Object.entries(projection).map(([roomId, config]) => [roomId, cloneRoomHero(config)]),
  );
}

let configs = $state<Record<string, RoomHeroConfig | null>>(cloneProjection(ROOM_HERO_CONFIGS));

/** Per room, the set shown in this session. Chosen once, so the stage does not
    change picture when the room is shown again; a new session chooses anew. */
const shown = new Map<string, string>();

/** Picks the set to show: the one already shown if it still belongs to the
    room, otherwise a random one. `random` is injectable for tests. */
export function pickRoomHeroSet<T extends { assetId: string }>(
  sets: readonly T[],
  previousAssetId: string | undefined,
  random: () => number = Math.random,
): T {
  return sets.find((set) => set.assetId === previousAssetId)
    ?? sets[Math.min(sets.length - 1, Math.floor(random() * sets.length))];
}

/** Returns an isolated snapshot so consumers cannot mutate the reactive source.
    A room with several sets yields the one picked for this session. */
export function roomHeroConfig(roomId: string | null | undefined): RoomHeroConfig | null {
  if (!roomId || !Object.prototype.hasOwnProperty.call(configs, roomId)) return null;
  const config = configs[roomId];
  if (!config?.alternates?.length) return cloneRoomHero(config);
  const set = pickRoomHeroSet([config, ...config.alternates], shown.get(roomId));
  shown.set(roomId, set.assetId);
  return cloneRoomHero({ assetId: set.assetId, focus: set.focus });
}

/** Every set assigned to the room, primary first, regardless of the pick. */
export function roomHeroSets(roomId: string): RoomHeroSet[] {
  const config = cloneRoomHero(Object.prototype.hasOwnProperty.call(configs, roomId) ? configs[roomId] : null);
  return config ? [config, ...(config.alternates ?? [])].map(({ assetId, focus }) => ({ assetId, focus })) : [];
}

/** Atomically replaces the complete runtime projection. */
export function replaceRoomHeroConfigs(projection: RoomHeroConfigProjection): void {
  configs = cloneProjection(projection);
}

/** Assignment-response seam: immediately sets or clears one room assignment. */
export function setRoomHeroConfig(roomId: string, config: RoomHeroConfig | null): void {
  /* Adding a set to a room that shows a single picture keeps that picture. */
  const current = configs[roomId];
  if (current && !current.alternates?.length && !shown.has(roomId)) shown.set(roomId, current.assetId);
  configs = { ...configs, [roomId]: cloneRoomHero(config) };
}

export function clearRoomHeroConfig(roomId: string): void {
  setRoomHeroConfig(roomId, null);
}
