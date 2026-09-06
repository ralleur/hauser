import { m } from '../../paraglide/messages.js';
import type { RoomImageFocus } from './room-image-client.ts';
import { setRoomHeroConfig } from './room-hero-config.svelte.ts';

/* Die öffentliche Demo hat keinen Companion-Server; die Bibliothek kommt aus
   vorbereiteten Assets. Dynamischer Import: kein Demo-Code im Produktbundle. */
const IS_DEMO = import.meta.env?.VITE_DEMO === '1';

/* Erkannte Flächen eines Bildsets (Paket 13): Polygone in Bildanteilen, 0…1,
   je mit einer Art. Fehlt das Feld, wurde für dieses Set noch nie erkannt.
   Die Arten kommen vom Server (`REGION_KINDS`); der Client hält sie als freie
   Zeichenkette, damit eine neue Art hier keinen Umbau erzwingt. */
export type RoomImageRegionKind =
  | 'window' | 'floor' | 'seating' | 'table' | 'desk' | 'bed' | 'tv'
  | 'mirror' | 'bath' | 'appliance' | 'bin' | 'toy';

export interface RoomImageRegion {
  kind: RoomImageRegionKind;
  points: { x: number; y: number }[];
}

export interface RoomImageRegions {
  detectedAt: string;
  source: 'model' | 'manual';
  regions: RoomImageRegion[];
}

export interface RoomImageLibraryAsset {
  assetId: string;
  variants: { light: string; dark: string; darkOff: string };
  focus: RoomImageFocus;
  createdAt: string;
  byteLength: number;
  assignedRoomIds: string[];
  regions?: RoomImageRegions;
}

export interface RoomImageLibrary {
  assets: RoomImageLibraryAsset[];
  totalByteLength: number;
  householdEtag: string;
}

export class RoomImageLibraryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RoomImageLibraryError';
  }
}

function libraryError(code: string, message: string): RoomImageLibraryError {
  return new RoomImageLibraryError(code, message);
}

async function readError(response: Response, fallback: string): Promise<RoomImageLibraryError> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'code' in payload && 'message' in payload) {
      const { code, message } = payload as { code: unknown; message: unknown };
      if (typeof code === 'string' && typeof message === 'string' && message) {
        return libraryError(code, message);
      }
    }
  } catch { /* Fehlerkörper ist best effort. */ }
  return libraryError('HTTP_ERROR', fallback);
}

function isAsset(value: unknown): value is RoomImageLibraryAsset {
  if (!value || typeof value !== 'object') return false;
  const asset = value as Record<string, unknown>;
  return typeof asset.assetId === 'string'
    && typeof asset.createdAt === 'string'
    && typeof asset.byteLength === 'number'
    && Array.isArray(asset.assignedRoomIds)
    && Boolean(asset.variants) && typeof asset.variants === 'object'
    && Boolean(asset.focus) && typeof asset.focus === 'object';
}

export async function loadRoomImageLibrary(): Promise<RoomImageLibrary> {
  if (IS_DEMO) return (await import('../demo/demo-room-images.ts')).demoRoomImageLibrary();
  const response = await fetch('/api/room-image-assets', {
    method: 'GET', credentials: 'same-origin',
  });
  if (!response.ok) throw await readError(response, 'Die Bildset-Bibliothek konnte nicht geladen werden.');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') throw libraryError('INVALID_RESPONSE', m.rimg_err_library_response());
  const { assets, totalByteLength, householdEtag } = payload as Record<string, unknown>;
  if (!Array.isArray(assets) || !assets.every(isAsset) || typeof householdEtag !== 'string') {
    throw libraryError('INVALID_RESPONSE', m.rimg_err_library_response());
  }
  return {
    assets,
    totalByteLength: typeof totalByteLength === 'number' ? totalByteLength : 0,
    householdEtag,
  };
}

/** Weist einem Raum ein Bildset zu; `asset: null` entfernt die Zuweisung.
    Der Household-ETag verhindert das Überschreiben fremder Änderungen.

    Nach dem Server wird die laufende Projektion nachgezogen — sonst zeigt die
    Bühne bis zum nächsten Neuladen weiter das alte Bild. Denselben Weg geht der
    manuelle Upload in `room-background-client.ts`. */
export async function assignRoomImage(
  roomId: string,
  asset: { assetId: string; focus: RoomImageFocus } | null,
  householdEtag: string,
): Promise<void> {
  if (IS_DEMO) {
    (await import('../demo/demo-room-images.ts')).demoAssignRoomImage(roomId, asset?.assetId ?? null);
    applyAssignmentToProjection(roomId, asset);
    return;
  }
  const response = await fetch(`/api/room-image-assignments/${encodeURIComponent(roomId)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'If-Match': householdEtag },
    body: JSON.stringify({ asset }),
  });
  if (!response.ok) throw await readError(response, 'Die Zuweisung ist fehlgeschlagen.');
  applyAssignmentToProjection(roomId, asset);
}

function applyAssignmentToProjection(
  roomId: string,
  asset: { assetId: string; focus: RoomImageFocus } | null,
): void {
  setRoomHeroConfig(roomId, asset
    ? {
        assetId: asset.assetId,
        focus: {
          panel: { x: asset.focus.panel.x, y: asset.focus.panel.y },
          phone: { x: asset.focus.phone.x, y: asset.focus.phone.y },
        },
      }
    : null);
}

export async function deleteRoomImageAsset(assetId: string): Promise<void> {
  if (IS_DEMO) {
    (await import('../demo/demo-room-images.ts')).demoDeleteRoomImageAsset(assetId);
    return;
  }
  const response = await fetch(`/api/room-image-assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE', credentials: 'same-origin',
  });
  if (!response.ok) throw await readError(response, m.rimg_err_delete_set());
}

export function formatRoomImageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${megabytes.toFixed(1)} MB`;
}

/* ── Flächenerkennung anstoßen (Paket 13) ──
   Kostet einen Modellaufruf und schreibt den Katalog; deshalb nur von Hand aus
   der Diagnose oder nachts vom Server. Die Antwort trägt den neuen Stand
   zurück, damit die Ansicht sofort zeichnen kann. */
export async function detectRoomImageRegions(assetId: string): Promise<RoomImageRegions> {
  const response = await fetch(`/api/room-image-assets/${encodeURIComponent(assetId)}/regions`, {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw await readError(response, m.rimg_regions_failed());
  const payload: unknown = await response.json();
  const regions = (payload as { regions?: unknown } | null)?.regions;
  if (!regions || typeof regions !== 'object' || !Array.isArray((regions as RoomImageRegions).regions)) {
    throw libraryError('INVALID_RESPONSE', m.rimg_regions_failed());
  }
  return regions as RoomImageRegions;
}
