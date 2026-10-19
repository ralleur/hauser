/* ── Ein Tipp auf ein Gerät ──
   Kachel und Raumbild (Geräte im Bild, Owner 2026-10-19) teilen dieselbe
   Regel: Ein Tipp aufs Gerät im Bild tut genau, was ein Tipp auf seine Kachel
   tut. Deshalb steht sie hier und nicht in der Kachel.

   Schaltbare Kategorien schalten (R28), Rollos mit Tasten auf der Kachel
   öffnen das Detail wie die Fläche neben den Tasten, Schloss, Ventil und
   Alarm öffnen bewusst nur das Detail — ein versehentlicher Tipp darf keine
   Tür entriegeln. Kameras kennen keine Kachel; im Bild holt der Tipp ihr
   Bild nach vorn. */

import type { Light } from './app.svelte.ts';
import type { CoverValue } from '../adapter/types.ts';
import { cameraPopouts } from './camera-popouts.svelte.ts';
import { mergedDevice, toggleDevice } from './commands.ts';
import { openDeviceDetail } from './overlay.svelte.ts';

const TOGGLING = new Set(['light', 'switch', 'fan', 'humidifier', 'cover', 'vacuum', 'mower', 'button']);

/** Schaltet ein Tipp auf die Kachel dieses Geräts (statt das Detail zu öffnen)? */
export function tapToggles(device: Light): boolean {
  return TOGGLING.has(device.category ?? 'light');
}

/** Rollo mit Tasten auf der Kachel: die Kachel selbst öffnet dann das Detail. */
export function coverHasTileButtons(cover: CoverValue | undefined, device: Light): boolean {
  return !!cover && (cover.supportsOpen || cover.supportsClose) && device.coverTile !== 'plain';
}

/** Lampen bekommen im Raumbild eine Lichtzone, alle anderen einen Punkt. */
export function isLamp(device: Light): boolean {
  return (device.category ?? 'light') === 'light';
}

export function tapDevice(roomId: string, device: Light): void {
  const category = device.category ?? 'light';
  if (category === 'camera') {
    cameraPopouts.open(device.entityId, device.name, roomId);
    return;
  }
  if (category === 'cover' && coverHasTileButtons(mergedDevice(roomId, device) as CoverValue | undefined, device)) {
    openDeviceDetail(roomId, device.id);
    return;
  }
  if (tapToggles(device)) toggleDevice(roomId, device);
  else openDeviceDetail(roomId, device.id);
}
