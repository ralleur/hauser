/* SPDX-License-Identifier: AGPL-3.0-only */

/* Raum umbenennen (wie die iOS-App): direkt in der Raum-Konfiguration. Der
   Server schreibt den Namen in den Haushalt, ETag-gesichert wie die übrigen
   Haushaltsänderungen; danach heißt der Raum sofort überall so. Die Demo hat
   keinen Server und benennt nur für diese Sitzung um. */
import { ROOM_SEED, appState } from './app.svelte.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';

export const ROOM_NAME_MAX = 60;

export function cleanRoomName(value: string): string | null {
  const name = value.replace(/\s+/g, ' ').trim();
  return name && name.length <= ROOM_NAME_MAX ? name : null;
}

/* Auch die Vorlage, aus der die Raumliste bei jeder Geräteänderung neu
   entsteht — sonst spränge der Name dann zurück. */
function applyLocally(roomId: string, name: string): void {
  const seed = ROOM_SEED.find((entry) => entry.id === roomId);
  if (seed) seed.name = name;
  const room = appState.rooms.find((entry) => entry.id === roomId);
  if (room) room.name = name;
}

export async function renameRoom(roomId: string, value: string): Promise<boolean> {
  const name = cleanRoomName(value);
  if (!name) return false;
  if (IS_DEMO) { applyLocally(roomId, name); return true; }
  try {
    const current = await fetch('/api/household-config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!current.ok) return false;
    await current.text();
    const etag = current.headers.get('etag');
    if (!etag) return false;
    const response = await fetch('/api/household-room-name', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify({ roomId, name }),
    });
    if (!response.ok) return false;
    applyLocally(roomId, name);
    return true;
  } catch {
    return false;
  }
}
