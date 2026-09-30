/* SPDX-License-Identifier: AGPL-3.0-only */
import { ROOM_SEED } from './app.svelte.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';
import { cleanRoomName } from './room-rename.ts';

/* R56: Ein neuer Bereich in Home Assistant wird ein Raum. Der Server legt ihn
   an oder nennt den Raum, der schon so heißt; danach steht er auch in der
   Vorlage, aus der die Raumliste bei jeder Geräteänderung neu entsteht. Die
   Demo legt keine Räume an. Eigenes Modul, das erst bei Bedarf lädt — es
   gehört nicht in den Telefonstart. */
export async function createRoomForArea(value: string): Promise<boolean> {
  const name = cleanRoomName(value);
  if (!name || IS_DEMO) return false;
  try {
    const current = await fetch('/api/household-config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!current.ok) return false;
    await current.text();
    const etag = current.headers.get('etag');
    if (!etag) return false;
    const response = await fetch('/api/household-room', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) return false;
    const room = await response.json() as { roomId?: unknown; name?: unknown };
    if (typeof room.roomId !== 'string' || typeof room.name !== 'string') return false;
    if (!ROOM_SEED.some((entry) => entry.id === room.roomId)) {
      ROOM_SEED.push({ id: room.roomId, name: room.name, presence: false, windowOpen: false, lights: [] });
    }
    return true;
  } catch {
    return false;
  }
}
