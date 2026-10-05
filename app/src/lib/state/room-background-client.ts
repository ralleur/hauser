import { m } from '../../paraglide/messages.js';
import type { RoomHeroConfig } from '../config/household-config.ts';
import { setRoomHeroConfig } from './room-hero-config.svelte.ts';

const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export type RoomBackgroundVariant = 'light' | 'dark' | 'dark-off' | 'overcast';

interface AssignmentResponse {
  roomId: string;
  hero: RoomHeroConfig | null;
  etag: string;
  /** Selbst gezeichnet (R55): welche Fassungen der Nutzer selbst mitgebracht hat. */
  manual?: { own: string[] };
}

async function householdEtag(): Promise<string> {
  const response = await fetch('/api/household-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const etag = response.headers.get('etag');
  if (!response.ok || !etag) throw new Error(m.rimg_err_config_unavailable());
  await response.arrayBuffer();
  return etag;
}

/* Der Server weiß beim Start, ob die Bildbibliothek auf diesem Gerät läuft.
   Sagt er, dass sie fehlt, hat der Haushalt nichts falsch gemacht — dann den
   Grund nennen statt der allgemeinen Meldung, die zum Suchen am eigenen Bild
   verleitet. Alles andere bleibt bei der stabilen Übersetzung. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { code?: unknown };
    if (payload?.code === 'IMAGE_LIBRARY_UNAVAILABLE') return m.room_background_no_image_library();
  } catch { /* use stable localized fallback */ }
  return m.room_background_failed();
}

async function mutate(roomId: string, method: 'POST' | 'DELETE', file?: File, variant?: RoomBackgroundVariant, origin?: 'upload' | 'manual'): Promise<AssignmentResponse> {
  if (!/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(roomId)) throw new Error(m.rimg_err_invalid_room());
  if (file && (!MIME_TYPES.has(file.type) || file.size === 0 || file.size > 12_582_912)) {
    throw new Error(m.rimg_err_file_type());
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const etag = await householdEtag();
    const query = variant ? `?variant=${variant}${method === 'DELETE' ? '&derive=1' : ''}${origin ? `&origin=${origin}` : ''}` : '';
    const response = await fetch(`/api/room-backgrounds/${encodeURIComponent(roomId)}${query}`, {
      method,
      headers: {
        'If-Match': etag,
        ...(file ? { 'Content-Type': file.type } : {}),
      },
      ...(file ? { body: file } : {}),
      credentials: 'same-origin',
    });
    if (response.status === 412 && attempt === 0) continue;
    if (!response.ok) throw new Error(await errorMessage(response));
    const payload = await response.json() as AssignmentResponse;
    if (payload.roomId !== roomId || (payload.hero !== null && typeof payload.hero?.assetId !== 'string')) {
      throw new Error(m.rimg_err_room_response());
    }
    setRoomHeroConfig(roomId, payload.hero);
    return payload;
  }
  throw new Error(m.rimg_err_conflict());
}

export async function uploadRoomBackground(roomId: string, file: File): Promise<RoomHeroConfig | null> {
  return (await mutate(roomId, 'POST', file)).hero;
}

export async function removeRoomBackground(roomId: string): Promise<RoomHeroConfig | null> {
  return (await mutate(roomId, 'DELETE')).hero;
}

/* Selbst zeichnen (R55): eine einzelne Fassung hochladen — das Tagbild beginnt
   ein neues Set, Abend, Nacht und trüb ersetzen ihre abgeleitete Fassung. */
export function uploadRoomBackgroundVariant(roomId: string, variant: RoomBackgroundVariant, file: File, origin: 'upload' | 'manual' = 'manual'): Promise<AssignmentResponse> {
  return mutate(roomId, 'POST', file, variant, origin);
}

/** Abend, Nacht und trüb wieder aus dem Tagbild ableiten. */
export function resetRoomBackgroundVariant(roomId: string, variant: Exclude<RoomBackgroundVariant, 'light'>): Promise<AssignmentResponse> {
  return mutate(roomId, 'DELETE', undefined, variant);
}
