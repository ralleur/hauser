/* Rückmeldungen aus der App (docs/23 R40): das Fragezeichen oben rechts.

   Die Oberfläche schickt Art, Text und eine freiwillige Antwortadresse;
   der Server hängt an, was er sicher weiß — Version, Revision, Betriebsart
   des Home-Assistant-Zugangs — und reicht alles an das Postfach weiter
   (Cloudflare Worker, tools/feedback-worker). Kein Token im Add-on: das
   Postfach nimmt ohne Anmeldung an und begrenzt je Absenderadresse. */
import { jsonResponse } from './shared.mjs';

/* Adresse des Postfachs (Cloudflare Worker `hauser-feedback`). Eine leere
   `HMI_FEEDBACK_URL` schaltet den Versand ab: der Server antwortet 503 und das
   Blatt sagt „nicht angekommen". */
export const FEEDBACK_POSTBOX_URL = 'HMI_FEEDBACK_URL' in process.env
  ? process.env.HMI_FEEDBACK_URL
  : 'https://hauser-feedback.imhauser.workers.dev/v1/feedback';
const POSTBOX_TIMEOUT_MS = 10_000;
const TEXT_MAX = 2000;
const BODY_MAX = 16 * 1024;
const FIELD_MAX = 300;
const CLIENT_FIELDS = ['contact', 'language', 'viewport', 'userAgent', 'screen', 'connection'];

function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Prüft die Meldung der Oberfläche und ergänzt die Serverwerte — oder `null`. */
export function feedbackEnvelope(payload, { buildInfo = {}, haConnectionMode = 'direct' } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const kind = payload.kind === 'problem' || payload.kind === 'wish' ? payload.kind : null;
  const text = clip(payload.text, TEXT_MAX).trim();
  if (!kind || !text) return null;
  const envelope = {
    kind,
    text,
    version: clip(buildInfo.version, FIELD_MAX),
    revision: clip(buildInfo.revision, FIELD_MAX),
    haMode: clip(haConnectionMode, FIELD_MAX),
  };
  for (const field of CLIENT_FIELDS) envelope[field] = clip(payload[field], FIELD_MAX);
  return envelope;
}

export function createFeedbackService({
  postboxUrl = FEEDBACK_POSTBOX_URL,
  buildInfo = {},
  haConnectionMode = 'direct',
  fetchImpl = fetch,
} = {}) {
  return {
    async send(payload) {
      const envelope = feedbackEnvelope(payload, { buildInfo, haConnectionMode });
      if (!envelope) return { ok: false, status: 400, code: 'FEEDBACK_INVALID', message: 'Art und Text fehlen.' };
      if (!postboxUrl) return { ok: false, status: 503, code: 'FEEDBACK_POSTBOX_UNCONFIGURED', message: 'Kein Postfach eingerichtet.' };
      let response;
      try {
        response = await fetchImpl(postboxUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(envelope),
          signal: AbortSignal.timeout(POSTBOX_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, status: 502, code: 'FEEDBACK_POSTBOX_UNREACHABLE', message: 'Das Postfach ist nicht erreichbar.' };
      }
      if (response.status === 429) return { ok: false, status: 429, code: 'FEEDBACK_TOO_MANY', message: 'Genug für jetzt.' };
      if (!response.ok) return { ok: false, status: 502, code: 'FEEDBACK_POSTBOX_FAILED', message: 'Das Postfach hat die Meldung nicht angenommen.' };
      return { ok: true, status: 200 };
    },
  };
}

export function serveFeedback(req, res, service) {
  if (req.method !== 'POST') {
    jsonResponse(res, 405, { ok: false, code: 'FEEDBACK_METHOD_NOT_ALLOWED', message: 'Nur POST.' }, { allow: 'POST' });
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
    if (oversized) return jsonResponse(res, 413, { ok: false, code: 'FEEDBACK_TOO_LARGE', message: 'Die Meldung ist zu lang.' });
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    void service.send(payload).then((result) => {
      const { status, ...rest } = result;
      jsonResponse(res, status, rest);
    });
  });
}
