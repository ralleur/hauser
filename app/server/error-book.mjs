/* Das Fehlerbuch (docs/23 R58): was schiefgeht, schreibt sich selbst auf.

   Drei Quellen tragen ein: der Server selbst (jede 500er-Antwort, ein Absturz
   kurz vor dem Ende), die Oberfläche im Browser und die iOS-App — beide über
   `POST /api/errors`. Gleiche Fehler zählen hoch statt sich zu wiederholen.

   Die Grenze sitzt hier, beim Eintragen: Namen, Räume, Werte, Adressen und
   Schlüssel aus dem Haushalt kommen gar nicht erst ins Buch. Was im Buch
   steht, darf das Haus verlassen — automatisch nur, wenn `HMI_ERROR_REPORTS`
   auf `auto` steht (Werkstatt), sonst nur mit dem Fragezeichen, wenn jemand
   es mitschickt. „Keine Telemetrie" (docs/23 §1) bleibt damit wahr. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { jsonResponse } from './shared.mjs';

export const ERROR_BOOK_MAX = 100;
export const ERROR_SEND_INTERVAL_MS = 10 * 60_000;
const DETAIL_MAX = 240;
const WHERE_MAX = 80;
const BODY_MAX = 32 * 1024;
const BATCH_MAX = 50;
const SOURCES = new Set(['server', 'web', 'ios']);

/* Die Domains von Home Assistant: `light.kueche_insel` ist ein Name aus dem
   Haushalt, `state.attributes` ist Code und bleibt lesbar. */
const HA_DOMAINS = 'light|switch|sensor|binary_sensor|climate|cover|fan|lock|media_player|camera|vacuum|valve|humidifier|water_heater|lawn_mower|alarm_control_panel|number|input_number|select|input_select|button|input_button|input_boolean|input_text|input_datetime|text|scene|script|automation|person|device_tracker|zone|weather|calendar|todo|update|siren|remote|event|image|notify|sun|timer|counter|schedule|group|tts|stt|conversation|assist_satellite|date|datetime|time';
const ENTITY_ID = new RegExp(`\\b(?:${HA_DOMAINS})\\.[a-z0-9_]+`, 'g');
const QUOTED = /"([^"\n]{0,200})"|'([^'\n]{0,200})'|„([^“”"\n]{0,200})[“”"]|“([^”\n]{0,200})”|«([^»\n]{0,200})»/g;
/* Kleingeschriebene ASCII-Bezeichner sind Code (`reading 'brightness'`),
   auch als Pfad (`state.attributes`); großgeschriebene, Umlaute und
   Leerzeichen sind Namen aus dem Haushalt. */
const CODE_WORD = /^[a-z_$][A-Za-z0-9_$]{0,40}(?:\.[a-z_$][A-Za-z0-9_$]{0,40}){0,4}$/;

/** Macht einen Fehlertext haushaltsfrei: keine Entitäten, Namen, Werte, Adressen, Schlüssel. */
export function scrubErrorText(value, max = DETAIL_MAX) {
  let text = typeof value === 'string' ? value : '';
  text = text
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<mail>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '/~')
    .replace(ENTITY_ID, '<entity>')
    .replace(QUOTED, (whole, ...groups) => {
      const inner = groups.slice(0, 5).find((group) => group !== undefined) ?? '';
      return CODE_WORD.test(inner) ? whole : '"…"';
    })
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, '<token>')
    .replace(/-?\b\d+[.,]\d+\b|\b\d{5,}\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cleanLabel(value, max) {
  const text = scrubErrorText(value, max);
  return text.replace(/[^\p{L}\p{N} _.:/<>#()-]/gu, '').slice(0, max) || '?';
}

/** Ein Eintrag der Oberfläche oder der App — geprüft, gekürzt, haushaltsfrei — oder `null`. */
export function normalizeErrorInput(input, source) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!SOURCES.has(source)) return null;
  const where = cleanLabel(input.where, WHERE_MAX);
  const kind = cleanLabel(input.kind, 40);
  const detail = scrubErrorText(input.detail);
  const count = Number.isInteger(input.count) && input.count > 0 ? Math.min(input.count, 1_000_000) : 1;
  const fp = createHash('sha1')
    .update(`${source}|${where}|${kind}|${detail.replace(/\d+/g, '#')}`)
    .digest('hex')
    .slice(0, 12);
  return { fp, source, where, kind, detail, count };
}

function readBook(path) {
  if (!path) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed?.entries) ? parsed.entries.filter((entry) => entry && typeof entry.fp === 'string') : [];
  } catch {
    return [];
  }
}

export function createErrorBook({
  path = '',
  max = ERROR_BOOK_MAX,
  version = '',
  now = () => new Date().toISOString(),
} = {}) {
  const entries = new Map(readBook(path).map((entry) => [entry.fp, entry]));

  function save() {
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify({ entries: [...entries.values()] }));
      renameSync(`${path}.tmp`, path);
    } catch { /* Ein Buch, das nicht schreiben kann, darf das Haus nicht aufhalten. */ }
  }

  function record(input, source) {
    const entry = normalizeErrorInput(input, source);
    if (!entry) return null;
    const at = now();
    const known = entries.get(entry.fp);
    if (known) {
      known.count += entry.count;
      known.last = at;
      known.sent = false;
      known.version = version;
    } else {
      /* Voll: der am längsten stille Eintrag geht, der neue bleibt. */
      if (entries.size >= max) {
        const oldest = [...entries.values()].sort((a, b) => a.last.localeCompare(b.last))[0];
        entries.delete(oldest.fp);
      }
      entries.set(entry.fp, { ...entry, version, first: at, last: at, sent: false });
    }
    return entries.get(entry.fp);
  }

  return {
    /** Ein Fehler, der hier im Server passiert ist. */
    note(where, error) {
      const result = record({
        where,
        kind: error instanceof Error ? error.name : typeof error,
        detail: error instanceof Error ? error.message : String(error ?? ''),
      }, 'server');
      save();
      return result;
    },
    /** Einträge von Oberfläche oder App; gibt zurück, wie viele angenommen wurden. */
    receive(list, source) {
      if (!Array.isArray(list)) return 0;
      let taken = 0;
      for (const input of list.slice(0, BATCH_MAX)) if (record(input, source)) taken += 1;
      if (taken > 0) save();
      return taken;
    },
    /** Das Buch, neueste zuerst — so, wie es das Haus verlassen darf. */
    list() {
      return [...entries.values()]
        .sort((a, b) => b.last.localeCompare(a.last))
        .map(({ sent: _sent, ...entry }) => entry);
    },
    unsent() {
      return this.list().filter((entry) => !entries.get(entry.fp)?.sent);
    },
    markSent(fps) {
      for (const fp of fps) {
        const entry = entries.get(fp);
        if (entry) entry.sent = true;
      }
      save();
    },
  };
}

/* Werkstatt: das Buch geht von selbst ins Postfach, gebündelt alle zehn
   Minuten. Antwortet das Postfach nicht, bleibt alles liegen und geht beim
   nächsten Mal mit — der Haushalt merkt davon nichts. */
export function startErrorReports(book, { mode = process.env.HMI_ERROR_REPORTS, send, intervalMs = ERROR_SEND_INTERVAL_MS } = {}) {
  if (mode !== 'auto' || typeof send !== 'function') return () => {};
  let running = false;
  const tick = async () => {
    const pending = book.unsent();
    if (running || pending.length === 0) return;
    running = true;
    try {
      const result = await send(pending);
      if (result?.ok) book.markSent(pending.map((entry) => entry.fp));
    } catch { /* nächstes Mal */ } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function serveErrors(req, res, book) {
  if (req.method === 'GET') {
    jsonResponse(res, 200, { ok: true, entries: book.list() });
    return;
  }
  if (req.method !== 'POST') {
    jsonResponse(res, 405, { ok: false, code: 'ERRORS_METHOD_NOT_ALLOWED', message: 'Nur GET und POST.' }, { allow: 'GET, POST' });
    return;
  }
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > BODY_MAX) oversized = true;
  });
  req.on('end', () => {
    if (oversized) return jsonResponse(res, 413, { ok: false, code: 'ERRORS_TOO_LARGE', message: 'Zu viele Einträge auf einmal.' });
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const source = payload?.source === 'ios' ? 'ios' : 'web';
    const taken = book.receive(payload?.errors, source);
    jsonResponse(res, 200, { ok: true, taken });
  });
}
