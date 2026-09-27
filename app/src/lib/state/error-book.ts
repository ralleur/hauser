/* ============================================
   Fehlerbuch der Oberfläche (docs/23 R58).
   --------------------------------------------
   Was im Browser schiefgeht, geht ans Fehlerbuch des Servers statt in eine
   Konsole, in die niemand schaut: ungefangene Fehler, abgelehnte Promises,
   Bereiche, die nicht aufbauen, Geräte, die der Adapter nicht versteht.
   Gleiche Fehler zählen hier schon hoch; gesammelt wird fünf Sekunden, dann
   geht ein Bündel an `/api/errors`. Namen und Werte entfernt der Server beim
   Eintragen — dort sitzt die Grenze für alle Quellen.
   ============================================ */
import { IS_DEMO } from '../demo/demo-mode.ts';

interface PendingError { where: string; kind: string; detail: string; count: number }

const FLUSH_MS = 5_000;
const PENDING_MAX = 50;
const pending = new Map<string, PendingError>();
let timer: ReturnType<typeof setTimeout> | null = null;

function describe(error: unknown): { kind: string; detail: string } {
  if (error instanceof Error) return { kind: error.name || 'Error', detail: error.message };
  if (typeof error === 'string') return { kind: 'string', detail: error };
  try {
    return { kind: typeof error, detail: JSON.stringify(error) ?? String(error) };
  } catch {
    return { kind: typeof error, detail: String(error) };
  }
}

async function flush(): Promise<void> {
  timer = null;
  const errors = [...pending.values()];
  pending.clear();
  if (errors.length === 0) return;
  try {
    await fetch('/api/errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'web', errors }),
      keepalive: true,
    });
  } catch { /* Server weg: dann ist das nicht der Fehler, den wir suchen. */ }
}

/** Trägt einen Fehler ein; `where` ist ein fester Ort im Code, nie ein Name aus dem Haushalt. */
export function reportError(where: string, error: unknown): void {
  console.error(`[hauser] ${where}:`, error);
  record(where, error);
}

function record(where: string, error: unknown): void {
  if (IS_DEMO || import.meta.env?.MODE === 'test') return;
  const { kind, detail } = describe(error);
  const key = `${where}|${kind}|${detail}`;
  const known = pending.get(key);
  if (known) known.count += 1;
  else if (pending.size < PENDING_MAX) pending.set(key, { where, kind, detail: detail.slice(0, 500), count: 1 });
  timer ??= setTimeout(() => { void flush(); }, FLUSH_MS);
}

/* Ort eines ungefangenen Fehlers: Datei und Zeile im Bundle, ohne Pfad davor. */
function origin(event: ErrorEvent): string {
  const file = (event.filename || '').split('/').pop()?.split('?')[0] || 'window';
  return `${file}:${event.lineno}:${event.colno}`;
}

let installed = false;

export function installErrorCatcher(): void {
  if (installed) return;
  installed = true;
  addEventListener('error', (event) => {
    /* Ein Bild oder Skript, das nicht lädt, meldet sich ohne `error` — das ist Netz, kein Fehler im Code. */
    if (!(event instanceof ErrorEvent) || (!event.error && !event.message)) return;
    record(origin(event), event.error ?? event.message);
  });
  addEventListener('unhandledrejection', (event) => {
    /* Abbrüche (Zeitlimit, Seitenwechsel) sind gewollt. */
    if (event.reason instanceof DOMException && event.reason.name === 'AbortError') return;
    record('promise', event.reason);
  });
}
