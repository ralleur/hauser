/* Ablage: PIN-Freigabe und Paperless-Proxy.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { ABLAGE_SESSION_MS, ABLAGE_UPLOAD_MAX, ALLOWED_ORIGINS } from './runtime-env.mjs';
import { jsonResponse, readSmallJson, requestOriginAllowed } from './shared.mjs';

export function ablageRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return ['GET', 'POST'].includes(req.method || '') && requestOriginAllowed(req, allowedOrigins);
}

/* `token` darf eine Funktion sein: dann wird der Wert bei jedem Zugriff neu
   gelesen — die Ablage lässt sich so aus der Oberfläche konfigurieren, ohne
   den Server neu zu starten. */
export function createAblageAccess(pin = '', token = '', now = () => Date.now()) {
  const sessions = new Map();
  const attempts = new Map();
  const readToken = typeof token === 'function' ? token : () => token;

  function configured() { return Boolean(pin && readToken()); }
  function cookieToken(req) {
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)hmi_ablage=([a-f0-9]{64})(?:;|$)/);
    return match?.[1] || '';
  }
  function authenticated(req) {
    const session = cookieToken(req);
    const expiry = sessions.get(session) || 0;
    if (!session || expiry <= now()) {
      if (session) sessions.delete(session);
      return false;
    }
    sessions.set(session, now() + ABLAGE_SESSION_MS);
    return true;
  }
  function unlock(candidate, remoteAddress = '') {
    const key = remoteAddress || 'unknown';
    const attempt = attempts.get(key) || { failures: 0, blockedUntil: 0 };
    if (attempt.blockedUntil > now()) return { ok: false, limited: true };
    const expected = Buffer.from(pin);
    const supplied = Buffer.from(String(candidate || ''));
    const valid = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    if (!valid) {
      attempt.failures += 1;
      if (attempt.failures >= 5) {
        attempt.failures = 0;
        attempt.blockedUntil = now() + 60_000;
      }
      attempts.set(key, attempt);
      return { ok: false, limited: attempt.blockedUntil > now() };
    }
    attempts.delete(key);
    const session = randomBytes(32).toString('hex');
    sessions.set(session, now() + ABLAGE_SESSION_MS);
    return { ok: true, session };
  }
  function lock(req) {
    const session = cookieToken(req);
    if (session) sessions.delete(session);
  }
  return { authenticated, configured, lock, get token() { return readToken(); }, unlock };
}

function ablageCookie(req, value, maxAge) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = req.socket.encrypted || forwarded === 'https' ? '; Secure' : '';
  return `hmi_ablage=${value}; Path=/api/ablage; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/* Adresse der Paperless-Instanz: bevorzugt die in der Oberfläche gesetzte,
   sonst die Vorgabe aus der Umgebung. Ungültige Eingaben fallen zurück. */
export function paperlessUpstream(url, fallbackHost, fallbackPort) {
  if (typeof url === 'string' && url.trim()) {
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return {
          host: parsed.hostname,
          port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
        };
      }
    } catch { /* unbrauchbare Adresse: Vorgabe bleibt */ }
  }
  return { host: fallbackHost, port: fallbackPort };
}

export function paperlessTargetPath(url) {
  const parsed = new URL(url, 'http://hmi.local');
  if (parsed.pathname === '/api/ablage/documents/import' && !parsed.search) {
    return { kind: 'upload', path: '/api/documents/post_document/' };
  }
  if (parsed.pathname === '/api/ablage/tasks' && !parsed.search) {
    return { kind: 'tasks', path: '/api/tasks/?page=1&page_size=100&ordering=-date_created&task_name=consume_file' };
  }
  if (parsed.pathname === '/api/ablage/documents') {
    const query = (parsed.searchParams.get('query') || '').trim().slice(0, 200);
    const page = Math.max(1, Math.min(1000, Number(parsed.searchParams.get('page')) || 1));
    const search = new URLSearchParams({ page: String(page), page_size: '30', ordering: '-created' });
    if (query) search.set('query', query);
    for (const [source, target] of [['from', 'created__date__gte'], ['to', 'created__date__lte']]) {
      const value = parsed.searchParams.get(source) || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) search.set(target, value);
    }
    return { kind: 'documents', path: `/api/documents/?${search}` };
  }
  const match = parsed.pathname.match(/^\/api\/ablage\/documents\/(\d+)\/(thumb|preview|download)$/);
  if (!match) return null;
  return { kind: match[2], path: `/api/documents/${match[1]}/${match[2]}/` };
}

function proxyPaperless(req, res, target, access, upstreamHost, upstreamPort) {
  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: 'GET',
    path: target.path,
    headers: { accept: req.headers.accept || '*/*', authorization: `Token ${access.token}` },
  }, (upstreamResponse) => {
    if (!['documents', 'tasks'].includes(target.kind)) {
      const responseHeaders = { 'cache-control': 'private, no-store' };
      for (const name of ['content-type', 'content-length', 'content-disposition']) {
        if (upstreamResponse.headers[name] !== undefined) responseHeaders[name] = upstreamResponse.headers[name];
      }
      res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(res);
      return;
    }
    let body = '';
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => { body += chunk; });
    upstreamResponse.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch { payload = null; }
      if (!payload || !Array.isArray(payload.results)) {
        jsonResponse(res, upstreamResponse.statusCode || 502, { error: 'Paperless-Antwort ungültig' });
        return;
      }
      if (target.kind === 'tasks') {
        const activeStates = new Set(['PENDING', 'RECEIVED', 'STARTED', 'RETRY']);
        jsonResponse(res, upstreamResponse.statusCode || 200, {
          processing: payload.results
            .filter((task) => task.task_name === 'consume_file' && activeStates.has(task.status))
            .map((task) => ({
              id: String(task.task_id || task.id),
              fileName: task.task_file_name || null,
              status: task.status,
            })),
        });
        return;
      }
      jsonResponse(res, upstreamResponse.statusCode || 200, {
        count: Number(payload.count) || payload.results.length,
        next: Boolean(payload.next),
        previous: Boolean(payload.previous),
        results: payload.results.map((document) => ({
          id: document.id,
          title: document.title || document.original_file_name || `Dokument ${document.id}`,
          created: document.created || null,
          added: document.added || null,
          archiveSerialNumber: document.archive_serial_number ?? null,
          originalFileName: document.original_file_name || null,
        })),
      });
    });
  });
  upstream.on('error', () => jsonResponse(res, 502, { error: 'Paperless nicht erreichbar' }));
  req.on('aborted', () => upstream.destroy());
  upstream.end();
}

function proxyPaperlessUpload(req, res, target, access, upstreamHost, upstreamPort) {
  const contentType = String(req.headers['content-type'] || '');
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (!contentType.toLowerCase().startsWith('multipart/form-data; boundary=')) {
    jsonResponse(res, 415, { error: 'Datei-Upload muss multipart/form-data verwenden' });
    return;
  }
  if (declaredLength > ABLAGE_UPLOAD_MAX) {
    jsonResponse(res, 413, { error: 'Datei ist größer als 50 MiB' });
    return;
  }

  let received = 0;
  let settled = false;
  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: 'POST',
    path: target.path,
    headers: {
      accept: 'application/json',
      authorization: `Token ${access.token}`,
      'content-type': contentType,
      ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
    },
  }, (upstreamResponse) => {
    upstreamResponse.resume();
    upstreamResponse.on('end', () => {
      if (settled) return;
      settled = true;
      const status = upstreamResponse.statusCode || 502;
      if (status >= 200 && status < 300) {
        jsonResponse(res, 202, { imported: true });
      } else {
        jsonResponse(res, status, { error: 'Paperless hat die Datei abgelehnt' });
      }
    });
  });
  upstream.on('error', () => {
    if (settled) return;
    settled = true;
    jsonResponse(res, 502, { error: 'Paperless nicht erreichbar' });
  });
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received <= ABLAGE_UPLOAD_MAX || settled) return;
    settled = true;
    req.unpipe(upstream);
    upstream.destroy();
    req.resume();
    jsonResponse(res, 413, { error: 'Datei ist größer als 50 MiB' });
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

export function serveAblage(req, res, access, upstreamHost, upstreamPort) {
  const parsed = new URL(req.url || '/', 'http://hmi.local');
  if (parsed.pathname === '/api/ablage/status' && req.method === 'GET') {
    jsonResponse(res, 200, { configured: access.configured(), unlocked: access.authenticated(req) });
    return;
  }
  if (parsed.pathname === '/api/ablage/unlock' && req.method === 'POST') {
    if (!access.configured()) return jsonResponse(res, 503, { error: 'Ablage ist noch nicht konfiguriert' });
    readSmallJson(req, res, (payload) => {
      const result = access.unlock(payload?.pin, req.socket.remoteAddress || '');
      if (!result.ok) {
        jsonResponse(res, result.limited ? 429 : 401, {
          error: result.limited ? 'Zu viele Versuche. Bitte kurz warten.' : 'PIN ist nicht korrekt',
        });
        return;
      }
      jsonResponse(res, 200, { unlocked: true }, { 'set-cookie': ablageCookie(req, result.session, ABLAGE_SESSION_MS / 1000) });
    });
    return;
  }
  if (parsed.pathname === '/api/ablage/lock' && req.method === 'POST') {
    access.lock(req);
    jsonResponse(res, 200, { unlocked: false }, { 'set-cookie': ablageCookie(req, '', 0) });
    return;
  }
  const target = paperlessTargetPath(req.url || '/');
  if (target?.kind === 'upload' && req.method === 'POST') {
    if (!access.configured()) return jsonResponse(res, 503, { error: 'Ablage ist noch nicht konfiguriert' });
    if (!access.authenticated(req)) return jsonResponse(res, 401, { error: 'PIN erforderlich' });
    proxyPaperlessUpload(req, res, target, access, upstreamHost, upstreamPort);
    return;
  }
  if (target && req.method === 'GET') {
    if (!access.configured()) return jsonResponse(res, 503, { error: 'Ablage ist noch nicht konfiguriert' });
    if (!access.authenticated(req)) return jsonResponse(res, 401, { error: 'PIN erforderlich' });
    proxyPaperless(req, res, target, access, upstreamHost, upstreamPort);
    return;
  }
  jsonResponse(res, 404, { error: 'Ablage-Route nicht gefunden' });
}
