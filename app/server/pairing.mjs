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
    };
  }

  return {
    path,
    list() {
      return load().devices.map(publicDevice);
    },
    /** Neuer Einmalcode. Ältere offene Codes bleiben bis zu ihrem Ablauf gültig. */
    startPairing() {
      sweep();
      const code = makeCode(random);
      const expiresAt = now() + PAIRING_CODE_TTL_MS;
      pending.set(code, { expiresAt });
      return { code, expiresAt };
    },
    /** Code einlösen → Gerät anlegen. Liefert `null` bei unbekanntem oder
        abgelaufenem Code; der Token erscheint genau einmal in der Antwort. */
    claim(code, { name, platform, person } = {}) {
      sweep();
      const normalized = trimmed(code, CODE_LENGTH).toUpperCase();
      if (!normalized || !pending.has(normalized)) return null;
      pending.delete(normalized);
      const devices = load().devices;
      const token = random(32).toString('base64url');
      const device = {
        id: random(8).toString('hex'),
        name: trimmed(name) || 'Telefon',
        platform: trimmed(platform, 20) || 'unknown',
        person: trimmed(person) || null,
        tokenHash: hashToken(token),
        createdAt: new Date(now()).toISOString(),
        lastSeenAt: null,
        lastSeenVia: null,
      };
      devices.push(device);
      persist();
      return { device: publicDevice(device), token };
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
      return device ? publicDevice(device) : null;
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
export function authenticateRequest(req, store) {
  const token = bearerToken(req);
  const device = token ? store.authenticate(token) : null;
  if (device) {
    req.hauserDevice = device;
    store.touch(device.id, isRemoteRequest(req) ? 'remote' : 'lan');
  }
  return device;
}

/** Tunnel-Anfragen ohne Gerät dürfen nur Health und Build-Info sehen. */
export function remoteGateAllows(req) {
  if (!isRemoteRequest(req)) return true;
  if (req.hauserDevice) return true;
  try {
    return REMOTE_PUBLIC_PATHS.has(new URL(req.url || '/', 'http://hauser.local').pathname);
  } catch {
    return false;
  }
}

export function remoteGateReject(res) {
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

export function servePairing(req, res, { store, allowedOrigins, remoteUrl = null }) {
  const url = new URL(req.url || '/', 'http://hauser.local');
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (pathname === `${PAIRING_ROUTE_PREFIX}/start` && method === 'POST') {
    /* Nur aus dem LAN und nur aus der Oberfläche: der Code gehört auf das
       Wandpanel, nicht in eine Fernanfrage. */
    if (isRemoteRequest(req)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_LAN_ONLY', message: 'Koppeln geht nur im Heimnetz.' });
    if (!requestOriginAllowed(req, allowedOrigins)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_ORIGIN_FORBIDDEN', message: 'Die Kopplungsanfrage stammt nicht von einer freigegebenen Origin.' });
    return readSmallJson(req, res, (payload) => {
      const lan = trimmed(payload?.lan, 200);
      const { code, expiresAt } = store.startPairing();
      const remote = remoteUrl || null;
      jsonResponse(res, 200, { ok: true, code, expiresAt, lan: lan || null, remote, link: pairingLink({ code, lan, remote }) });
    });
  }

  if (pathname === `${PAIRING_ROUTE_PREFIX}/claim` && method === 'POST') {
    if (isRemoteRequest(req)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_LAN_ONLY', message: 'Koppeln geht nur im Heimnetz.' });
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
  if (revoke && method === 'DELETE') {
    if (!requestOriginAllowed(req, allowedOrigins)) return jsonResponse(res, 403, { ok: false, code: 'PAIRING_ORIGIN_FORBIDDEN', message: 'Widerrufen geht nur aus einer freigegebenen Origin.' });
    if (!store.revoke(revoke[1])) return jsonResponse(res, 404, { ok: false, code: 'PAIRING_DEVICE_NOT_FOUND', message: 'Das Gerät ist nicht gekoppelt.' });
    return jsonResponse(res, 200, { ok: true });
  }

  jsonResponse(res, 404, { ok: false, code: 'PAIRING_ROUTE_NOT_FOUND', message: 'Die Kopplungsroute wurde nicht gefunden.' });
}
