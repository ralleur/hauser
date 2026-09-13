import { reapplyDemoNames } from '../demo/demo-mode.ts';
import { runtime } from '../adapter/runtime.svelte.ts';
import { appState, ROOM_SEED } from './app.svelte.ts';
import {
  assignDeviceRoom,
  buildRuntimeRooms,
  cloneDeviceConfig,
  createGroup,
  dissolveGroup,
  isGroupEntityId,
  loadDeviceConfig,
  mergeCatalog,
  newGroupId,
  saveDeviceConfig,
  seedCatalog,
  setDeviceName,
  setDeviceNameVisibility,
  setDeviceVisibility,
  setRoomOrder,
  updateGroup,
  type DeviceConfig,
  type DeviceGroup,
  type EntityCatalogItem,
} from './device-config.ts';

const seedItems = seedCatalog(ROOM_SEED);

export const deviceManager = $state({
  config: loadDeviceConfig(),
  catalog: mergeCatalog(seedItems, []),
});

/* Gruppen: die Laufzeit fragt hier nach den Mitgliedern einer `group.*`-
   Entität und verteilt Lesen und Schreiben selbst (adapter/runtime). */
runtime.setGroupResolver((entityId) => (isGroupEntityId(entityId) ? deviceManager.config.groups[entityId]?.members ?? null : null));

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
  // Gruppen gibt es nur hier — Home Assistant kennt sie nicht.
  if (isGroupEntityId(entityId)) { updateConfig(updateGroup(deviceManager.config, entityId, { name: normalized })); return; }
  await runtime.renameEntity(entityId, normalized);
  updateConfig(setDeviceName(deviceManager.config, entityId, normalized));
}

/* Sensor-Kachel: Name neben dem Wert zeigen (Vorgabe: nur der Wert). */
export function setDeviceShowName(entityId: string, showName: boolean): void {
  updateConfig(setDeviceNameVisibility(deviceManager.config, entityId, showName));
}

/* ── Gerätegruppen (Owner-Wunsch 2026-09-13) ── */
export function groupOf(entityId: string): DeviceGroup | null {
  return deviceManager.config.groups[entityId] ?? null;
}

/** Legt die Gruppe an Stelle von `origin` an und liefert die Kachel-Id der Gruppe. */
export function createDeviceGroup(input: Omit<DeviceGroup, 'id'>, currentOrder: readonly string[]): string {
  const id = newGroupId(deviceManager.config.groups);
  updateConfig(createGroup(deviceManager.config, { ...input, id }, currentOrder));
  return id;
}

export function updateDeviceGroup(id: string, patch: Partial<Pick<DeviceGroup, 'name' | 'members'>>): void {
  updateConfig(updateGroup(deviceManager.config, id, patch));
}

export function dissolveDeviceGroup(id: string): void {
  updateConfig(dissolveGroup(deviceManager.config, id));
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
