/* ── Cloudflare Workers AI als Bildanbieter ──
   Das freie Tageskontingent des Nutzers (10.000 Neuronen) zeichnet mit
   FLUX.2 klein Bild-zu-Bild: Konto-ID und Token kommen aus der
   Zugangskonfiguration, das Referenzfoto muss unter 512 px liegen, die
   Antwort ist JSON mit dem Bild als Base64. Nur Komposition und Tagbild gehen
   ans Modell; Abend, Nacht und trüb entstehen lokal aus dem Tagbild
   (`room-image-darken.mjs`) — das schont das Kontingent und hält die
   Fassungen deckungsgleich. Der Rest der Pipeline sieht keinen Unterschied:
   dieselbe Schnittstelle wie der OpenAI-Provider, PNG heraus. */

import { sharp } from './runtime-env.mjs';
import { DARKEN_PHASES, darkenRoomImage } from './room-image-darken.mjs';

export const CLOUDFLARE_ROOM_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4/accounts';
const REFERENCE_EDGE = 500;
const OUTPUT = Object.freeze({ width: 1536, height: 1024 });
const MAX_RESPONSE_BYTES = 40_000_000;

export function validCloudflareAccountId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value.trim().toLowerCase());
}

function httpErrorCode(status) {
  if (status === 401) return 'PROVIDER_CREDENTIAL_INVALID';
  if (status === 403) return 'PROVIDER_FORBIDDEN';
  if (status === 402 || status === 429) return 'PROVIDER_QUOTA_OR_RATE_LIMIT';
  if (status === 422 || status === 400) return 'PROVIDER_IMAGE_REJECTED';
  return 'PROVIDER_HTTP_ERROR';
}

function localError() {
  return Object.assign(new Error('Room-image provider request was not sent'), { code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT' });
}

function unknownError() {
  return Object.assign(new Error('Room-image provider outcome is unknown'), { code: 'PROVIDER_OUTCOME_UNKNOWN' });
}

export function createCloudflareRoomImageProvider({ credential, fetchImpl = globalThis.fetch } = {}) {
  const accountId = typeof credential?.accountId === 'string' ? credential.accountId.trim().toLowerCase() : '';
  const apiToken = typeof credential?.apiToken === 'string' ? credential.apiToken.trim() : '';
  if (!validCloudflareAccountId(accountId) || !apiToken) throw new TypeError('Cloudflare credential is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('Room-image provider fetch boundary is required');
  const base = `${CLOUDFLARE_API}/${accountId}/ai`;
  const headers = () => ({ Authorization: `Bearer ${apiToken}` });

  async function probe({ signal } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}/models/search?search=flux-2-klein-4b`, { method: 'GET', headers: headers(), signal });
    } catch {
      return { definitiveResponse: false, imageCapability: 'unreachable', modelVisible: false };
    }
    try { await response.body?.cancel?.(); } catch { /* body already consumed or absent */ }
    if (response.status === 200) return { definitiveResponse: true, status: 200, imageCapability: 'unverified', modelVisible: true };
    if (response.status === 401) {
      return { definitiveResponse: true, status: 401, imageCapability: 'credential_invalid', modelVisible: false, errorCode: 'PROVIDER_CREDENTIAL_INVALID' };
    }
    if (response.status === 403) {
      return { definitiveResponse: true, status: 403, imageCapability: 'forbidden', modelVisible: false, errorCode: 'PROVIDER_FORBIDDEN' };
    }
    return { definitiveResponse: true, status: response.status, imageCapability: 'unreachable', modelVisible: false };
  }

  async function edit({ phase, prompt, input, signal } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || !(input instanceof Uint8Array) || input.byteLength < 1) {
      throw localError();
    }
    if (DARKEN_PHASES.includes(phase)) {
      try {
        const png = await darkenRoomImage(input, phase).png().toBuffer();
        return { definitiveResponse: true, status: 200, image: new Uint8Array(png) };
      } catch {
        return { definitiveResponse: true, status: 500, errorCode: 'PROVIDER_INVALID_RESPONSE' };
      }
    }
    let reference;
    try {
      reference = await sharp(Buffer.from(input))
        .resize({ width: REFERENCE_EDGE, height: REFERENCE_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw localError();
    }
    const body = new FormData();
    body.append('prompt', prompt);
    body.append('width', String(OUTPUT.width));
    body.append('height', String(OUTPUT.height));
    body.append('input_image_0', new Blob([reference], { type: 'image/jpeg' }), 'room-image-input.jpg');

    let response;
    try {
      response = await fetchImpl(`${base}/run/${CLOUDFLARE_ROOM_IMAGE_MODEL}`, { method: 'POST', headers: headers(), body, signal });
    } catch {
      throw unknownError();
    }
    if (response.status < 200 || response.status >= 300) {
      try { await response.body?.cancel?.(); } catch { /* nothing to release */ }
      return { definitiveResponse: true, status: response.status, errorCode: httpErrorCode(response.status) };
    }
    let raw;
    try {
      raw = Buffer.from(await response.arrayBuffer());
    } catch {
      throw unknownError();
    }
    if (raw.byteLength < 1 || raw.byteLength > MAX_RESPONSE_BYTES) {
      return { definitiveResponse: true, status: response.status, errorCode: 'PROVIDER_INVALID_RESPONSE' };
    }
    /* Rohes Bild, falls der Dienst es so liefert; sonst `result.image` als Base64. */
    let imageBytes = raw;
    if (!(response.headers?.get?.('content-type') ?? '').startsWith('image/')) {
      try {
        const payload = JSON.parse(raw.toString('utf8'));
        const encoded = payload?.result?.image;
        imageBytes = typeof encoded === 'string' && encoded ? Buffer.from(encoded, 'base64') : null;
      } catch {
        imageBytes = null;
      }
    }
    if (!imageBytes?.byteLength) return { definitiveResponse: true, status: response.status, errorCode: 'PROVIDER_INVALID_RESPONSE' };
    try {
      const png = await sharp(imageBytes).removeAlpha().toColourspace('srgb').png().toBuffer();
      return { definitiveResponse: true, status: response.status, image: new Uint8Array(png) };
    } catch {
      return { definitiveResponse: true, status: response.status, errorCode: 'PROVIDER_INVALID_RESPONSE' };
    }
  }

  return Object.freeze({ available: true, edit, probe });
}
