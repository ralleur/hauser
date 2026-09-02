/*
 * B-08E11 — serverseitiger Home-Assistant-Zugang im App-Modus.
 *
 * Dieses Modul kapselt den einzigen Weg, auf dem der Hauser-Server Home
 * Assistant erreicht, wenn Hauser als Home-Assistant-App läuft: die internen
 * Supervisor-Endpunkte mit dem `SUPERVISOR_TOKEN` aus der Prozessumgebung.
 * Der Token verlässt diesen Serverprozess nie — weder in Fehlern, Logs,
 * serialisierten Objekten noch in Richtung Browser.
 *
 * Siehe docs/17-ha-app-trusted-lan-plan.md, Session 1.
 */

export const HA_CONNECTION_MODES = Object.freeze(['direct', 'supervisor']);
export const HA_SUPERVISOR_CORE_URL = 'http://supervisor/core/';
export const HA_SUPERVISOR_REST_BASE_URL = `${HA_SUPERVISOR_CORE_URL}api/`;
export const HA_SUPERVISOR_WEBSOCKET_URL = 'ws://supervisor/core/websocket';

const SUPERVISOR_RESPONSE_BODY_MAX = 8 * 1024 * 1024;
const REDACTED = '[redacted]';

export function createHaSupervisorError(code, status, message) {
  return Object.assign(new Error(message), {
    code,
    status,
    toJSON() {
      return { name: 'HaSupervisorError', code: this.code, status: this.status, message: this.message };
    },
  });
}

const tokenMissingError = () => createHaSupervisorError(
  'HA_SUPERVISOR_TOKEN_MISSING', 503,
  'Der Home-Assistant-App-Zugang fehlt; die App wurde ohne Supervisor-Token gestartet.',
);
const authFailedError = () => createHaSupervisorError(
  'HA_SUPERVISOR_AUTH_FAILED', 502, 'Home Assistant hat den internen App-Zugang abgelehnt.',
);
const timeoutError = () => createHaSupervisorError(
  'HA_SUPERVISOR_TIMEOUT', 504, 'Home Assistant hat nicht rechtzeitig geantwortet.',
);
const unreachableError = () => createHaSupervisorError(
  'HA_SUPERVISOR_UNREACHABLE', 502, 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
);
const connectionLostError = () => createHaSupervisorError(
  'HA_SUPERVISOR_CONNECTION_LOST', 502, 'Die interne Home-Assistant-Verbindung wurde beendet.',
);
const invalidResponseError = () => createHaSupervisorError(
  'HA_SUPERVISOR_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.',
);
const httpError = () => createHaSupervisorError(
  'HA_SUPERVISOR_HTTP_ERROR', 502, 'Home Assistant hat die interne Anfrage abgelehnt.',
);
const commandFailedError = () => createHaSupervisorError(
  'HA_SUPERVISOR_COMMAND_FAILED', 502, 'Home Assistant hat den internen Befehl abgelehnt.',
);

/*
 * Strikt: nur die beiden dokumentierten Werte sind zulässig. Ohne Wert bleibt
 * `direct` der Default, damit Compose und Entwicklung unverändert laufen. Ein
 * Tippfehler startet den Dienst nicht mit stillem Fallback, sondern gar nicht.
 */
export function parseHaConnectionMode(value) {
  if (value === undefined || value === null || value === '') return 'direct';
  if (typeof value === 'string' && HA_CONNECTION_MODES.includes(value)) return value;
  throw createHaSupervisorError(
    'HA_CONNECTION_MODE_INVALID', 500,
    `HMI_HA_CONNECTION_MODE muss ${HA_CONNECTION_MODES.join(' oder ')} sein.`,
  );
}

export function readSupervisorToken(env = process.env) {
  const raw = env?.SUPERVISOR_TOKEN;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/*
 * Letzte Verteidigungslinie für alles, was den Serverprozess als Text verlässt:
 * ein versehentlich mitgeführter Supervisor-Token wird ersetzt statt geloggt.
 */
export function redactSupervisorToken(value, token = readSupervisorToken()) {
  if (!token) return value;
  if (typeof value === 'string') return value.split(token).join(REDACTED);
  if (value instanceof Error) {
    if (typeof value.message === 'string') value.message = value.message.split(token).join(REDACTED);
    return value;
  }
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value).split(token).join(REDACTED));
  } catch {
    return value;
  }
}

async function supervisorWebSocketMessage(socket, timeoutMs, accept) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    const timeout = setTimeout(() => finish(timeoutError()), timeoutMs);
    const onError = () => finish(unreachableError());
    const onClose = () => finish(connectionLostError());
    const onMessage = async (event) => {
      try {
        const text = typeof event.data === 'string' ? event.data
          : event.data instanceof Blob ? await event.data.text()
            : Buffer.from(event.data).toString('utf8');
        const message = JSON.parse(text);
        if (accept(message)) finish(null, message);
      } catch { /* fremde oder defekte Frames laufen in den Timeout */ }
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
  });
}

export function createHaSupervisorClient({
  env = process.env,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  timeoutMs = 5_000,
  coreBaseUrl = HA_SUPERVISOR_CORE_URL,
  websocketUrl = HA_SUPERVISOR_WEBSOCKET_URL,
} = {}) {
  /* Einmal beim App-Start gelesen und nur in dieser Closure gehalten. */
  const token = readSupervisorToken(env);

  let socket = null;
  let candidateSocket = null;
  let connecting = null;
  let nextId = 1;
  const closedConnections = new WeakSet();

  function closeConnection(connection) {
    if (!connection || closedConnections.has(connection)) return;
    closedConnections.add(connection);
    try { connection.close(); } catch { /* best effort */ }
  }

  function requireToken() {
    if (!token) throw tokenMissingError();
    return token;
  }

  async function connect() {
    requireToken();
    if (socket?.readyState === WebSocketImpl.OPEN) return socket;
    if (connecting) return connecting;
    const attempt = (async () => {
      const candidate = new WebSocketImpl(websocketUrl);
      candidateSocket = candidate;
      try {
        const required = await supervisorWebSocketMessage(
          candidate, timeoutMs, (message) => message?.type === 'auth_required',
        );
        if (required.type !== 'auth_required') throw invalidResponseError();
        const authentication = supervisorWebSocketMessage(candidate, timeoutMs, (message) => (
          message?.type === 'auth_ok' || message?.type === 'auth_invalid'
        ));
        candidate.send(JSON.stringify({ type: 'auth', access_token: token }));
        const authenticated = await authentication;
        if (authenticated.type !== 'auth_ok') throw authFailedError();
        socket = candidate;
        if (candidateSocket === candidate) candidateSocket = null;
        return socket;
      } catch (error) {
        if (candidateSocket === candidate) candidateSocket = null;
        closeConnection(candidate);
        throw redactSupervisorToken(error, token);
      }
    })();
    connecting = attempt;
    try { return await attempt; } finally { if (connecting === attempt) connecting = null; }
  }

  async function rest(method, path, body = undefined) {
    const accessToken = requireToken();
    let response;
    try {
      /* Aufrufer übergeben dieselben HA-Pfade wie im direkten Modus
         (`/api/states`); aufgelöst werden sie gegen die interne Core-Wurzel. */
      response = await fetchImpl(new URL(path.replace(/^\//, ''), coreBaseUrl), {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw error?.name === 'TimeoutError' ? timeoutError() : unreachableError();
    }
    if (response.status === 401 || response.status === 403) throw authFailedError();
    let responseBody = null;
    let text;
    try {
      text = await response.text();
    } catch {
      throw connectionLostError();
    }
    if (Buffer.byteLength(text) > SUPERVISOR_RESPONSE_BODY_MAX) throw invalidResponseError();
    if (text) {
      try { responseBody = JSON.parse(text); } catch { throw invalidResponseError(); }
    }
    return { status: response.status, body: responseBody };
  }

  /* Roh-Durchleitung ohne Body-Grenze und ohne Zeitlimit — für Kamera-Bilder
     und MJPEG-Streams, die der Server an den Browser weiterreicht. Der
     Aufrufer beendet den Strom über `signal`. */
  async function stream(path, { signal } = {}) {
    const accessToken = requireToken();
    let response;
    try {
      response = await fetchImpl(new URL(path.replace(/^\//, ''), coreBaseUrl), {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
        signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw error?.name === 'TimeoutError' ? timeoutError() : unreachableError();
    }
    if (response.status === 401 || response.status === 403) throw authFailedError();
    return response;
  }

  async function ws(type, payload = {}) {
    const connection = await connect();
    const id = nextId;
    nextId += 1;
    const resultPromise = supervisorWebSocketMessage(
      connection, timeoutMs, (message) => message?.id === id && message?.type === 'result',
    );
    connection.send(JSON.stringify({ id, type, ...payload }));
    const message = await resultPromise;
    if (message.success !== true) throw commandFailedError();
    return message.result;
  }

  function close() {
    const candidates = new Set([candidateSocket, socket].filter(Boolean));
    candidateSocket = null;
    socket = null;
    connecting = null;
    for (const connection of candidates) closeConnection(connection);
  }

  return {
    get available() { return token !== null; },
    close,
    rest,
    stream,
    ws,
    /* Diagnose und Logging sehen den Zugang, aber nie den Token. */
    toJSON() {
      return {
        mode: 'supervisor',
        restBaseUrl: new URL('api/', coreBaseUrl).toString(),
        websocketUrl,
        tokenPresent: token !== null,
      };
    },
  };
}

/*
 * Der Setup-Snapshot in genau der Form, die die bestehende deterministische
 * `setup-household`-Projektion erwartet — nur über den internen Zugang statt
 * aus dem Browser. Alles, was nicht die erwartete Liste ist, gilt als ungültige
 * HA-Antwort statt als leeres Ergebnis.
 */
export async function readHaDiscoverySnapshot(client) {
  const stateResult = await client.rest('GET', '/api/states');
  if (stateResult.status !== 200) throw httpError();
  if (!Array.isArray(stateResult.body)) throw invalidResponseError();
  const [areas, devices, entities] = await Promise.all([
    client.ws('config/area_registry/list'),
    client.ws('config/device_registry/list'),
    client.ws('config/entity_registry/list'),
  ]);
  if (!Array.isArray(areas) || !Array.isArray(devices) || !Array.isArray(entities)) {
    throw invalidResponseError();
  }
  return {
    areas,
    devices,
    entities,
    states: stateResult.body.map((state) => ({
      entity_id: state?.entity_id,
      attributes: state?.attributes ?? {},
    })),
  };
}
