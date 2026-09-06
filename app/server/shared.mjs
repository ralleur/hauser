/* Gemeinsame HTTP-, Datei- und Origin-Helfer der Serverfläche.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  statSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import {
  ABLAGE_BODY_MAX,
  AI_CUSTOMIZING_ENABLED,
  ALLOWED_ORIGINS,
  DIST,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  MIME,
} from './runtime-env.mjs';

export function rawHeaderValues(req, name) {
  const values = [];
  const raw = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (String(raw[index]).toLowerCase() === name) values.push(String(raw[index + 1]));
  }
  return values;
}

// Same-Origin-Vergleich: Die Origin muss exakt dem effektiven Request-Origin
// aus Protokoll, Host und Port entsprechen.
export function sameOriginAsRequest(origin, req) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || !host) return false;
  const protocol = req.socket?.encrypted ? 'https:' : 'http:';
  try {
    const browserOrigin = new URL(origin);
    const requestUrl = new URL(`${protocol}//${host}`);
    const validBrowserOrigin = ['http:', 'https:'].includes(browserOrigin.protocol)
      && !browserOrigin.username && !browserOrigin.password
      && browserOrigin.pathname === '/' && !browserOrigin.search && !browserOrigin.hash
      && browserOrigin.origin === origin;
    const validRequestHost = requestUrl.pathname === '/'
      && !requestUrl.username && !requestUrl.password
      && !requestUrl.search && !requestUrl.hash;
    return validBrowserOrigin && validRequestHost && browserOrigin.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function strongByteEtag(bytes) {
  return `"${createHash('sha256').update(bytes).digest('hex')}"`;
}

export class RoomImageAssetStoreError extends Error {
  constructor(message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RoomImageAssetStoreError';
    this.code = 'ROOM_IMAGE_STORE_INVALID';
  }
}

export function roomImageAssetStoreError(message, cause = undefined) {
  return new RoomImageAssetStoreError(message, cause);
}

export function flushDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function canonicalRoomImageAssetPath(path) {
  const absolute = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  if (absolute === temporaryRoot || absolute.startsWith(`${temporaryRoot}${sep}`)) {
    return join(realpathSync(temporaryRoot), absolute.slice(temporaryRoot.length));
  }
  return absolute;
}

export function inspectRoomImageAssetPath(path, expectedType = null) {
  const absolute = canonicalRoomImageAssetPath(path);
  const chain = [];
  for (let current = absolute; ; current = dirname(current)) {
    chain.push(current);
    if (dirname(current) === current) break;
  }
  chain.reverse();
  for (const [index, current] of chain.entries()) {
    let metadata;
    try { metadata = lstatSync(current); } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return { path: absolute, exists: false };
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error('unsafe symlink component');
    if (index < chain.length - 1 && !metadata.isDirectory()) throw new Error('unsafe non-directory ancestor');
    if (index === chain.length - 1 && expectedType === 'directory' && !metadata.isDirectory()) {
      throw new Error('unsafe directory');
    }
    if (index === chain.length - 1 && expectedType === 'file' && !metadata.isFile()) {
      throw new Error('unsafe file');
    }
  }
  if (realpathSync(absolute) !== absolute) throw new Error('unsafe realpath mismatch');
  return { path: absolute, exists: true };
}

export function proxyTargetPath(url) {
  const parsed = new URL(url, 'http://hmi.local');
  if (parsed.pathname !== '/hermes' && !parsed.pathname.startsWith('/hermes/')) return null;
  const path = parsed.pathname.slice('/hermes'.length) || '/';
  const allowed = path === '/health'
    || path === '/api/sessions'
    || path.startsWith('/api/sessions/')
    || path === '/v1/runs'
    || path.startsWith('/v1/runs/');
  return allowed ? `${path}${parsed.search}` : null;
}

export function requestOriginAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  /* Ein gekoppeltes Gerät (Companion-App) ersetzt die Origin-Grenze: sein
     WebView meldet eine App-Origin, die nie in der Liste stehen kann. */
  if (req?.hauserDevice) return true;
  const origin = req.headers?.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || !origin) return false;
  if (allowedOrigins.has(origin)) return true;
  return sameOriginAsRequest(origin, req);
}


export function proxyRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return false;
  return requestOriginAllowed(req, allowedOrigins);
}

export function ambientRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'POST' && requestOriginAllowed(req, allowedOrigins);
}

export function configRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return ['GET', 'PUT'].includes(req.method || '') && requestOriginAllowed(req, allowedOrigins);
}

export function householdConfigRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'GET' && requestOriginAllowed(req, allowedOrigins);
}

export function familyDataRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return ['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')
    && requestOriginAllowed(req, allowedOrigins);
}

export function readKeychainSecret(account, service, required = false) {
  try {
    const value = execFileSync('/usr/bin/security', [
      'find-generic-password', '-a', account, '-s', service, '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (value) return value;
  } catch { /* Optional secrets leave the Ablage route disabled. */ }
  if (required) throw new Error(`Schlüsselbund-Eintrag ${service}/${account} fehlt.`);
  return '';
}

export function staticPathFor(url, staticRoot = DIST) {
  const root = resolve(staticRoot);
  const pathname = decodeURIComponent(new URL(url, 'http://hmi.local').pathname);
  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}

export function readHermesKey() {
  if (!AI_CUSTOMIZING_ENABLED) return '';
  if (process.platform !== 'darwin') return '';
  try {
    const key = execFileSync('/usr/bin/security', [
      'find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return key;
  } catch {
    return '';
  }
}

export function proxy(req, res, key, targetPath, upstreamHost, upstreamPort) {
  const headers = {
    accept: req.headers.accept || '*/*',
    authorization: `Bearer ${key}`,
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['last-event-id']) headers['last-event-id'] = req.headers['last-event-id'];
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];

  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: req.method,
    path: targetPath,
    headers,
  }, (upstreamResponse) => {
    const responseHeaders = {};
    for (const name of ['content-type', 'cache-control', 'content-length']) {
      if (upstreamResponse.headers[name] !== undefined) responseHeaders[name] = upstreamResponse.headers[name];
    }
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"error":"Hermes nicht erreichbar"}');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

export function jsonResponse(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

/* ── Leseantworten mit ETag (Paket 11) ──
   Jede Leseroute des API-Vertrags soll eine wiederholte Anfrage mit 304
   beantworten können, ohne dass jede Route das selbst schreibt. Der Wrapper
   hängt sich vor `writeHead`/`end`: Kommt eine vollständige JSON-Antwort mit
   Status 200 heraus, bekommt sie einen schwachen ETag aus dem Rumpf; passt er
   zu `if-none-match`, geht stattdessen 304 zurück.

   Bewusst zurückhaltend: Wer streamt (`res.write`) oder etwas anderes als JSON
   sendet, bleibt unberührt. `private, no-cache` heißt: der Browser darf die
   Antwort behalten, muss sie aber jedes Mal nachfragen — genau der Weg, auf
   dem 304 überhaupt entsteht. Der Aufrufer wählt die Routen (nur `public` und
   `origin`); Admin- und Sitzungsrouten bleiben ungespeichert. */
export function withReadCache(req, res, { cacheControl = 'private, no-cache' } = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res;

  const writeHead = res.writeHead.bind(res);
  const write = res.write.bind(res);
  const end = res.end.bind(res);

  let pending = null;   // zurückgehaltene Kopfzeilen
  let streaming = false;

  function flushHead() {
    if (!pending) return;
    const { status, headers } = pending;
    pending = null;
    writeHead(status, headers);
  }

  function headerValue(headers, name) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) return String(value);
    }
    return '';
  }

  res.writeHead = (status, ...rest) => {
    const headers = rest.find((entry) => entry && typeof entry === 'object') ?? {};
    const type = headerValue(headers, 'content-type');
    const control = headerValue(headers, 'cache-control');
    /* `jsonResponse` setzt no-store als Vorgabe; für die ausgewählten
       Leserouten ersetzt der Wrapper das bewusst durch die revalidierende
       Variante. Alles andere (Streams, Nicht-JSON) bleibt, wie es ist.
       Wer schon selbst einen ETag mitbringt (Momente, Haushaltskonfiguration),
       bleibt unberührt — zwei ETags auf einer Antwort wären schlimmer als
       keiner. */
    void control;
    const cacheable = status === 200
      && type.startsWith('application/json')
      && headerValue(headers, 'etag') === '';
    if (!cacheable || streaming) {
      writeHead(status, ...rest);
      return res;
    }
    pending = { status, headers: { ...headers } };
    return res;
  };

  res.write = (...args) => {
    streaming = true;
    flushHead();
    return write(...args);
  };

  res.end = (chunk, ...rest) => {
    if (!pending) return end(chunk, ...rest);
    const body = typeof chunk === 'string' ? Buffer.from(chunk)
      : Buffer.isBuffer(chunk) ? chunk
        : null;
    if (body === null) {
      flushHead();
      return end(chunk, ...rest);
    }
    const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
    const { status, headers } = pending;
    pending = null;
    const known = rawHeaderValues(req, 'if-none-match')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim());
    if (known.includes(etag)) {
      writeHead(304, { etag, 'cache-control': cacheControl });
      return end();
    }
    writeHead(status, { ...headers, etag, 'cache-control': cacheControl });
    return end(body, ...rest);
  };

  return res;
}

export class RoomImageRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function roomImageJsonResponse(req, res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  if (req.method === 'HEAD') res.end();
  else res.end(JSON.stringify(payload));
}

export function roomImageError(req, res, status, code, message, headers = {}, retryable = false) {
  roomImageJsonResponse(req, res, status, { ok: false, code, message, retryable }, headers);
}

export function readRoomImageJsonBody(req, { allowEmpty = false, maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const contentTypes = rawHeaderValues(req, 'content-type');
    const declaredEmpty = rawHeaderValues(req, 'content-length').length === 1
      && rawHeaderValues(req, 'content-length')[0] === '0';
    if (allowEmpty && (declaredEmpty || (contentTypes.length === 0 && !req.headers['transfer-encoding']))) {
      req.resume(); resolvePromise({}); return;
    }
    if (contentTypes.length !== 1 || contentTypes[0].toLowerCase() !== 'application/json') {
      rejectPromise(new RoomImageRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Die Room-Image-Anfrage erwartet exaktes application/json.'));
      return;
    }
    let body = '';
    let oversized = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (oversized) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) oversized = true;
    });
    req.on('end', () => {
      if (oversized) {
        rejectPromise(new RoomImageRequestError(413, 'INVALID_REQUEST', 'Die Room-Image-Anfrage ist zu groß.'));
        return;
      }
      if (!body && allowEmpty) { resolvePromise({}); return; }
      try { resolvePromise(JSON.parse(body)); } catch {
        rejectPromise(new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Room-Image-Anfrage enthält kein gültiges JSON.'));
      }
    });
    req.on('aborted', () => rejectPromise(new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Room-Image-Anfrage wurde abgebrochen.')));
    req.on('error', () => rejectPromise(new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Room-Image-Anfrage konnte nicht gelesen werden.')));
  });
}

export function readSmallJson(req, res, callback) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > ABLAGE_BODY_MAX) oversized = true;
  });
  req.on('end', () => {
    if (oversized) return jsonResponse(res, 413, { error: 'Anfrage zu groß' });
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    callback(payload);
  });
}

export function staticCacheControl(path) {
  const extension = extname(path).toLowerCase();
  const mutablePwaResource = extension === '.html'
    || extension === '.webmanifest'
    || path.endsWith(`${sep}sw.js`);
  return mutablePwaResource ? 'no-cache' : 'public, max-age=31536000, immutable';
}

export function serveStatic(req, res, staticRoot = DIST) {
  const root = resolve(staticRoot);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let path;
  try { path = staticPathFor(req.url || '/', root); } catch { path = null; }
  if (!path) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = resolve(path, 'index.html');
  if (!existsSync(path) || !statSync(path).isFile()) path = resolve(root, 'index.html');
  const extension = extname(path).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME.get(extension) || 'application/octet-stream',
    'cache-control': staticCacheControl(path),
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path).pipe(res);
}
