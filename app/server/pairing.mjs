/* Kopplung der Companion-App (Plan 21, Stufe 0).

   Ein Telefon wird über einen Einmalcode gekoppelt, den nur das Wandpanel
   im LAN anzeigt — der QR-Code ist der Anwesenheitsnachweis. Beim Einlösen
   entsteht ein langlebiger Gerätetoken; gespeichert wird nur sein Hash.

   Ein Gerätetoken ersetzt die Origin-Grenze: eine Anfrage mit gültigem Token
   gilt überall dort als freigegeben, wo heute die Browser-Origin geprüft
   wird (`requestOriginAllowed`). Kommt eine Anfrage über den Tunnel
   (Markierung durch den Sidecar), ist der Token Pflicht — ohne ihn bleibt
   nur Health und Build-Info. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { jsonResponse, readSmallJson, requestOriginAllowed } from './shared.mjs';

export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const PAIRING_ROUTE_PREFIX = '/api/pairing';
/* Der Tunnel-Sidecar setzt diesen Header auf jede weitergereichte Anfrage.
   Aus dem LAN kann ihn jeder setzen — das macht die Anfrage nur strenger. */
export const REMOTE_MARKER_HEADER = 'x-hauser-remote';
export const DEVICE_TOKEN_QUERY = 'device_token';
/* Ohne Token bleibt über den Tunnel nur das Nötigste erreichbar. */
export const REMOTE_PUBLIC_PATHS = new Set(['/api/health', '/api/build-info']);

/* Zeichen ohne Verwechslungsgefahr (kein 0/O, 1/I/L), damit der Code zur
   Not auch abgetippt werden kann. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/* Drosseln (Plan 21, Stufe 2): Kopplungsversuche und Token-Fehlversuche
   über den Tunnel werden pro Quelle gezählt. Quelle ist die weitergereichte
   Adresse des Sidecars oder die Socket-Adresse. */
export const CLAIM_LIMIT_PER_MINUTE = 10;
export const TOKEN_FAILURE_LIMIT_PER_MINUTE = 20;

export function requestSource(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req?.socket?.remoteAddress || 'unknown';
}

export function createRateLimiter(limit, { windowMs = 60_000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    /** Zählt einen Treffer; `true`, wenn die Quelle noch im Rahmen ist. */
    hit(source) {
      const t = now();
      const entry = hits.get(source);
      if (!entry || t - entry.start >= windowMs) {
        hits.set(source, { start: t, count: 1 });
        return true;
      }
      entry.count += 1;
      return entry.count <= limit;
    },
    blocked(source) {
      const entry = hits.get(source);
      if (!entry) return false;
      if (now() - entry.start >= windowMs) { hits.delete(source); return false; }
      return entry.count > limit;
    },
  };
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sameHash(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function makeCode(random) {
  const bytes = random(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function trimmed(value, max = 80) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function isRemoteRequest(req) {
  return req?.headers?.[REMOTE_MARKER_HEADER] === '1';
}

/** Token aus `Authorization: Bearer …` oder — für WebSocket-Upgrades, die
    keine Header setzen können — aus `?device_token=`. */
export function bearerToken(req) {
  const header = req?.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  try {
    const url = new URL(req?.url || '/', 'http://hauser.local');
    const token = url.searchParams.get(DEVICE_TOKEN_QUERY);
    if (token) return token;
  } catch { /* ohne gültige URL gibt es keinen Token */ }
  return null;
}

/** Gerätespeicher: `devices.json` neben der Konfiguration, atomar geschrieben. */
export function createDeviceStore(path, { now = Date.now, random = randomBytes } = {}) {
  let state = null;
  const pending = new Map();

  function load() {
    if (state) return state;
    if (path && existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed && Array.isArray(parsed.devices)) {
          state = { version: 1, devices: parsed.devices.filter((d) => d && typeof d.id === 'string' && typeof d.tokenHash === 'string') };
          return state;
        }
      } catch { /* unlesbar → wie leer, aber nichts überschreiben, bevor neu geschrieben wird */ }
    }
    state = { version: 1, devices: [] };
    return state;
  }

  function persist() {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  }

  function sweep() {
    const t = now();
    for (const [code, entry] of pending) if (entry.expiresAt <= t) pending.delete(code);
  }

  function publicDevice(device) {
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      person: device.person ?? null,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt ?? null,
      lastSeenVia: device.lastSeenVia ?? null,
      guest: !!device.guest,
      expiresAt: device.expiresAt ?? null,
    };
  }

  function expired(device) {
    return !!device.expiresAt && Date.parse(device.expiresAt) <= now();
  }

  return {
    path,
    list() {
      return load().devices.map(publicDevice);
    },
    /** Neuer Einmalcode. Ältere offene Codes bleiben bis zu ihrem Ablauf gültig. */
    startPairing({ guest = false, deviceExpiresAt = null } = {}) {
      sweep();
      const code = makeCode(random);
      const expiresAt = now() + PAIRING_CODE_TTL_MS;
      pending.set(code, { expiresAt, guest, deviceExpiresAt });
      return { code, expiresAt, guest };
    },
    /** Code einlösen → Gerät anlegen. Liefert `null` bei unbekanntem oder
        abgelaufenem Code; der Token erscheint genau einmal in der Antwort. */
    claim(code, { name, platform, person } = {}) {
      sweep();
      const normalized = trimmed(code, CODE_LENGTH).toUpperCase();
      if (!normalized || !pending.has(normalized)) return null;
      const entry = pending.get(normalized);
      pending.delete(normalized);
      const devices = load().devices;
      const token = random(32).toString('base64url');
      const device = {
        id: random(8).toString('hex'),
        name: trimmed(name) || (entry.guest ? 'Gast' : 'Telefon'),
        platform: trimmed(platform, 20) || 'unknown',
        person: trimmed(person) || null,
        tokenHash: hashToken(token),
        createdAt: new Date(now()).toISOString(),
        lastSeenAt: null,
        lastSeenVia: null,
        /* Gäste (Hotelmodus, Stufe 7): der Token erlischt mit dem Checkout. */
        guest: !!entry.guest,
        expiresAt: entry.guest && entry.deviceExpiresAt ? new Date(entry.deviceExpiresAt).toISOString() : null,
      };
      devices.push(device);
      persist();
      return { device: publicDevice(device), token };
    },
    /** Person des Geräts ändern (Personen-Kopplung, Stufe 5). */
    setPerson(id, person) {
      const device = load().devices.find((d) => d.id === id);
      if (!device) return null;
      device.person = trimmed(person) || null;
      persist();
      return publicDevice(device);
    },
    revoke(id) {
      const devices = load().devices;
      const index = devices.findIndex((d) => d.id === id);
      if (index < 0) return false;
      devices.splice(index, 1);
      persist();
      return true;
    },
    authenticate(token) {
      if (typeof token !== 'string' || !token) return null;
      const hash = hashToken(token);
      const device = load().devices.find((d) => sameHash(d.tokenHash, hash));
      if (!device || expired(device)) return null;
      return publicDevice(device);
    },
    /** Gäste abmelden — beim Checkout und für abgelaufene Tokens. */
    revokeGuests() {
      const devices = load().devices;
      const before = devices.length;
      state.devices = devices.filter((d) => !d.guest);
      if (state.devices.length !== before) persist();
      return before - state.devices.length;
    },
    /** „Zuletzt gesehen“ — höchstens einmal pro Minute geschrieben, damit ein
        offener WebSocket nicht die Platte beschäftigt. */
    touch(id, via) {
      const device = load().devices.find((d) => d.id === id);
      if (!device) return;
      const t = now();
      const last = device.lastSeenAt ? Date.parse(device.lastSeenAt) : 0;
      if (t - last < 60_000 && device.lastSeenVia === via) return;
      device.lastSeenAt = new Date(t).toISOString();
      device.lastSeenVia = via;
      persist();
    },
    pendingCount() {
      sweep();
      return pending.size;
    },
  };
}

/** Hängt das erkannte Gerät an die Anfrage (`req.hauserDevice`). */
export function authenticateRequest(req, store, { failures = null } = {}) {
  const token = bearerToken(req);
  const device = token ? store.authenticate(token) : null;
  if (device) {
    req.hauserDevice = device;
    store.touch(device.id, isRemoteRequest(req) ? 'remote' : 'lan');
  } else if (token && failures && isRemoteRequest(req)) {
    /* Falscher Token über den Tunnel: zählen; wer rät, wird gesperrt. */
    if (!failures.hit(requestSource(req))) req.hauserThrottled = true;
    console.warn(`[hauser] ungültiger Gerätetoken über den Tunnel von ${requestSource(req)}`);
  }
  return device;
}

/** Tunnel-Anfragen ohne Gerät dürfen nur Health und Build-Info sehen. */
export function remoteGateAllows(req) {
  if (req.hauserThrottled) return false;
  if (!isRemoteRequest(req)) return true;
  if (req.hauserDevice) return true;
  try {
    return REMOTE_PUBLIC_PATHS.has(new URL(req.url || '/', 'http://hauser.local').pathname);
  } catch {
    return false;
  }
}

/* Origins der App-WebViews (Capacitor: iOS `capacitor://`, Android `https://`).
   Der Browser fragt vor jeder Anfrage mit Token per OPTIONS an — ohne
   Token, deshalb gibt der Preflight nichts preis. Daten liefert danach nur,
   wer den Gerätetoken hat; die Origin allein öffnet nichts. */
export const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost', 'ionic://localhost']);

export function isAppOrigin(req) {
  const origin = req?.headers?.origin;
  return typeof origin === 'string' && APP_ORIGINS.has(origin);
}

/** CORS für App-Origins: Preflight sofort beantworten, sonst die Antwort-
    Header nachrüsten. Liefert `true`, wenn die Anfrage damit erledigt ist. */
export function applyAppCors(req, res) {
  if (!isAppOrigin(req)) return false;
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || 'authorization, content-type, if-match, if-none-match',
      'access-control-max-age': '86400',
      vary: 'origin',
    });
    res.end();
    return true;
  }
  const writeHead = res.writeHead;
  res.writeHead = function corsWriteHead(...args) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-expose-headers', 'etag, x-hmi-household-config-mode');
    res.setHeader('vary', 'origin');
    return writeHead.apply(this, args);
  };
  return false;
}

export function remoteGateReject(res, req = null) {
  if (req?.hauserThrottled) {
    jsonResponse(res, 429, {
      ok: false,
      code: 'DEVICE_TOKEN_THROTTLED',
      message: 'Zu viele fehlgeschlagene Anmeldungen — bitte eine Minute warten.',
    }, { 'retry-after': '60' });
    return;
  }
  jsonResponse(res, 401, {
    ok: false,
    code: 'DEVICE_TOKEN_REQUIRED',
    message: 'Über den Fernzugriff ist Hauser nur mit einem gekoppelten Gerät erreichbar.',
  }, { 'www-authenticate': 'Bearer realm="hauser"' });
}

/** QR-Inhalt: eine `hauser://pair`-URL, die die App direkt öffnen kann. */
export function pairingLink({ code, lan, remote }) {
  const params = new URLSearchParams({ v: '1', code });
  if (lan) params.set('lan', lan);
  if (remote) params.set('remote', remote);
  return `hauser://pair?${params.toString()}`;
}

export function servePairing(req, res, { store, allowedOrigins, remoteUrl = null, claims = null, guestExpiry = async () => null }) {
  const url = new URL(req.url || '/', 'http://hauser.local');
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (pathname === `${PAIRING_ROUTE_PREFIX}/start` && method === 'POST') {
    /* Nur aus dem LAN und nur aus der Oberfläche: der Code gehört auf das
       Wandpanel, nicht in eine Fernanfrage. */
    if (isRemoteRequest(req)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_LAN_ONLY', message: 'Koppeln geht nur im Heimnetz.' });
    if (!requestOriginAllowed(req, allowedOrigins)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_ORIGIN_FORBIDDEN', message: 'Die Kopplungsanfrage stammt nicht von einer freigegebenen Origin.' });
    return readSmallJson(req, res, async (payload) => {
      const lan = trimmed(payload?.lan, 200);
      let guestOptions = {};
      if (payload?.guest === true) {
        /* Gastcode nur bei laufendem Aufenthalt; er erlischt mit dem Checkout. */
        const deviceExpiresAt = await guestExpiry().catch(() => null);
        if (!deviceExpiresAt) return jsonResponse(res, 409, { ok: false, code: 'PAIRING_NO_STAY', message: 'Ohne laufenden Aufenthalt gibt es keinen Gastcode.' });
        guestOptions = { guest: true, deviceExpiresAt };
      }
      const { code, expiresAt, guest } = store.startPairing(guestOptions);
      const remote = (typeof remoteUrl === 'function' ? remoteUrl() : remoteUrl) || null;
      jsonResponse(res, 200, { ok: true, code, expiresAt, guest, lan: lan || null, remote, link: pairingLink({ code, lan, remote }) });
    });
  }

  if (pathname === `${PAIRING_ROUTE_PREFIX}/claim` && method === 'POST') {
    if (isRemoteRequest(req)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_LAN_ONLY', message: 'Koppeln geht nur im Heimnetz.' });
    if (claims && !claims.hit(requestSource(req))) {
      console.warn(`[hauser] Kopplung gedrosselt für ${requestSource(req)}`);
      return jsonResponse(res, 429, { ok: false, code: 'PAIRING_THROTTLED', message: 'Zu viele Kopplungsversuche — bitte eine Minute warten.' }, { 'retry-after': '60' });
    }
    return readSmallJson(req, res, (payload) => {
      const result = store.claim(payload?.code, {
        name: payload?.name,
        platform: payload?.platform,
        person: payload?.person,
      });
      if (!result) return jsonResponse(res, 404, { ok: false, code: 'PAIRING_CODE_INVALID', message: 'Der Kopplungscode ist unbekannt oder abgelaufen.' });
      jsonResponse(res, 200, { ok: true, deviceId: result.device.id, name: result.device.name, token: result.token });
    });
  }

  if (pathname === `${PAIRING_ROUTE_PREFIX}/devices` && method === 'GET') {
    if (!requestOriginAllowed(req, allowedOrigins)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_ORIGIN_FORBIDDEN', message: 'Die Geräteliste ist nur aus einer freigegebenen Origin lesbar.' });
    return jsonResponse(res, 200, { ok: true, devices: store.list() }, { 'cache-control': 'no-store' });
  }

  const revoke = pathname.match(new RegExp(`^${PAIRING_ROUTE_PREFIX}/devices/([A-Za-z0-9_-]+)$`));
  if (revoke && method === 'PATCH') {
    /* Das Gerät selbst (mit Token) oder die Oberfläche darf die Person setzen. */
    if (!(req.hauserDevice?.id === revoke[1]) && !requestOriginAllowed(req, allowedOrigins)) {
      return jsonResponse(res, 403, { ok: false, code: 'PAIRING_ORIGIN_FORBIDDEN', message: 'Nur das Gerät selbst oder eine freigegebene Origin.' });
    }
    return readSmallJson(req, res, (payload) => {
      const device = store.setPerson(revoke[1], payload?.person);
      if (!device) return jsonResponse(res, 404, { ok: false, code: 'PAIRING_DEVICE_NOT_FOUND', message: 'Das Gerät ist nicht gekoppelt.' });
      jsonResponse(res, 200, { ok: true, device });
    });
  }
  if (revoke && method === 'DELETE') {
    if (!requestOriginAllowed(req, allowedOrigins)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_ORIGIN_FORBIDDEN', message: 'Widerrufen geht nur aus einer freigegebenen Origin.' });
    if (!store.revoke(revoke[1])) return jsonResponse(res, 404, { ok: false, code: 'PAIRING_DEVICE_NOT_FOUND', message: 'Das Gerät ist nicht gekoppelt.' });
    return jsonResponse(res, 200, { ok: true });
  }

  jsonResponse(res, 404, { ok: false, code: 'PAIRING_ROUTE_NOT_FOUND', message: 'Die Kopplungsroute wurde nicht gefunden.' });
}
