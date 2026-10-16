/* Die Wahl „zählt für die Glühbirne" für mehrere Geräte. Eigenes Modul, damit
   der Startpfad nur das kleine `countsForBulb` trägt (Performance-Budget). */
import {
  cloneDeviceConfig,
  isGroupEntityId,
  isManagedEntityId,
  type DeviceCategory,
  type DeviceConfig,
} from './device-config.ts';

/* Geräte, für die die Wahl „zählt für die Glühbirne" angeboten wird: was dort
   überhaupt mitgezählt werden könnte, ohne lokale Gruppen. */
export function isBulbCandidate(device: { entityId: string; category?: DeviceCategory }): boolean {
  return ['light', 'switch', 'cover', 'vacuum'].includes(device.category ?? 'light') && !isGroupEntityId(device.entityId);
}

/* Alle Geräte eines Raums auf einmal: `onlyLights` zählt nur Lampen, sonst
   zählt alles. Ein einziges neues DeviceConfig, damit der Aufrufer einmal speichert. */
export function setRoomCountsAsLight(
  config: DeviceConfig,
  devices: readonly { entityId: string; domain?: string; category?: DeviceCategory }[],
  onlyLights: boolean,
): DeviceConfig {
  const next = cloneDeviceConfig(config);
  for (const device of devices) {
    if (!isBulbCandidate(device) || !isManagedEntityId(device.entityId)) continue;
    next.devices[device.entityId] = {
      ...(next.devices[device.entityId] ?? {}),
      countsAsLight: !onlyLights || (device.domain ?? 'light') === 'light',
    };
  }
  return next;
}
