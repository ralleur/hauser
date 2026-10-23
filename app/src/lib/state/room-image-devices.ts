// SPDX-License-Identifier: AGPL-3.0-only
import type { Room, Light } from './app.svelte.ts';
import { climateEntityId } from './entities.ts';
import { m } from '../../paraglide/messages.js';

/** The room's climate card is separate from its tile array, but also needs a target. */
export function roomImageDevices(room: Room | null | undefined): Light[] {
  if (!room) return [];
  const climate = climateEntityId(room.id);
  if (!climate || room.lights.some(device => device.entityId === climate)) return room.lights;
  return [...room.lights, { id: `image-climate-${room.id}`, entityId: climate, domain: 'climate', category: 'temp', name: m.cat_temp(), dimmable: false, icon: 'i-thermometer' }];
}
