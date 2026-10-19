/* Für welche Geräte das Detail die Wahl „zählt für die Glühbirne" anbietet.
   Eigenes Modul, damit der Startpfad nur das kleine `countsForBulb` trägt
   (Performance-Budget). */
import { isGroupEntityId, type DeviceCategory } from './device-config.ts';

/* Geräte, für die die Wahl „zählt für die Glühbirne" angeboten wird: was dort
   überhaupt mitgezählt werden könnte, ohne lokale Gruppen. */
export function isBulbCandidate(device: { entityId: string; category?: DeviceCategory }): boolean {
  return ['light', 'switch', 'cover', 'vacuum'].includes(device.category ?? 'light') && !isGroupEntityId(device.entityId);
}
