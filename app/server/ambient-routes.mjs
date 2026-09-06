/* Ambient: LLM-Proxy und Stadtplan-Routen.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import http from 'node:http';
/* Grenzwerte und Modellname kommen als Objekt herein (Paket 11, ADR-030):
   der Server reicht seine Laufzeitkonfiguration durch, Tests reichen ihre. */
import { DEFAULT_RUNTIME_CONFIG } from './runtime-config.mjs';
import { jsonResponse, requestOriginAllowed } from './shared.mjs';
import { notReady } from './config-core.mjs';
import { haRestUrl, resolveServerHaAccess, withSupervisorClient } from './setup.mjs';

export function proxyAmbient(req, res, upstreamHost, upstreamPort, mode = 'ambient', runtimeConfig = DEFAULT_RUNTIME_CONFIG) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > runtimeConfig.ambientBodyMax) oversized = true;
  });
  req.on('end', () => {
    if (oversized) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ambient-Anfrage zu groß"}');
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const messages = Array.isArray(payload?.messages) ? payload.messages : null;
    const valid = messages && messages.length >= 1 && messages.length <= 4
      && messages.every((message) => message && ['system', 'user'].includes(message.role)
        && typeof message.content === 'string' && message.content.length <= 16_000);
    if (!valid) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ungültiger Ambient-Kontext"}');
      return;
    }
    const upstreamBody = JSON.stringify({
      model: runtimeConfig.ambientModel,
      messages,
      stream: false,
      temperature: mode === 'shopping' ? 0.1 : 0.85,
      top_p: mode === 'shopping' ? 1 : 0.9,
      max_tokens: mode === 'shopping' ? 2_000 : 80,
      ...(mode === 'shopping' ? { reasoning_effort: 'none' } : {}),
    });
    const upstream = http.request({
      hostname: upstreamHost,
      port: upstreamPort,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(upstreamBody) },
    }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, {
        'content-type': upstreamResponse.headers['content-type'] || 'application/json; charset=utf-8',
      });
      upstreamResponse.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ambient-Modell nicht erreichbar"}');
    });
    upstream.end(upstreamBody);
  });
}

/* ── AMBIENT-MAP S3: Verdrahtung des Stadtplan-Hintergrunds ─────────────── */

function ambientMapPathname(url) {
  try {
    return new URL(url || '/', 'http://hmi.local').pathname;
  } catch {
    return null;
  }
}

/** Öffentlicher Lesepfad und Assetpfad — vor dem Hotel-Admin-Gate. */
export function ambientMapPublicRoute(url) {
  const pathname = ambientMapPathname(url);
  if (pathname === null) return false;
  return pathname === '/api/ambient-map'
    || pathname === '/assets/ambient-maps'
    || pathname.startsWith('/assets/ambient-maps/');
}

/** Standortwahl, Neuerzeugung und Adminstatus — hinter dem Hotel-Admin-Gate. */
export function ambientMapAdminRoute(url) {
  const pathname = ambientMapPathname(url);
  if (pathname === null) return false;
  return pathname === '/api/admin/ambient-map' || pathname.startsWith('/api/admin/ambient-map/');
}

/**
 * Genau die drei Felder aus `GET /api/config`, die der Kartenstandort braucht.
 * Alles andere aus der Home-Assistant-Antwort wird verworfen. Ein unbrauchbares
 * `location_name` lässt den Standort gültig, aber ohne Label — ein Ortsname ist
 * per Plan §3.3 optional und darf keinen gültigen Standort scheitern lassen.
 */
function ambientMapLocationFromHaConfig(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AMBIENT_MAP_HA_INVALID_RESPONSE');
  }
  const { latitude, longitude } = payload;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('AMBIENT_MAP_HA_INVALID_RESPONSE');
  }
  const name = typeof payload.location_name === 'string' ? payload.location_name.trim() : '';
  const usable = Boolean(name) && name.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(name);
  return { latitude, longitude, ...(usable ? { location_name: name } : {}) };
}

/**
 * Ob überhaupt ein Home-Assistant-Zugang existiert, entscheidet jede Anfrage
 * neu: die Ersteinrichtung schreibt den Zugang ohne Serverneustart. Nur so
 * bleibt der `503`-Zweig aus Plan §6.2 in Produktion erreichbar und wird
 * gleichzeitig nach der Einrichtung wieder frei.
 */
export function ambientMapHomeAssistantConfigured({ configStore, connectionMode, supervisorClientFactory }) {
  if (connectionMode === 'supervisor') {
    const client = supervisorClientFactory();
    try { return client.available === true; } finally { client.close?.(); }
  }
  return resolveServerHaAccess(configStore, connectionMode) !== null;
}

/**
 * Der einzige Home-Assistant-Aufruf des Kartenfeatures: `GET /api/config` über
 * genau die bestehenden serverseitigen Zugänge — Shared Config im direkten
 * Modus, interner Client im App-Modus. Es entsteht kein allgemeiner Proxy, kein
 * Credential verlässt den Server, und kein Upstreamtext wird weitergereicht.
 */
export async function readAmbientMapHomeAssistantLocation({
  configStore,
  connectionMode,
  supervisorClientFactory,
  fetchImpl = fetch,
  runtimeConfig = DEFAULT_RUNTIME_CONFIG,
  timeoutMs = runtimeConfig.ambientMapHaTimeoutMs,
}) {
  if (connectionMode === 'supervisor') {
    let result;
    try {
      result = await withSupervisorClient(
        supervisorClientFactory, (client) => client.rest('GET', '/api/config'),
      );
    } catch {
      throw new Error('AMBIENT_MAP_HA_UNREACHABLE');
    }
    if (result?.status !== 200) throw new Error('AMBIENT_MAP_HA_HTTP_ERROR');
    return ambientMapLocationFromHaConfig(result.body);
  }
  const access = resolveServerHaAccess(configStore, connectionMode);
  if (!access) throw new Error('AMBIENT_MAP_HA_NOT_CONFIGURED');
  let response;
  try {
    response = await fetchImpl(haRestUrl(access.baseUrl, 'api/config'), {
      headers: { accept: 'application/json', authorization: `Bearer ${access.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error('AMBIENT_MAP_HA_UNREACHABLE');
  }
  if (response.status !== 200) throw new Error('AMBIENT_MAP_HA_HTTP_ERROR');
  let text;
  try { text = await response.text(); } catch { throw new Error('AMBIENT_MAP_HA_UNREACHABLE'); }
  if (Buffer.byteLength(text) > runtimeConfig.ambientMapHaBodyMax) throw new Error('AMBIENT_MAP_HA_INVALID_RESPONSE');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('AMBIENT_MAP_HA_INVALID_RESPONSE'); }
  return ambientMapLocationFromHaConfig(payload);
}

/**
 * Setup-Required und der Recovery-Latch bleiben auch für den Kartenpfad
 * fail-closed. Der öffentliche Zweig liegt vor dem Migrations-/Setup-Gate der
 * übrigen `/api`-Routen und muss diese Zusage deshalb selbst einlösen.
 */
export function ambientMapNotReady(migrationResult, readiness, setupIsRequired) {
  if (!migrationResult.ok) {
    return {
      status: 503,
      payload: {
        ok: false, status: 'not_ready', code: readiness.payload.code, message: readiness.payload.message,
      },
    };
  }
  if (setupIsRequired) {
    return {
      status: 503,
      payload: {
        ok: false,
        code: 'SETUP_REQUIRED',
        message: 'Die Ersteinrichtung muss zuerst abgeschlossen werden.',
      },
    };
  }
  return null;
}

/**
 * Gemeinsame Grenze beider Kartenzweige: Origin, Bereitschaft und
 * Verfügbarkeit werden hier geprüft, erst danach antwortet der S2-Router. Eine
 * nicht bediente Assetanfrage endet als `404` und nie im SPA-Fallback.
 */
export function serveAmbientMap(req, res, { service, allowedOrigins, notReady }) {
  const assetRequest = (ambientMapPathname(req.url || '/') || '').startsWith('/assets/');
  const deny = (status, payload) => {
    if (assetRequest) {
      res.writeHead(status);
      res.end();
    } else {
      jsonResponse(res, status, payload);
    }
  };
  const unavailable = () => deny(503, {
    ok: false, code: 'AMBIENT_MAP_UNAVAILABLE', message: 'Der Kartenspeicher ist nicht verfügbar.',
  });
  if (!requestOriginAllowed(req, allowedOrigins)) {
    deny(403, { code: 'AMBIENT_MAP_FORBIDDEN', message: 'Kartenroute nicht freigegeben.' });
    return;
  }
  if (notReady) {
    deny(notReady.status, notReady.payload);
    return;
  }
  if (!service) {
    unavailable();
    return;
  }
  void Promise.resolve(service.route(req, res)).then((handled) => {
    if (handled || res.headersSent || res.writableEnded) return;
    deny(404, { code: 'AMBIENT_MAP_ROUTE_NOT_FOUND', message: 'Die Kartenroute wurde nicht gefunden.' });
  }).catch(() => {
    if (res.headersSent || res.writableEnded) return;
    unavailable();
  });
}
