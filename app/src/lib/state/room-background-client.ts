import type { RoomHeroConfig } from '../config/household-config.ts';
import { setRoomHeroConfig } from './room-hero-config.svelte.ts';

const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

interface AssignmentResponse {
  roomId: string;
  hero: RoomHeroConfig | null;
  etag: string;
}

async function householdEtag(): Promise<string> {
  const response = await fetch('/api/household-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const etag = response.headers.get('etag');
  if (!response.ok || !etag) throw new Error('Die Haushaltskonfiguration ist nicht verfügbar.');
  await response.arrayBuffer();
  return etag;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: unknown };
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  } catch { /* use stable fallback */ }
  return 'Das Raumbild konnte nicht gespeichert werden.';
}

async function mutate(roomId: string, method: 'POST' | 'DELETE', file?: File): Promise<RoomHeroConfig | null> {
  if (!/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/.test(roomId)) throw new Error('Ungültiger Raum.');
  if (file && (!MIME_TYPES.has(file.type) || file.size === 0 || file.size > 12_582_912)) {
    throw new Error('Bitte JPEG, PNG, WebP oder AVIF mit maximal 12 MiB wählen.');
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const etag = await householdEtag();
    const response = await fetch(`/api/room-backgrounds/${encodeURIComponent(roomId)}`, {
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
      throw new Error('Die Raumbild-Antwort ist ungültig.');
    }
    setRoomHeroConfig(roomId, payload.hero);
    return payload.hero;
  }
  throw new Error('Die Haushaltskonfiguration wurde gleichzeitig geändert. Bitte erneut versuchen.');
}

export function uploadRoomBackground(roomId: string, file: File): Promise<RoomHeroConfig | null> {
  return mutate(roomId, 'POST', file);
}

export function removeRoomBackground(roomId: string): Promise<RoomHeroConfig | null> {
  return mutate(roomId, 'DELETE');
}
