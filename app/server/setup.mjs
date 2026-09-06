/* Setup und Home-Assistant-Zugang: Konfigurationsroute, Verbindungsprüfung, Discovery, Aktivierung, CalDAV- und Kamera-Proxy.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import {
  HA_SUPERVISOR_CORE_URL,
  HA_SUPERVISOR_WEBSOCKET_URL,
  readHaDiscoverySnapshot,
  readSupervisorToken,
} from './ha-supervisor.mjs';
import { HA_GATEWAY_PATH } from './ha-gateway.mjs';
import {
  ALLOWED_ORIGINS,
  CONFIG_BODY_MAX,
  HA_CONNECTION_MODE,
  HOUSEHOLD_CONFIG_BODY_MAX,
  compileHouseholdConfig,
  parseHouseholdConfig,
  projectActiveHouseholdData,
} from './runtime-env.mjs';
import { jsonResponse, rawHeaderValues, readSmallJson, requestOriginAllowed, strongByteEtag } from './shared.mjs';
import {
  commitSetupConfigTransaction,
  isSetupRecoveryRequiredError,
  readRoomImageHouseholdSnapshot,
  setupRecoveryFailure,
} from './config-core.mjs';

export function serveConfig(req, res, store, configMutations, assertSetupRecoveryHealthy) {
  if (req.method === 'GET') {
    try {
      const bytes = store.responseBody();
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        etag: strongByteEtag(bytes),
      });
      res.end(bytes);
    } catch {
      jsonResponse(res, 503, setupRecoveryFailure());
    }
    return;
  }
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > CONFIG_BODY_MAX) oversized = true;
  });
  req.on('end', async () => {
    if (oversized) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Konfiguration zu groß"}');
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    if (!payload?.updates || typeof payload.updates !== 'object' || Array.isArray(payload.updates)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ungültige Konfiguration"}');
      return;
    }
    const ifMatchValues = rawHeaderValues(req, 'if-match');
    if (ifMatchValues.length !== 1) {
      jsonResponse(res, 428, { ok: false, code: 'CONFIG_PRECONDITION_REQUIRED', message: 'Der Shared-Config-ETag fehlt.' });
      return;
    }
    try {
      const result = await configMutations.run(() => {
        assertSetupRecoveryHealthy();
        if (ifMatchValues[0] !== strongByteEtag(store.responseBody())) return { stale: true };
        const values = store.update(payload.updates);
        return { stale: false, bytes: Buffer.from(JSON.stringify({ values })) };
      });
      if (result.stale) {
        jsonResponse(res, 412, { ok: false, code: 'CONFIG_PRECONDITION_FAILED', message: 'Die Shared Config wurde zwischenzeitlich geändert.' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        etag: strongByteEtag(result.bytes),
      });
      res.end(result.bytes);
    } catch (error) {
      if (isSetupRecoveryRequiredError(error)) {
        jsonResponse(res, 503, setupRecoveryFailure());
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Konfiguration konnte nicht gespeichert werden"}');
    }
  });
}

/* `/api/household-modules/:id` — schmaler Schalter für einen Screen. */
export function householdModuleMatch(req) {
  const match = String(req.url || '').split('?')[0].match(/^\/api\/household-modules\/([a-z-]+)$/);
  return match ? match[1] : null;
}

export function setupRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'POST' && requestOriginAllowed(req, allowedOrigins);
}

/* Die lesenden Setup-Routen des Supervisor-Modus liefern Haushaltsstruktur,
   niemals Credentials, bleiben aber an dieselbe Origin-Grenze gebunden. */
export function setupReadRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'GET' && requestOriginAllowed(req, allowedOrigins);
}

function normalizeSetupServiceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)
        || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeSetupHaUrl(value) {
  return normalizeSetupServiceUrl(value);
}

/* B-08E11: Der einzige serverseitige Auflöser des Home-Assistant-Zugangs.
   Im direkten Modus kommt er aus der Shared Config, im App-Modus
   ausschließlich aus der Prozessumgebung — dort wird nichts gespeichert und es
   gibt keinen Rückfall auf einen Long-Lived Access Token. */
export function resolveServerHaAccess(configStore, connectionMode = HA_CONNECTION_MODE) {
  if (connectionMode === 'supervisor') {
    const token = readSupervisorToken();
    return token
      ? { baseUrl: HA_SUPERVISOR_CORE_URL, token, websocketUrl: HA_SUPERVISOR_WEBSOCKET_URL }
      : null;
  }
  const values = configStore ? configStore.read() : {};
  const baseUrl = normalizeSetupHaUrl(values['hmi:ha-url']);
  const token = values['hmi:ha-token'];
  return baseUrl && typeof token === 'string' && token ? { baseUrl, token } : null;
}

/* Cutover: eine bestehende Installation, die auf den App-Modus wechselt, darf
   ihren alten Long-Lived Access Token nicht behalten. Entfernt wird atomar über
   dieselbe Schreibroutine wie jede andere Änderung — es entsteht keine
   Klartext-Sicherungsdatei, in der das Secret weiterlebt. */
export function purgeHaCredentialsFromSharedConfig(configStore) {
  const values = configStore.read();
  if (values['hmi:ha-url'] === undefined && values['hmi:ha-token'] === undefined) return false;
  configStore.update({ 'hmi:ha-url': null, 'hmi:ha-token': null });
  return true;
}

/* HA-Pfade relativ auflösen, damit derselbe Aufruf gegen eine HA-Adresse und
   gegen den internen Core-Präfix `/core/` funktioniert. */
export function haRestUrl(baseUrl, path) {
  const base = String(baseUrl).endsWith('/') ? String(baseUrl) : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ''), base);
}

function normalizeSetupJellyfin(payload) {
  if (!payload || typeof payload.enabled !== 'boolean') return null;
  if (!payload.enabled) return { enabled: false };
  const url = normalizeSetupServiceUrl(payload.url);
  if (!url
      || typeof payload.accessToken !== 'string' || !payload.accessToken.trim()
      || Buffer.byteLength(payload.accessToken) > 16 * 1024
      || typeof payload.userId !== 'string' || !payload.userId.trim()
      || Buffer.byteLength(payload.userId) > 1024) return null;
  return {
    enabled: true,
    url,
    accessToken: payload.accessToken.trim(),
    userId: payload.userId.trim(),
  };
}

function setupPayloadError(payload, connectionMode = 'direct') {
  const supervisor = connectionMode === 'supervisor';
  /* Im App-Modus gibt es keine Nutzer-Credentials. Eine Anfrage, die trotzdem
     welche mitbringt, wird abgelehnt statt stillschweigend entwertet. */
  if (supervisor && (payload?.haUrl !== undefined || payload?.haToken !== undefined)) {
    return {
      code: 'SETUP_CREDENTIALS_NOT_ALLOWED',
      message: 'Im Home-Assistant-App-Modus werden weder HA-Adresse noch HA-Token entgegengenommen.',
    };
  }
  const haUrl = supervisor ? null : normalizeSetupHaUrl(payload?.haUrl);
  if (!supervisor && !haUrl) {
    return {
      code: 'SETUP_INVALID_HOME_ASSISTANT_URL',
      message: 'Die Home-Assistant-URL muss eine gültige HTTP- oder HTTPS-Adresse sein.',
    };
  }
  if (!supervisor && (typeof payload?.haToken !== 'string' || !payload.haToken.trim()
      || Buffer.byteLength(payload.haToken) > 16 * 1024)) {
    return {
      code: 'SETUP_INVALID_HOME_ASSISTANT_TOKEN',
      message: 'Der Home-Assistant-Token fehlt oder ist zu groß.',
    };
  }
  const jellyfin = normalizeSetupJellyfin(payload?.jellyfin);
  if (!jellyfin) {
    return {
      code: 'SETUP_INVALID_JELLYFIN_CONFIG',
      message: 'Jellyfin muss vollständig konfiguriert oder ausdrücklich deaktiviert werden.',
    };
  }
  const parsed = parseHouseholdConfig(payload?.householdConfig);
  if (!parsed.ok) {
    return {
      code: 'SETUP_INVALID_HOUSEHOLD_CONFIG',
      message: `The household configuration is invalid (${parsed.issues.length} Probleme).`,
      issue: parsed.issues[0] ?? null,
    };
  }
  try {
    projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
  } catch (error) {
    return {
      code: error && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'HOUSEHOLD_CONFIG_PROJECTION_FAILED',
      message: error instanceof Error
        ? error.message
        : 'Die Haushaltskonfiguration kann nicht aktiviert werden.',
    };
  }
  return {
    haUrl,
    haToken: supervisor ? null : payload.haToken.trim(),
    householdConfig: parsed.value,
    jellyfin,
  };
}

export async function verifySetupHomeAssistant(haUrl, haToken, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${haUrl}/api/config`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${haToken}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'SETUP_HOME_ASSISTANT_AUTH_FAILED',
        message: 'Home Assistant hat den Token abgelehnt.',
      };
    }
    return {
      ok: false,
      code: 'SETUP_HOME_ASSISTANT_HTTP_ERROR',
      message: `Home Assistant antwortet mit HTTP ${response.status}.`,
    };
  } catch {
    return {
      ok: false,
      code: 'SETUP_HOME_ASSISTANT_UNREACHABLE',
      message: 'Home Assistant ist vom Hauser-Server aus nicht erreichbar.',
    };
  }
}

/* Aktivierungsprüfung im App-Modus: derselbe Vertrag wie
   `verifySetupHomeAssistant`, aber über den internen Zugang und ohne jede
   Nutzereingabe. Fehlt die Berechtigung, wird das gemeldet — es gibt keinen
   Rückfall auf eine HA-Adresse oder einen Long-Lived Access Token. */
export async function verifySetupSupervisorHomeAssistant(client) {
  try {
    const result = await client.rest('GET', '/api/config');
    if (result.status === 200) return { ok: true };
    return {
      ok: false,
      code: 'HA_SUPERVISOR_HTTP_ERROR',
      message: 'Home Assistant hat die interne Anfrage abgelehnt.',
    };
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
      message: typeof error?.message === 'string'
        ? error.message
        : 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
    };
  }
}

export async function verifySetupJellyfin(url, accessToken, userId, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${url}/Users/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-emby-token': accessToken,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'SETUP_JELLYFIN_AUTH_FAILED',
        message: 'Jellyfin hat die geprüfte Anmeldung abgelehnt.',
      };
    }
    return {
      ok: false,
      code: 'SETUP_JELLYFIN_HTTP_ERROR',
      message: `Jellyfin antwortet mit HTTP ${response.status}.`,
    };
  } catch {
    return {
      ok: false,
      code: 'SETUP_JELLYFIN_UNREACHABLE',
      message: 'Jellyfin ist vom Hauser-Server aus nicht erreichbar.',
    };
  }
}

/* Ein Supervisor-Client pro Anfrage: der interne Zugang wird geöffnet,
   benutzt und wieder geschlossen, statt über Anfragen hinweg zu leben. */
export async function withSupervisorClient(clientFactory, use) {
  const client = clientFactory();
  try { return await use(client); } finally { client.close(); }
}

/* CalDAV-/iCloud-Einrichtung im App-Modus: der HA-Config-Flow läuft über den
   internen Zugang statt über direktes Browser-REST mit CORS. Das App-Passwort
   wird durchgereicht und nie gespeichert oder geloggt. */
export async function serveHaCaldavFlow(req, res, { connectionMode, supervisorClientFactory }) {
  if (connectionMode !== 'supervisor') {
    jsonResponse(res, 404, {
      ok: false,
      code: 'HA_CALDAV_FLOW_NOT_AVAILABLE',
      message: 'Der serverseitige CalDAV-Flow gibt es nur im Home-Assistant-App-Modus.',
    });
    return;
  }
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > 64 * 1024) oversized = true;
  });
  req.on('end', async () => {
    if (oversized) {
      jsonResponse(res, 413, { ok: false, code: 'HA_CALDAV_REQUEST_TOO_LARGE', message: 'Die Anfrage ist zu groß.' });
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (!username || !password) {
      jsonResponse(res, 400, {
        ok: false, code: 'HA_CALDAV_INVALID_REQUEST',
        message: 'Apple-ID und App-Passwort werden benötigt.',
      });
      return;
    }
    try {
      const result = await withSupervisorClient(supervisorClientFactory, async (client) => {
        const started = await client.rest('POST', '/api/config/config_entries/flow', {
          handler: 'caldav', show_advanced_options: false,
        });
        if (started.status === 404) {
          return { httpStatus: 404, payload: { ok: false, code: 'HA_CALDAV_NOT_AVAILABLE', message: 'Die CalDAV-Integration ist in dieser Home-Assistant-Version nicht verfügbar.' } };
        }
        const flowId = started.body?.flow_id;
        if (started.status >= 400 || typeof flowId !== 'string' || !flowId) {
          return { httpStatus: 502, payload: { ok: false, code: 'HA_CALDAV_FLOW_FAILED', message: 'Home Assistant hat den CalDAV-Flow nicht gestartet.' } };
        }
        const step = await client.rest('POST', `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`, {
          url: 'https://caldav.icloud.com', username, password, verify_ssl: true,
        });
        if (step.status >= 400 || !step.body || typeof step.body !== 'object') {
          return { httpStatus: 502, payload: { ok: false, code: 'HA_CALDAV_FLOW_FAILED', message: 'Home Assistant hat den CalDAV-Flow abgebrochen.' } };
        }
        return { httpStatus: 200, payload: { ok: true, result: step.body } };
      });
      jsonResponse(res, result.httpStatus, result.payload);
    } catch (error) {
      jsonResponse(res, Number.isInteger(error?.status) ? error.status : 502, {
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
        message: typeof error?.message === 'string'
          ? error.message
          : 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
      });
    }
  });
}

/* Einkaufsliste anlegen: dieselbe Mechanik wie beim CalDAV-Flow, nur für die
   Integration „Local To-do". Jeder Laden bekommt so eine eigene `todo.*`-Liste,
   ohne dass jemand dafür die Home-Assistant-Oberfläche öffnen muss. */
export async function serveHaTodoListFlow(req, res, { connectionMode, supervisorClientFactory }) {
  if (connectionMode !== 'supervisor') {
    jsonResponse(res, 404, {
      ok: false,
      code: 'HA_TODO_FLOW_NOT_AVAILABLE',
      message: 'Listen kann nur der Home-Assistant-App-Modus anlegen; sonst in Home Assistant selbst anlegen.',
    });
    return;
  }
  readSmallJson(req, res, async (payload) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim().slice(0, 60) : '';
    if (!name) {
      jsonResponse(res, 400, { ok: false, code: 'HA_TODO_INVALID_REQUEST', message: 'Ein Listenname wird benötigt.' });
      return;
    }
    try {
      const result = await withSupervisorClient(supervisorClientFactory, async (client) => {
        const started = await client.rest('POST', '/api/config/config_entries/flow', {
          handler: 'local_todo', show_advanced_options: false,
        });
        if (started.status === 404) {
          return { httpStatus: 404, payload: { ok: false, code: 'HA_TODO_NOT_AVAILABLE', message: 'Die Integration „Local To-do" ist in dieser Home-Assistant-Version nicht verfügbar.' } };
        }
        const flowId = started.body?.flow_id;
        if (started.status >= 400 || typeof flowId !== 'string' || !flowId) {
          return { httpStatus: 502, payload: { ok: false, code: 'HA_TODO_FLOW_FAILED', message: 'Home Assistant hat den Listen-Flow nicht gestartet.' } };
        }
        const step = await client.rest('POST', `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`, {
          todo_list_name: name,
        });
        if (step.status >= 400 || step.body?.type !== 'create_entry') {
          return { httpStatus: 502, payload: { ok: false, code: 'HA_TODO_FLOW_FAILED', message: 'Home Assistant hat die Liste nicht angelegt.' } };
        }
        return { httpStatus: 200, payload: { ok: true, title: step.body?.title ?? name } };
      });
      jsonResponse(res, result.httpStatus, result.payload);
    } catch (error) {
      jsonResponse(res, Number.isInteger(error?.status) ? error.status : 502, {
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
        message: typeof error?.message === 'string'
          ? error.message
          : 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
      });
    }
  });
}

/* Same-Origin-Laufzeitauskunft: sagt Wizard und Runtime, ob dieser Server die
   Home-Assistant-Verbindung selbst vermittelt. Antwortet in beiden Betriebsarten
   und liefert nie Credentials. */
/* Kamera-Bilder im App-Modus: Der Browser kennt dort keine HA-Adresse und
   keinen Token; er lädt Standbild und MJPEG-Strom von diesem Ursprung, der
   Server reicht beides über den internen Zugang durch. Der kurzlebige
   Kamera-Token aus `entity_picture` wird als Query mitgegeben und von HA
   selbst geprüft; die Autorisierung trägt der Supervisor-Token. */
const HA_CAMERA_PROXY_PATTERN = /^\/api\/camera_proxy(?:_stream)?\/camera\.[a-z0-9_]+(?:\?[A-Za-z0-9_=&.-]*)?$/;

/* Der Livestream kommt als signierter HLS-Pfad aus `camera/stream`; die
   Signatur steckt im Pfad, HA prüft sie selbst. Playlisten, Init-Segment und
   Mediensegmente liegen alle unterhalb desselben Präfixes. */
const HA_HLS_PROXY_PATTERN = /^\/api\/hls\/[A-Za-z0-9._~-]{1,512}(?:\/[A-Za-z0-9._-]{1,64}){1,3}$/;

export function haCameraProxyRoute(url) {
  if (url.includes('..')) return false;
  return HA_CAMERA_PROXY_PATTERN.test(url) || HA_HLS_PROXY_PATTERN.test(url);
}

export async function serveHaCameraProxy(req, res, { connectionMode, supervisorClientFactory }) {
  if (connectionMode !== 'supervisor') {
    jsonResponse(res, 404, { ok: false, code: 'HA_CAMERA_PROXY_NOT_AVAILABLE' });
    return;
  }
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const client = supervisorClientFactory();
  try {
    const upstream = await client.stream(req.url, { signal: controller.signal });
    if (controller.signal.aborted) return;
    const headers = { 'cache-control': 'no-store' };
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    res.writeHead(upstream.status, headers);
    if (!upstream.body) { res.end(); return; }
    Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res);
  } catch (error) {
    if (controller.signal.aborted) return;
    jsonResponse(res, typeof error?.status === 'number' ? error.status : 502, {
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
    });
  } finally {
    client.close();
  }
}

export function serveHaConnection(res, { connectionMode, supervisorAvailable }) {
  jsonResponse(res, 200, {
    ok: true,
    mode: connectionMode,
    credentialsRequired: connectionMode !== 'supervisor',
    available: connectionMode === 'supervisor' ? supervisorAvailable : true,
    gatewayPath: connectionMode === 'supervisor' ? HA_GATEWAY_PATH : null,
  }, { 'cache-control': 'no-store' });
}

/* Areas, Geräte, Entitäten und States über den internen Zugang. Nur im
   App-Modus erreichbar; im direkten Modus entdeckt weiterhin der Browser. */
export async function serveSetupDiscovery(res, { connectionMode, supervisorClientFactory }) {
  if (connectionMode !== 'supervisor') {
    jsonResponse(res, 404, {
      ok: false,
      code: 'SETUP_DISCOVERY_NOT_AVAILABLE',
      message: 'Die serverseitige Entdeckung gibt es nur im Home-Assistant-App-Modus.',
    });
    return;
  }
  try {
    const snapshot = await withSupervisorClient(supervisorClientFactory, readHaDiscoverySnapshot);
    jsonResponse(res, 200, { ok: true, ...snapshot }, { 'cache-control': 'no-store' });
  } catch (error) {
    jsonResponse(res, Number.isInteger(error?.status) ? error.status : 502, {
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
      message: typeof error?.message === 'string'
        ? error.message
        : 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
    });
  }
}

export function serveSetupActivation(
  req,
  res,
  {
    configStore,
    householdConfigPath,
    setupConnectionVerifier,
    setupJellyfinVerifier,
    configMutations,
    setupMutationStep,
    latchSetupRecoveryFailure,
    assertSetupRecoveryHealthy,
    reconfigure = false,
    connectionMode = 'direct',
    supervisorConnectionVerifier = null,
  },
) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > HOUSEHOLD_CONFIG_BODY_MAX) oversized = true;
  });
  req.on('end', async () => {
    if (oversized) {
      jsonResponse(res, 413, {
        ok: false,
        code: 'SETUP_REQUEST_TOO_LARGE',
        message: 'Die Setup-Anfrage ist größer als 1 MiB.',
      });
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const supervisor = connectionMode === 'supervisor';
    const result = setupPayloadError(payload, connectionMode);
    if (!('householdConfig' in result)) {
      jsonResponse(res, 400, { ok: false, ...result });
      return;
    }
    if (!householdConfigPath) {
      jsonResponse(res, 500, {
        ok: false,
        code: 'SETUP_CONFIG_PATH_NOT_CONFIGURED',
        message: 'Der Zielpfad für die Haushaltskonfiguration fehlt.',
      });
      return;
    }
    const householdMatches = rawHeaderValues(req, 'if-match');
    const sharedMatches = rawHeaderValues(req, 'x-hauser-shared-config-if-match');
    let sharedAtRequest;
    try { sharedAtRequest = configStore.responseSnapshot(); } catch {
      jsonResponse(res, 503, setupRecoveryFailure());
      return;
    }
    if ((reconfigure && householdMatches.length !== 1)
        || sharedMatches.length > 1
        || ((reconfigure || sharedAtRequest.exists) && sharedMatches.length !== 1)) {
      jsonResponse(res, 428, {
        ok: false, code: 'CONFIG_PRECONDITION_REQUIRED',
        message: 'Die erforderlichen Household-/Shared-Config-ETags fehlen oder sind mehrdeutig.',
      });
      return;
    }
    const connection = supervisor
      ? await supervisorConnectionVerifier()
      : await setupConnectionVerifier(result.haUrl, result.haToken);
    if (!connection.ok) {
      jsonResponse(res, 502, connection);
      return;
    }
    if (result.jellyfin.enabled) {
      const jellyfinConnection = await setupJellyfinVerifier(
        result.jellyfin.url,
        result.jellyfin.accessToken,
        result.jellyfin.userId,
      );
      if (!jellyfinConnection.ok) {
        jsonResponse(res, 502, jellyfinConnection);
        return;
      }
    }
    let temporary = null;
    let activatedHouseholdConfig = result.householdConfig;
    const sharedConfigUpdates = {
      'hmi:backend': 'ha',
      /* Im App-Modus wird bewusst kein HA-Zugang in die Shared Config
         geschrieben; der interne Zugang lebt nur im Serverprozess. */
      'hmi:ha-url': supervisor ? null : result.haUrl,
      'hmi:ha-token': supervisor ? null : result.haToken,
      'hmi:jf-url': result.jellyfin.enabled ? result.jellyfin.url : null,
      'hmi:jf-token': result.jellyfin.enabled ? result.jellyfin.accessToken : null,
      'hmi:jf-user': result.jellyfin.enabled ? result.jellyfin.userId : null,
      'hmi:library': result.jellyfin.enabled ? 'live' : 'fake',
    };
    try {
      await configMutations.run(async () => {
        assertSetupRecoveryHealthy();
        if (reconfigure) {
          const current = readRoomImageHouseholdSnapshot(householdConfigPath);
          if (householdMatches[0] !== current.etag) {
            throw Object.assign(new Error('stale household config'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
          }
          const merged = structuredClone(result.householdConfig);
          merged.globalEntities.laundry = structuredClone(current.document.globalEntities.laundry);
          const parsed = parseHouseholdConfig(merged);
          if (!parsed.ok) throw new Error('merged setup config is invalid');
          projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
          activatedHouseholdConfig = merged;
        } else if (existsSync(householdConfigPath)) {
          throw Object.assign(new Error('household config appeared'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
        }
        const currentShared = configStore.responseSnapshot();
        if (currentShared.exists !== sharedAtRequest.exists
            || !currentShared.body.equals(sharedAtRequest.body)) {
          throw Object.assign(new Error('stale shared existence or bytes'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
        }
        if (reconfigure || sharedAtRequest.exists || sharedMatches.length === 1) {
          if (sharedMatches[0] !== strongByteEtag(sharedAtRequest.body)) {
            throw Object.assign(new Error('stale shared config'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
          }
        }
        const preparedShared = configStore.prepareUpdate(sharedConfigUpdates);
        await commitSetupConfigTransaction({
          configPath: configStore.path,
          householdConfigPath,
          sharedAfterBytes: preparedShared.bytes,
          householdAfterBytes: Buffer.from(`${JSON.stringify(activatedHouseholdConfig, null, 2)}\n`),
          setupMutationStep,
          latchSetupRecoveryFailure,
          assertSetupRecoveryHealthy,
        });
      });
      jsonResponse(res, reconfigure ? 200 : 201, {
        ok: true,
        status: reconfigure ? 'reconfigured' : 'activated',
        schemaVersion: activatedHouseholdConfig.schemaVersion,
      });
    } catch (error) {
      if (isSetupRecoveryRequiredError(error)) {
        jsonResponse(res, 503, setupRecoveryFailure());
        return;
      }
      if (error && typeof error === 'object' && error.recoveryError?.code === 'SETUP_CONFIG_RECOVERY_REQUIRED') {
        jsonResponse(res, 503, error.recoveryError);
        return;
      }
      if (error && typeof error === 'object' && error.code === 'CONFIG_PRECONDITION_FAILED') {
        jsonResponse(res, 412, {
          ok: false, code: 'CONFIG_PRECONDITION_FAILED',
          message: 'Eine Konfiguration wurde zwischen Vorprüfung und Commit geändert.',
        });
        return;
      }
      jsonResponse(res, 500, {
        ok: false,
        code: reconfigure ? 'SETUP_RECONFIGURATION_FAILED' : 'SETUP_ACTIVATION_FAILED',
        message: reconfigure
          ? 'Die bestehende Konfiguration blieb aktiv; die Änderungen konnten nicht gespeichert werden.'
          : 'Die Konfiguration konnte nicht atomar aktiviert werden.',
      });
    }
  });
}
