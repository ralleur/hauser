import {
  loadImmersionLightConfig,
  saveImmersionLightConfig,
  type ImmersionLightPlacement,
} from './immersion-light.ts';

export const immersionLight = $state({
  config: loadImmersionLightConfig(),
});

export function rehydrateImmersionLight(): void {
  immersionLight.config = loadImmersionLightConfig();
}

export function roomLightPlacements(roomId: string | null | undefined): Record<string, ImmersionLightPlacement> {
  return roomId ? immersionLight.config.rooms[roomId] ?? {} : {};
}

export function setLightPlacement(roomId: string, entityId: string, placement: ImmersionLightPlacement): void {
  immersionLight.config = {
    version: 1,
    rooms: {
      ...immersionLight.config.rooms,
      [roomId]: {
        ...(immersionLight.config.rooms[roomId] ?? {}),
        [entityId]: placement,
      },
    },
  };
  saveImmersionLightConfig(immersionLight.config);
}

export function removeLightPlacement(roomId: string, entityId: string): void {
  const room = { ...(immersionLight.config.rooms[roomId] ?? {}) };
  delete room[entityId];
  const rooms = { ...immersionLight.config.rooms };
  if (Object.keys(room).length) rooms[roomId] = room;
  else delete rooms[roomId];
  immersionLight.config = { version: 1, rooms };
  saveImmersionLightConfig(immersionLight.config);
}
