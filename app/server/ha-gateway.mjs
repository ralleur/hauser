/*
 * B-08E11 — Same-Origin-WebSocket-Gateway zwischen Hauser-Browser und dem
 * internen Home-Assistant-Core.
 *
 * Der Browser spricht denselben HA-WebSocket-Vertrag wie im direkten Modus,
 * sieht aber nie ein echtes Credential: der Downstream-Handshake ist
 * HA-kompatibel, der `SUPERVISOR_TOKEN` wird ausschließlich im Upstream
 * verwendet. Weitergeleitet wird nur, was auf beiden Seiten ausdrücklich
 * erlaubt ist — dies ist keine offene Bridge zu Home Assistant.
 *
 * Siehe docs/17-ha-app-trusted-lan-plan.md, Session 3.
 */

import { WebSocketServer } from 'ws';
import { HA_SUPERVISOR_WEBSOCKET_URL, readSupervisorToken } from './ha-supervisor.mjs';

/* Der offizielle HA-Client bildet seine Adresse als `<basis>/api/websocket`.
   Same-Origin heißt hier deshalb exakt dieser Pfad — er spricht den
   HA-WebSocket-Vertrag und wird nur per Upgrade erreicht, nie per HTTP. */
export const HA_GATEWAY_PATH = '/api/websocket';

/* Was der Browser senden darf. Bewusst eine Aufzählung statt eines Präfixes:
   jede weitere Fähigkeit wird hier sichtbar freigeschaltet. */
export const HA_GATEWAY_CLIENT_MESSAGE_TYPES = Object.freeze([
  'auth',
  /* Der offizielle Client meldet direkt nach `auth_ok` seine Fähigkeiten. */
  'supported_features',
  'ping',
  'get_config',
  'get_states',
  'subscribe_entities',
  'subscribe_events',
  'unsubscribe_events',
  'config/area_registry/list',
  'config/device_registry/list',
  'config/entity_registry/list',
  /* Steuerung und Reconciliation; Kalenderereignisse laufen ebenfalls als
     `call_service` mit `return_response`. */
  'call_service',
  /* Gerät umbenennen (Einstellungen → Geräte). */
  'config/entity_registry/update',
  /* Erinnerungslisten derselben CalDAV-Quelle. */
  'todo/item/list',
  /* Benachrichtigungen (B-04B): Persistent Notifications spiegeln, Verlauf
     der Hauser-Automationen aus dem Logbuch. */
  'persistent_notification/subscribe',
  'logbook/get_events',
]);

/* Was Home Assistant an den Browser zurückgeben darf. Auth-Frames stehen
   absichtlich nicht darin: sie gehören dem Gateway und werden nie gespiegelt. */
export const HA_GATEWAY_SERVER_MESSAGE_TYPES = Object.freeze(['result', 'event', 'pong']);

/* Browserframes sind Kommandos, keine Nutzlast. Alles darüber ist ein Missbrauch. */
const CLIENT_FRAME_MAX = 64 * 1024;
/* Ein Browser, der die Zustandsflut nicht abnimmt, wird getrennt statt den
   Serverspeicher zu füllen. */
const DOWNSTREAM_BUFFER_MAX = 8 * 1024 * 1024;
const CLOSE_POLICY = 1008;
const CLOSE_INTERNAL = 1011;
const CLOSE_OVERLOADED = 1013;

function parseFrame(data) {
  try {
    const message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    return message && typeof message === 'object' && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}

/* Hat der Browser `coalesce_messages` ausgehandelt, buendelt Home Assistant
   mehrere Nachrichten zu EINEM Array-Frame. Ein Buendel traegt selbst keinen
   `type` und fiel deshalb der Einzelframe-Pruefung zum Opfer — mitsamt der
   `result`-Antwort, auf die der Client seine Subscription stuetzt. Genau die
   wird gebuendelt, weil sie zusammen mit dem ersten Zustandsereignis anfaellt.
   Ausgepackt wird deshalb hier; die Allowlist gilt unveraendert je Nachricht. */
function parseServerFrames(data) {
  try {
    const parsed = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return {
      batched: Array.isArray(parsed),
      frames: list.filter((frame) => frame && typeof frame === 'object' && typeof frame.type === 'string'),
    };
  } catch {
    return { batched: false, frames: [] };
  }
}

async function upstreamFrame(socket, timeoutMs, accept) {
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
    const timeout = setTimeout(() => finish(new Error('upstream timeout')), timeoutMs);
    const onError = () => finish(new Error('upstream error'));
    const onClose = () => finish(new Error('upstream closed'));
    const onMessage = async (event) => {
      const message = parseFrame(typeof event.data === 'string'
        ? event.data
        : event.data instanceof Blob ? await event.data.text() : event.data);
      if (message && accept(message)) finish(null, message);
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
  });
}

export function createHaWebSocketGateway({
  connectionMode = 'direct',
  env = process.env,
  originAllowed = () => true,
  WebSocketImpl = WebSocket,
  upstreamUrl = HA_SUPERVISOR_WEBSOCKET_URL,
  clientMessageTypes = HA_GATEWAY_CLIENT_MESSAGE_TYPES,
  serverMessageTypes = HA_GATEWAY_SERVER_MESSAGE_TYPES,
  handshakeTimeoutMs = 10_000,
} = {}) {
  /* Solange die App nicht umgeschaltet ist, existiert das Gateway nicht. */
  const enabled = connectionMode === 'supervisor';
  const allowedClientTypes = new Set(clientMessageTypes);
  const allowedServerTypes = new Set(serverMessageTypes);
  const server = enabled
    ? new WebSocketServer({ noServer: true, maxPayload: CLIENT_FRAME_MAX })
    : null;
  const sessions = new Set();

  function openSession(downstream) {
    let upstream = null;
    let ready = false;
    let authenticated = false;
    let haVersion = null;
    const session = {
      close() {
        try { downstream.close(); } catch { /* best effort */ }
        try { upstream?.close(); } catch { /* best effort */ }
      },
    };
    sessions.add(session);

    const shutdown = (code = CLOSE_INTERNAL) => {
      sessions.delete(session);
      try { downstream.close(code); } catch { /* best effort */ }
      try { upstream?.close(); } catch { /* best effort */ }
    };

    const toDownstream = (message) => {
      if (downstream.readyState !== downstream.OPEN) return;
      if (downstream.bufferedAmount > DOWNSTREAM_BUFFER_MAX) {
        shutdown(CLOSE_OVERLOADED);
        return;
      }
      downstream.send(JSON.stringify(message));
    };

    downstream.on('close', () => shutdown());
    downstream.on('error', () => shutdown());

    /* Der offizielle HA-Client schickt `auth` unaufgefordert beim Öffnen, noch
       vor `auth_required`. Der Downstream-Handler hängt deshalb ab der ersten
       Sekunde und nicht erst nach dem Upstream-Handshake. */
    downstream.on('message', (data) => {
      const message = parseFrame(data);
      if (!message || !allowedClientTypes.has(message.type)) {
        shutdown(CLOSE_POLICY);
        return;
      }
      if (message.type === 'auth') {
        /* Der mitgeschickte Wert ist bedeutungslos und wird nie
           weitergereicht; authentifiziert ist bereits der Server. */
        if (authenticated) {
          shutdown(CLOSE_POLICY);
          return;
        }
        authenticated = true;
        if (ready) toDownstream({ type: 'auth_ok', ha_version: haVersion });
        return;
      }
      if (!authenticated || !ready) {
        shutdown(CLOSE_POLICY);
        return;
      }
      if (upstream.readyState !== WebSocketImpl.OPEN) {
        shutdown();
        return;
      }
      upstream.send(JSON.stringify(message));
    });

    void (async () => {
      const token = readSupervisorToken(env);
      /* Fail-closed: ohne internen Zugang wird die Verbindung beendet, nicht
         auf einen Browser-Token umgeleitet. */
      if (!token) {
        shutdown(CLOSE_INTERNAL);
        return;
      }
      try {
        upstream = new WebSocketImpl(upstreamUrl);
        const required = await upstreamFrame(
          upstream, handshakeTimeoutMs, (message) => message.type === 'auth_required',
        );
        haVersion = typeof required.ha_version === 'string' ? required.ha_version : null;
        const authentication = upstreamFrame(
          upstream, handshakeTimeoutMs,
          (message) => message.type === 'auth_ok' || message.type === 'auth_invalid',
        );
        upstream.send(JSON.stringify({ type: 'auth', access_token: token }));
        const result = await authentication;
        if (result.type !== 'auth_ok') throw new Error('upstream auth rejected');
        if (typeof result.ha_version === 'string') haVersion = result.ha_version;
      } catch {
        shutdown(CLOSE_INTERNAL);
        return;
      }
      if (downstream.readyState !== downstream.OPEN) {
        shutdown();
        return;
      }

      upstream.addEventListener('close', () => shutdown());
      upstream.addEventListener('error', () => shutdown());
      upstream.addEventListener('message', async (event) => {
        const { batched, frames } = parseServerFrames(typeof event.data === 'string'
          ? event.data
          : event.data instanceof Blob ? await event.data.text() : event.data);
        /* Unbekannte oder Auth-Frames erreichen den Browser nicht. */
        const allowed = frames.filter((frame) => allowedServerTypes.has(frame.type));
        if (!allowed.length) return;
        toDownstream(batched ? allowed : allowed[0]);
      });

      ready = true;
      /* Ab hier spricht der Browser den gewohnten HA-Vertrag — mit einem
         Handshake, den das Gateway selbst beantwortet. */
      toDownstream({ type: 'auth_required', ha_version: haVersion });
      if (authenticated) toDownstream({ type: 'auth_ok', ha_version: haVersion });
    })();
  }

  return {
    get enabled() { return enabled; },
    get path() { return HA_GATEWAY_PATH; },
    get openSessions() { return sessions.size; },
    /* Genau ein Pfad wird zum WebSocket erhoben, alles andere bleibt HTTP. */
    handlesUpgrade(req) {
      if (!enabled) return false;
      try {
        return new URL(req.url || '/', 'http://hauser.local').pathname === HA_GATEWAY_PATH;
      } catch {
        return false;
      }
    },
    handleUpgrade(req, socket, head) {
      if (!originAllowed(req)) {
        socket.destroy();
        return;
      }
      server.handleUpgrade(req, socket, head, (downstream) => openSession(downstream));
    },
    close() {
      for (const session of [...sessions]) session.close();
      sessions.clear();
      server?.close();
    },
  };
}
