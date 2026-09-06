/* ── Anschluss an den Hero-Decode-Worker (Paket 5, docs/20) ──

   Bisher lief `Image.decode()` im Hauptthread — beim ersten Raumwechsel war
   das der sichtbare Ruckler. Der Worker übernimmt Laden und Dekodieren; die
   Ebene wird erst getauscht, wenn er „fertig“ meldet. Fehlt der Worker
   (Testumgebung, alter Browser) oder antwortet er nicht, gilt unverändert der
   Hauptthread-Pfad aus `room-hero-assets.ts`. */

import { decodeHeroImage, type HeroImageDecoder } from './room-hero-assets.ts';

const WORKER_TIMEOUT_MS = 10_000;

interface DecodeReply {
  id: number;
  ok: boolean;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 0;
const pending = new Map<number, (ok: boolean) => void>();

function ensureWorker(): Worker | null {
  if (worker || workerUnavailable) return worker;
  if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') {
    workerUnavailable = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./hero-decode.worker.ts', import.meta.url));
  } catch {
    workerUnavailable = true;
    return null;
  }
  worker.addEventListener('message', (event: MessageEvent<DecodeReply>) => {
    const reply = event.data;
    const resolve = pending.get(reply?.id);
    if (!resolve) return;
    pending.delete(reply.id);
    resolve(reply.ok === true);
  });
  worker.addEventListener('error', () => {
    /* Der Worker ist verbrannt: alle offenen Anfragen fallen auf den
       Hauptthread zurück, weitere gehen erst gar nicht mehr an ihn. */
    workerUnavailable = true;
    worker?.terminate();
    worker = null;
    for (const [id, resolve] of pending) {
      pending.delete(id);
      resolve(false);
    }
  });
  return worker;
}

function decodeInWorker(url: string): Promise<boolean> {
  const active = ensureWorker();
  if (!active) return Promise.resolve(false);
  const id = ++nextRequestId;
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      if (!pending.delete(id)) return;
      resolve(false);
    }, WORKER_TIMEOUT_MS);
    pending.set(id, (ok) => {
      clearTimeout(timeout);
      resolve(ok);
    });
    active.postMessage({ id, url });
  });
}

/** Dekodiert im Worker; scheitert das, entscheidet der Hauptthread-Pfad. */
export const decodeHeroImageOffThread: HeroImageDecoder = async (url) => {
  if (await decodeInWorker(url)) return;
  await decodeHeroImage(url);
};

/* Testhaken: Worker-Zustand zwischen Fällen zurücksetzen. */
export const __heroDecoderInternals = {
  reset(): void {
    worker?.terminate();
    worker = null;
    workerUnavailable = false;
    pending.clear();
  },
};
