import { reapplyDemoNames } from '../demo/demo-mode.ts';
import { runtime } from '../adapter/runtime.svelte.ts';
import { appState, ROOM_SEED } from './app.svelte.ts';
import {
  assignDeviceRoom,
  buildRuntimeRooms,
  cloneDeviceConfig,
  loadDeviceConfig,
  mergeCatalog,
  saveDeviceConfig,
  seedCatalog,
  setDeviceName,
  setDeviceVisibility,
  setRoomOrder,
  type DeviceConfig,
  type EntityCatalogItem,
} from './device-config.ts';

const seedItems = seedCatalog(ROOM_SEED);

export const deviceManager = $state({
  config: loadDeviceConfig(),
  catalog: mergeCatalog(seedItems, []),
});

let subscribed = false;

export function initDeviceManager(): void {
  if (subscribed) return;
  subscribed = true;
  runtime.subscribeCatalog((items) => {
    deviceManager.catalog = mergeCatalog(seedItems, items as EntityCatalogItem[]);
    applyProjection();
  });
  applyProjection();
}

export function configuredDeviceConfig(): DeviceConfig {
  return cloneDeviceConfig(deviceManager.config);
}

export function hideDevice(entityId: string): void {
  updateConfig(setDeviceVisibility(deviceManager.config, entityId, false));
}

/* Fügt ein Katalog-Gerät ans Ende eines Raums an. `currentOrder` ist die aktuell
   ANGEZEIGTE Reihenfolge des Raums — assignDeviceRoom alleine würde bei leerer
   config.order das neue Gerät an Position 1 statt ans Ende ranken. */
export function addDeviceToRoom(entityId: string, roomId: string, currentOrder: readonly string[]): void {
  const assigned = assignDeviceRoom(deviceManager.config, entityId, roomId);
  updateConfig(setRoomOrder(assigned, roomId, [...currentOrder.filter((id) => id !== entityId), entityId]));
}

export function setRoomDeviceOrder(roomId: string, entityIds: readonly string[]): void {
  updateConfig(setRoomOrder(deviceManager.config, roomId, entityIds));
}

export async function renameDevice(entityId: string, name: string): Promise<void> {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) return;
  await runtime.renameEntity(entityId, normalized);
  updateConfig(setDeviceName(deviceManager.config, entityId, normalized));
}

function updateConfig(config: DeviceConfig): void {
  deviceManager.config = config;
  saveDeviceConfig(config);
  applyProjection();
}

function applyProjection(): void {
  appState.rooms = buildRuntimeRooms(ROOM_SEED, deviceManager.catalog, deviceManager.config);
  reapplyDemoNames(appState.rooms);
}
