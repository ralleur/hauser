/* ── Letztes Kamera-Standbild (Paket 5, docs/20) ──

   Ein Kamerabild braucht nach dem Kaltstart mehrere Sekunden: erst muss die
   Entität da sein, dann holt Home Assistant das Standbild über ffmpeg. Bis
   dahin zeigte die Kachel eine leere Fläche. Der Snapshot legt das zuletzt
   gesehene Bild verkleinert ab (IndexedDB, weil ein Data-URL die
   localStorage-Grenze sprengt) und füllt die Lücke, bis das erste frische
   Bild geladen ist. */

import { createSnapshotStore, type SnapshotStore } from '../data/query-cache.ts';

const STILL_MAX_AGE_MS = 10 * 60 * 1000;
const STILL_SAVE_INTERVAL_MS = 60 * 1000;
/* Nur ein Platzhalter für Sekundenbruchteile: schmaler und stärker komprimiert
   als das Original, damit das Schreiben keinen Frame kostet. */
const STILL_MAX_WIDTH = 640;
const STILL_QUALITY = 0.6;

const stores = new Map<string, SnapshotStore<string>>();
const lastSavedAt = new Map<string, number>();

function storeFor(entityId: string): SnapshotStore<string> {
  const existing = stores.get(entityId);
  if (existing) return existing;
  const store = createSnapshotStore<string>({
    key: `hmi:camera-still:${entityId}`,
    tier: 'indexeddb',
    maxAgeMs: STILL_MAX_AGE_MS,
    validate: (value): value is string => typeof value === 'string' && value.startsWith('data:image/'),
  });
  stores.set(entityId, store);
  return store;
}

export async function restoreCameraStill(entityId: string): Promise<string | null> {
  const restored = await storeFor(entityId).restore();
  return restored?.value ?? null;
}

/** Verkleinert das geladene Bild und legt es ab — höchstens einmal pro Minute. */
export function rememberCameraStill(
  entityId: string,
  image: HTMLImageElement,
  now = Date.now(),
): void {
  if (now - (lastSavedAt.get(entityId) ?? 0) < STILL_SAVE_INTERVAL_MS) return;
  lastSavedAt.set(entityId, now);
  const dataUrl = encodeStill(image);
  if (dataUrl) void storeFor(entityId).save(dataUrl, now);
}

function encodeStill(image: HTMLImageElement): string | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height || typeof document === 'undefined') return null;
  const scale = Math.min(1, STILL_MAX_WIDTH / width);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', STILL_QUALITY);
  } catch {
    /* Getaintete Canvas (Bild ohne CORS-Freigabe) oder kein 2D-Kontext:
       dann gibt es eben kein gespeichertes Standbild. */
    return null;
  }
}
