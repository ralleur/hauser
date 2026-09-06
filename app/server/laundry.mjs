/* Wäsche-Setup: Validierung, Blueprint-Pfad und Home-Assistant-Koordination.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  HA_CONNECTION_MODE,
  HOUSEHOLD_CONFIG_BODY_MAX,
  LAUNDRY_BLUEPRINT_PATH,
  LAUNDRY_BODY_MAX,
  LAUNDRY_SESSION_TTL_MS,
  compileHouseholdConfig,
  parseHouseholdConfig,
  projectActiveHouseholdData,
} from './runtime-env.mjs';
import { jsonResponse } from './shared.mjs';
import { isSetupRecoveryRequiredError } from './config-core.mjs';
import { haRestUrl, resolveServerHaAccess } from './setup.mjs';

function createLaundryError(code, status, message, details = {}) {
  return Object.assign(new Error(message), { code, status, details });
}

function laundryPublicError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return {
      status: Number.isInteger(error.status) ? error.status : 502,
      payload: {
        ok: false,
        code: error.code,
        message: typeof error.message === 'string' ? error.message : 'Die Wäsche-Konfiguration ist fehlgeschlagen.',
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
      },
    };
  }
  return {
    status: 502,
    payload: {
      ok: false,
      code: 'LAUNDRY_HOME_ASSISTANT_ERROR',
      message: 'Home Assistant konnte die Wäsche-Konfiguration nicht ausführen.',
    },
  };
}

function laundryExactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function laundryCanonical(value) {
  if (Array.isArray(value)) return value.map(laundryCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, laundryCanonical(value[key])]));
  }
  return value;
}

export function laundryFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(laundryCanonical(value))).digest('hex');
}

function normalizeLaundryPowerUnit(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeLaundryEntityId(value, domains) {
  if (typeof value !== 'string' || value.length > 255) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(normalized)) return null;
  return domains.includes(normalized.split('.')[0]) ? normalized : null;
}

function normalizeLaundryStates(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return null;
  const states = value.map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase() : '');
  if (states.some((state) => !state || state.length > 128 || ['unknown', 'unavailable'].includes(state))) return null;
  return new Set(states).size === states.length ? states : null;
}

function normalizeExistingLaundryPayload(payload) {
  if (!laundryExactObject(payload, ['device', 'entityId', 'runningStates', 'doneStates', 'doneOnInitial'])) return null;
  if (!['washer', 'dryer'].includes(payload.device) || typeof payload.doneOnInitial !== 'boolean') return null;
  const entityId = normalizeLaundryEntityId(payload.entityId, ['input_boolean', 'input_select', 'binary_sensor', 'sensor', 'select']);
  const runningStates = normalizeLaundryStates(payload.runningStates);
  const doneStates = normalizeLaundryStates(payload.doneStates);
  if (!entityId || !runningStates || !doneStates || doneStates.some((state) => runningStates.includes(state))) return null;
  return {
    device: payload.device,
    adapter: { type: 'entity', entityId, runningStates, doneStates, doneOnInitial: payload.doneOnInitial },
  };
}

function normalizeBlueprintLaundryPayload(payload) {
  if (!laundryExactObject(payload, [
    'device', 'powerSensorEntityId', 'startThreshold', 'endThreshold', 'startHoldSeconds', 'endHoldSeconds',
  ])) return null;
  if (!['washer', 'dryer'].includes(payload.device)) return null;
  const powerSensorEntityId = normalizeLaundryEntityId(payload.powerSensorEntityId, ['sensor']);
  const numbers = ['startThreshold', 'endThreshold', 'startHoldSeconds', 'endHoldSeconds'];
  if (!powerSensorEntityId || numbers.some((key) => typeof payload[key] !== 'number' || !Number.isFinite(payload[key]))) return null;
  if (Math.abs(payload.startThreshold) > 1_000_000 || Math.abs(payload.endThreshold) > 1_000_000
      || payload.endThreshold >= payload.startThreshold
      || !Number.isInteger(payload.startHoldSeconds) || !Number.isInteger(payload.endHoldSeconds)
      || payload.startHoldSeconds < 1 || payload.startHoldSeconds > 3_600
      || payload.endHoldSeconds < 1 || payload.endHoldSeconds > 3_600) return null;
  return {
    device: payload.device,
    inputs: {
      powerSensorEntityId,
      startThreshold: payload.startThreshold,
      endThreshold: payload.endThreshold,
      startHoldSeconds: payload.startHoldSeconds,
      endHoldSeconds: payload.endHoldSeconds,
    },
  };
}

function readLaundryHouseholdSnapshot(path) {
  if (!path) throw createLaundryError('LAUNDRY_CONFIG_NOT_CONFIGURED', 503, 'Der Pfad zur Haushaltskonfiguration fehlt.');
  let bytes;
  try { bytes = readFileSync(path); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_UNREADABLE', 500, 'Die Haushaltskonfiguration konnte nicht gelesen werden.');
  }
  if (bytes.length > HOUSEHOLD_CONFIG_BODY_MAX) {
    throw createLaundryError('LAUNDRY_CONFIG_TOO_LARGE', 413, 'Die Haushaltskonfiguration ist größer als 1 MiB.');
  }
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'The household configuration is not valid JSON.');
  }
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die Haushaltskonfiguration ist ungültig.');
  try { projectActiveHouseholdData(compileHouseholdConfig(parsed.value)); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die Haushaltskonfiguration kann nicht aktiviert werden.');
  }
  return { bytes, document, parsed: parsed.value, fingerprint: laundryFingerprint(bytes.toString('base64')) };
}

function assertLaundryTargetUnchanged(session, snapshot) {
  const currentAdapter = snapshot.parsed.globalEntities.laundry[session.device] ?? null;
  if (laundryFingerprint(currentAdapter) !== session.previousAdapterFingerprint) {
    throw createLaundryError('LAUNDRY_CONFIG_CHANGED', 409, 'Der betroffene Wäsche-Adapter wurde seit der Prüfung geändert.');
  }
}

function writeLaundryAdapterAtomically(path, snapshot, device, adapter, replaceConfig = renameSync) {
  const document = structuredClone(snapshot.document);
  if (!document?.globalEntities?.laundry) {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Der Wäsche-Vertrag fehlt in der Haushaltskonfiguration.');
  }
  document.globalEntities.laundry[device] = adapter;
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die aktualisierte Haushaltskonfiguration ist ungültig.');
  try { projectActiveHouseholdData(compileHouseholdConfig(parsed.value)); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die aktualisierte Haushaltskonfiguration kann nicht aktiviert werden.');
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.laundry.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flush: true });
    chmodSync(temporary, 0o600);
    replaceConfig(temporary, path);
    chmodSync(path, 0o600);
  } catch {
    try { unlinkSync(temporary); } catch { /* no incomplete activation remains */ }
    throw createLaundryError('LAUNDRY_CONFIG_WRITE_FAILED', 500, 'Die bisherige Haushaltskonfiguration blieb aktiv.');
  }
}

async function laundryWebSocketMessage(socket, timeoutMs, accept) {
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
    const timeout = setTimeout(() => finish(createLaundryError(
      'LAUNDRY_HOME_ASSISTANT_TIMEOUT', 502, 'Home Assistant hat nicht rechtzeitig geantwortet.',
    )), timeoutMs);
    const onError = () => finish(createLaundryError(
      'LAUNDRY_HOME_ASSISTANT_UNREACHABLE', 502, 'Home Assistant ist nicht erreichbar.',
    ));
    const onClose = () => finish(createLaundryError(
      'LAUNDRY_HOME_ASSISTANT_UNREACHABLE', 502, 'Die Home-Assistant-Verbindung wurde beendet.',
    ));
    const onMessage = async (event) => {
      let text;
      try {
        text = typeof event.data === 'string' ? event.data
          : event.data instanceof Blob ? await event.data.text()
            : Buffer.from(event.data).toString('utf8');
        const message = JSON.parse(text);
        if (accept(message)) finish(null, message);
      } catch { /* unrelated or malformed frames are ignored until timeout */ }
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
  });
}

export function createLaundryHomeAssistantClient({
  baseUrl,
  token,
  /* Im App-Modus liegt der interne WebSocket nicht unter `/api/websocket`,
     sondern wird vom Zugangsauflöser mitgeliefert. */
  websocketUrl = null,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  timeoutMs = 5_000,
} = {}) {
  let socket = null;
  let candidateSocket = null;
  let nextId = 1;
  let connecting = null;
  const closedConnections = new WeakSet();
  function closeConnection(connection) {
    if (!connection || closedConnections.has(connection)) return;
    closedConnections.add(connection);
    try { connection.close(); } catch { /* best effort */ }
  }

  async function connect() {
    if (socket?.readyState === WebSocketImpl.OPEN) return socket;
    if (connecting) return connecting;
    const attempt = (async () => {
      let target;
      if (websocketUrl) {
        target = websocketUrl;
      } else {
        target = haRestUrl(baseUrl, 'api/websocket');
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
      }
      const candidate = new WebSocketImpl(target);
      candidateSocket = candidate;
      try {
        const required = await laundryWebSocketMessage(candidate, timeoutMs, (message) => message?.type === 'auth_required');
        if (required.type !== 'auth_required') throw createLaundryError(
          'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.',
        );
        const authentication = laundryWebSocketMessage(candidate, timeoutMs, (message) => (
          message?.type === 'auth_ok' || message?.type === 'auth_invalid'
        ));
        candidate.send(JSON.stringify({ type: 'auth', access_token: token }));
        const authenticated = await authentication;
        if (authenticated.type !== 'auth_ok') throw createLaundryError(
          'LAUNDRY_HOME_ASSISTANT_AUTH_FAILED', 502, 'Home Assistant hat die serverseitige Anmeldung abgelehnt.',
        );
        socket = candidate;
        if (candidateSocket === candidate) candidateSocket = null;
        return socket;
      } catch (error) {
        if (candidateSocket === candidate) candidateSocket = null;
        closeConnection(candidate);
        throw error;
      }
    })();
    connecting = attempt;
    try { return await attempt; } finally { if (connecting === attempt) connecting = null; }
  }

  async function rest(method, path, body = undefined) {
    let response;
    try {
      response = await fetchImpl(haRestUrl(baseUrl, path), {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_UNREACHABLE', 502, 'Home Assistant ist nicht erreichbar.');
    }
    if (response.status === 401 || response.status === 403) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_AUTH_FAILED', 502, 'Home Assistant hat die serverseitige Anmeldung abgelehnt.');
    }
    let responseBody = null;
    const text = await response.text();
    if (Buffer.byteLength(text) > HOUSEHOLD_CONFIG_BODY_MAX) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
    }
    if (text) {
      try { responseBody = JSON.parse(text); } catch {
        throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
      }
    }
    return { status: response.status, body: responseBody };
  }

  async function ws(type, payload = {}) {
    const connection = await connect();
    const id = nextId;
    nextId += 1;
    const resultPromise = laundryWebSocketMessage(connection, timeoutMs, (message) => message?.id === id && message?.type === 'result');
    connection.send(JSON.stringify({ id, type, ...payload }));
    const message = await resultPromise;
    if (message.success !== true) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_COMMAND_FAILED', 502, 'Home Assistant hat den Wäsche-Befehl abgelehnt.');
    }
    return message.result;
  }

  function close() {
    const candidates = new Set([candidateSocket, socket].filter(Boolean));
    candidateSocket = null;
    socket = null;
    connecting = null;
    for (const connection of candidates) closeConnection(connection);
  }
  return { close, rest, ws };
}

export async function laundryRest(client, method, path, body, allowedStatuses = [200]) {
  const result = await client.rest(method, path, body);
  if (!result || typeof result.status !== 'number' || !Object.hasOwn(result, 'body')) {
    throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
  }
  if (!allowedStatuses.includes(result.status)) {
    throw createLaundryError('LAUNDRY_HOME_ASSISTANT_HTTP_ERROR', 502, 'Home Assistant hat die Anfrage abgelehnt.');
  }
  return result;
}

async function readLaundrySource(client, entityId) {
  const stateResult = await laundryRest(client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404]);
  if (stateResult.status === 404) throw createLaundryError('LAUNDRY_SOURCE_MISSING', 422, 'Die Home-Assistant-Quelle wurde nicht gefunden.');
  const state = stateResult.body;
  if (!state || typeof state !== 'object' || state.entity_id !== entityId
      || typeof state.state !== 'string' || !state.attributes || typeof state.attributes !== 'object') {
    throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
  }
  if (['unknown', 'unavailable'].includes(state.state.toLowerCase())) {
    throw createLaundryError('LAUNDRY_SOURCE_UNAVAILABLE', 422, 'Die Home-Assistant-Quelle ist nicht verfügbar.');
  }
  let registry = null;
  try {
    const registryResult = await client.ws('config/entity_registry/get', { entity_id: entityId });
    if (registryResult && typeof registryResult === 'object' && registryResult.entity_id === entityId) {
      registry = registryResult;
    }
  } catch { /* Live state is authoritative; YAML entities need no registry row. */ }
  if (registry?.disabled_by) throw createLaundryError('LAUNDRY_SOURCE_UNAVAILABLE', 422, 'Die Home-Assistant-Quelle ist deaktiviert.');
  const attributes = state.attributes;
  const sourceFingerprint = laundryFingerprint({
    entityId,
    deviceClass: attributes.device_class ?? registry?.device_class ?? null,
    options: Array.isArray(attributes.options) ? attributes.options : null,
    unitOfMeasurement: normalizeLaundryPowerUnit(attributes.unit_of_measurement),
    registry: registry ? {
      unique_id: registry.unique_id ?? null,
      platform: registry.platform ?? null,
      config_entry_id: registry.config_entry_id ?? null,
      device_id: registry.device_id ?? null,
    } : null,
  });
  return { state, registry, sourceFingerprint };
}

function validateExistingLaundrySource(source, adapter) {
  const domain = adapter.entityId.split('.')[0];
  const allStates = [...adapter.runningStates, ...adapter.doneStates];
  if (domain === 'input_boolean' || domain === 'binary_sensor') {
    if (!['on', 'off'].includes(source.state.state.toLowerCase())
        || adapter.runningStates.length !== 1 || adapter.runningStates[0] !== 'on'
        || adapter.doneStates.length !== 1 || adapter.doneStates[0] !== 'off'
        || adapter.doneOnInitial) {
      throw createLaundryError('LAUNDRY_SOURCE_INCOMPATIBLE', 422, 'Binäre Quellen benötigen die explizite Zuordnung on → running und off → done.');
    }
    return;
  }
  const options = Array.isArray(source.state.attributes.options)
    ? source.state.attributes.options.filter((option) => typeof option === 'string').map((option) => option.toLowerCase())
    : null;
  const deviceClass = String(source.state.attributes.device_class ?? source.registry?.device_class ?? '').toLowerCase();
  if ((domain === 'sensor' && deviceClass !== 'enum') || !options || options.length === 0
      || !options.includes(source.state.state.toLowerCase())
      || allStates.some((state) => !options.includes(state))) {
    throw createLaundryError('LAUNDRY_SOURCE_INCOMPATIBLE', 422, 'Die Enum-Quelle enthält nicht alle ausgewählten Zustände.');
  }
}

function validatePowerLaundrySource(source) {
  const deviceClass = String(source.state.attributes.device_class ?? source.registry?.device_class ?? '').toLowerCase();
  const unit = normalizeLaundryPowerUnit(source.state.attributes.unit_of_measurement);
  if (deviceClass !== 'power' || !unit || !Number.isFinite(Number(source.state.state))) {
    throw createLaundryError('LAUNDRY_POWER_SOURCE_INCOMPATIBLE', 422, 'Die Quelle ist kein verfügbarer Leistungssensor mit numerischem Wert und Einheit.');
  }
  return unit;
}

export function blueprintExists(result, path) {
  if (Array.isArray(result)) return result.some((entry) => entry === path || entry?.path === path);
  return Boolean(result && typeof result === 'object' && Object.hasOwn(result, path));
}

function inputSelectItems(result) {
  if (!Array.isArray(result)) throw createLaundryError(
    'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.',
  );
  return result;
}

function inputSelectOptionsMatch(value) {
  return Array.isArray(value) && laundryFingerprint(value) === laundryFingerprint(['idle', 'running', 'done']);
}

function createdInputSelect(result) {
  if (!result || typeof result !== 'object') return null;
  const id = typeof result.id === 'string' && /^[a-z0-9_]+$/.test(result.id) ? result.id : null;
  return id ? { id } : null;
}

function entityRegistryItems(result) {
  if (!Array.isArray(result)) throw createLaundryError(
    'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.',
  );
  return result;
}

function registryEntityId(entry, domain) {
  return entry && typeof entry === 'object' && !entry.disabled_by
    ? normalizeLaundryEntityId(entry.entity_id, [domain])
    : null;
}

function helperRegistryMatches(entries, helperId) {
  return entries.filter((entry) => entry?.platform === 'input_select'
    && entry?.unique_id === helperId && registryEntityId(entry, 'input_select'));
}

function automationRegistryMatches(entries, automationId) {
  return entries.filter((entry) => entry?.platform === 'automation'
    && entry?.unique_id === automationId && registryEntityId(entry, 'automation'));
}

async function pollLaundryCleanup(operation, sleep, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if (await operation()) return true; } catch (error) {
      if (isSetupRecoveryRequiredError(error)) throw error;
      // Cleanup remains conservative for ordinary HA read failures.
    }
    if (attempt + 1 < attempts) await sleep();
  }
  return false;
}

function verifyAutomationConfig(body, expected) {
  const useBlueprint = body?.use_blueprint;
  return Boolean(body && typeof body === 'object'
    && body.alias === expected.alias
    && body.description === expected.description
    && body.mode === expected.mode
    && useBlueprint?.path === LAUNDRY_BLUEPRINT_PATH
    && laundryFingerprint(useBlueprint.input) === laundryFingerprint(expected.use_blueprint.input));
}

function verifyLoadedAutomationConfig(body, expected) {
  return Boolean(body && typeof body === 'object'
    && laundryFingerprint(body) === laundryFingerprint(expected));
}

function canonicalLaundrySubstitution(input) {
  return {
    triggers: [
      {
        trigger: 'numeric_state', entity_id: input.power_sensor,
        above: input.start_threshold, for: { seconds: input.start_hold_seconds }, id: 'running',
      },
      {
        trigger: 'numeric_state', entity_id: input.power_sensor,
        below: input.end_threshold, for: { seconds: input.end_hold_seconds }, id: 'done',
      },
    ],
    actions: [{
      choose: [
        {
          conditions: [{ condition: 'trigger', id: ['running'] }],
          sequence: [{
            action: 'input_select.select_option',
            target: { entity_id: input.state_helper },
            data: { option: 'running' },
          }],
        },
        {
          conditions: [
            { condition: 'trigger', id: ['done'] },
            { condition: 'state', entity_id: input.state_helper, state: 'running' },
          ],
          sequence: [{
            action: 'input_select.select_option',
            target: { entity_id: input.state_helper },
            data: { option: 'done' },
          }],
        },
      ],
    }],
    mode: 'restart',
  };
}

async function inspectHelperOwnership(client, session, knownId = null) {
  const items = inputSelectItems(await client.ws('input_select/list'));
  const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
  const named = items.filter((entry) => entry?.name === session.helperName);
  if (named.length === 0) {
    const registryCollision = registry.some((entry) => (knownId && entry?.unique_id === knownId)
      || entry?.entity_id === session.expectedHelperEntityId);
    return registryCollision ? { status: 'unknown' } : { status: 'absent' };
  }
  if (named.length !== 1) return { status: 'unknown' };
  const item = named[0];
  const id = typeof item.id === 'string' && /^[a-z0-9_]+$/.test(item.id) ? item.id : null;
  if (!id || (knownId && id !== knownId) || !inputSelectOptionsMatch(item.options)
      || (item.initial !== undefined && item.initial !== null)) return { status: 'unknown' };
  const matches = helperRegistryMatches(registry, id);
  if (matches.length !== 1) return { status: 'pending' };
  const entityId = registryEntityId(matches[0], 'input_select');
  const state = await laundryRest(
    client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404],
  );
  if (state.status === 404) return { status: 'pending' };
  if (state.body?.entity_id !== entityId || !inputSelectOptionsMatch(state.body?.attributes?.options)
      || !['idle', 'running', 'done'].includes(state.body?.state)) return { status: 'unknown' };
  return { status: 'owned', helper: { id, entityId } };
}

async function resolveOwnedHelper(client, session, knownId, sleep, settleAbsent = false) {
  let latest = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = await inspectHelperOwnership(client, session, knownId);
    if (latest.status === 'owned' || latest.status === 'unknown') return latest;
    if (latest.status === 'absent' && !settleAbsent) return latest;
    if (attempt + 1 < 20) await sleep();
  }
  return latest?.status === 'owned' || latest?.status === 'absent'
    ? latest
    : { status: 'unknown' };
}

async function inspectAutomationOwnership(
  client, session, expectedAutomation, expectedLoadedAutomation = null, verifyLoaded = true,
) {
  const config = await laundryRest(
    client, 'GET', `/api/config/automation/config/${session.automationId}`, undefined, [200, 404],
  );
  const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
  const matches = automationRegistryMatches(registry, session.automationId);
  if (config.status === 404) return matches.length === 0 ? { status: 'absent' } : { status: 'unknown' };
  if (!verifyAutomationConfig(config.body, expectedAutomation)) return { status: 'unknown' };
  if (!verifyLoaded) {
    const entityId = matches.length === 1 ? registryEntityId(matches[0], 'automation') : null;
    return { status: 'owned_config', automation: { id: session.automationId, entityId } };
  }
  if (matches.length !== 1) return { status: 'pending' };
  const entityId = registryEntityId(matches[0], 'automation');
  const state = await laundryRest(
    client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404],
  );
  if (state.status === 404) return { status: 'pending' };
  if (state.body?.entity_id !== entityId) {
    return { status: 'owned_invalid', automation: { id: session.automationId, entityId } };
  }
  let loaded;
  try { loaded = await client.ws('automation/config', { entity_id: entityId }); } catch { return { status: 'pending' }; }
  if (!expectedLoadedAutomation
      || !verifyLoadedAutomationConfig(loaded?.config, expectedLoadedAutomation)) {
    return { status: 'owned_invalid', automation: { id: session.automationId, entityId } };
  }
  return { status: 'owned', automation: { id: session.automationId, entityId } };
}

async function resolveOwnedAutomation(
  client, session, expectedAutomation, expectedLoadedAutomation, sleep, settleAbsent = false,
) {
  let latest = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = await inspectAutomationOwnership(
      client, session, expectedAutomation, expectedLoadedAutomation,
    );
    if (['owned', 'owned_invalid', 'unknown'].includes(latest.status)) return latest;
    if (latest.status === 'absent' && !settleAbsent) return latest;
    if (attempt + 1 < 20) await sleep();
  }
  return latest ?? { status: 'unknown' };
}

export function createLaundryCoordinator({
  configStore,
  connectionMode = HA_CONNECTION_MODE,
  householdConfigPath,
  clientFactory,
  replaceConfig,
  now,
  sleep,
  blueprintFile,
  configMutations,
  assertSetupRecoveryHealthy = () => undefined,
}) {
  const validations = new Map();
  const previews = new Map();
  const disablePreviews = new Map();
  const reservations = new Map();

  function localGeneration() {
    const household = readLaundryHouseholdSnapshot(householdConfigPath);
    const sharedBytes = configStore.responseBody();
    return {
      household,
      householdFingerprint: household.fingerprint,
      sharedFingerprint: createHash('sha256').update(configStore.exists() ? '1' : '0').update(sharedBytes).digest('hex'),
    };
  }

  function reserveApply(session) {
    return configMutations.run(() => {
      assertSetupRecoveryHealthy();
      const generation = localGeneration();
      assertLaundryTargetUnchanged(session, generation.household);
      assertSessionCredentialSnapshot(session);
      if (reservations.has(session.device)) {
        throw createLaundryError('LAUNDRY_TARGET_RESERVED', 409, 'Das Laundry-Ziel wird bereits geändert.');
      }
      const id = randomBytes(24).toString('base64url');
      reservations.set(session.device, id);
      return { id, ...generation };
    });
  }

  function finalReservedCommit(session, reservation, adapter) {
    return configMutations.run(() => {
      assertSetupRecoveryHealthy();
      if (reservations.get(session.device) !== reservation.id) {
        throw createLaundryError('LAUNDRY_TARGET_RESERVED', 409, 'Die Laundry-Reservierung ist nicht mehr gültig.');
      }
      const current = localGeneration();
      if (current.householdFingerprint !== reservation.householdFingerprint
          || current.sharedFingerprint !== reservation.sharedFingerprint) {
        throw createLaundryError('LAUNDRY_CONFIG_CHANGED', 409, 'Die lokale Konfiguration wurde während der Home-Assistant-Prüfung geändert.');
      }
      assertLaundryTargetUnchanged(session, current.household);
      assertSessionCredentialSnapshot(session);
      assertNoAdapterCollision(current.household, session.device, adapter.entityId);
      writeLaundryAdapterAtomically(householdConfigPath, current.household, session.device, adapter, replaceConfig);
    });
  }

  function releaseReservation(session, reservation) {
    return configMutations.run(() => {
      if (reservations.get(session.device) === reservation.id) reservations.delete(session.device);
    });
  }

  function credentialSnapshot() {
    const credentials = resolveServerHaAccess(configStore, connectionMode);
    if (!credentials) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_NOT_CONFIGURED', 503, 'Home Assistant ist serverseitig nicht konfiguriert.');
    }
    return {
      credentials,
      identity: laundryFingerprint(credentials),
    };
  }

  function assertSessionCredentialSnapshot(session) {
    const current = credentialSnapshot();
    if (current.identity !== session.haCredentialIdentity) {
      throw createLaundryError('LAUNDRY_CONFIG_CHANGED', 409, 'Die Home-Assistant-Verbindung wurde seit der Prüfung geändert.');
    }
    return current;
  }

  function sessionBase(origin, snapshot, device, sourceFingerprint, haCredentialIdentity = null) {
    return {
      origin,
      device,
      sourceFingerprint,
      ...(haCredentialIdentity ? { haCredentialIdentity } : {}),
      householdFingerprint: snapshot.fingerprint,
      previousAdapterFingerprint: laundryFingerprint(snapshot.parsed.globalEntities.laundry[device] ?? null),
      expiresAt: now() + LAUNDRY_SESSION_TTL_MS,
    };
  }

  function putSession(map, session) {
    const id = randomBytes(32).toString('base64url');
    map.set(id, session);
    return id;
  }

  function takeSession(map, id, origin) {
    if (typeof id !== 'string' || id.length < 32) {
      throw createLaundryError('LAUNDRY_SESSION_INVALID', 409, 'Die Prüfung ist ungültig oder wurde bereits verwendet.');
    }
    const session = map.get(id);
    map.delete(id);
    if (!session || session.origin !== origin) {
      throw createLaundryError('LAUNDRY_SESSION_INVALID', 409, 'Die Prüfung ist ungültig oder wurde bereits verwendet.');
    }
    if (session.expiresAt <= now()) {
      throw createLaundryError('LAUNDRY_SESSION_EXPIRED', 409, 'Die Prüfung ist abgelaufen.');
    }
    return session;
  }

  async function withClient(snapshot, operation) {
    const client = clientFactory(snapshot.credentials);
    if (!client || typeof client.rest !== 'function' || typeof client.ws !== 'function') {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_CLIENT', 500, 'Der Home-Assistant-Client ist nicht verfügbar.');
    }
    try { return await operation(client); } finally { try { client.close?.(); } catch { /* best effort */ } }
  }

  function assertNoAdapterCollision(snapshot, device, entityId) {
    const otherDevice = device === 'washer' ? 'dryer' : 'washer';
    const other = snapshot.parsed.globalEntities.laundry[otherDevice];
    if (other?.entityId === entityId) {
      throw createLaundryError('LAUNDRY_TARGET_CONFLICT', 409, 'Die Quelle ist bereits dem anderen Wäschegerät zugeordnet.');
    }
  }

  async function validateExisting(input, origin) {
    const normalized = normalizeExistingLaundryPayload(input);
    if (!normalized) throw createLaundryError('LAUNDRY_INVALID_REQUEST', 400, 'Die Existing-Anfrage ist ungültig.');
    const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
    const currentAdapter = snapshot.parsed.globalEntities.laundry[normalized.device] ?? null;
    const adapter = currentAdapter?.entityId === normalized.adapter.entityId && currentAdapter.cycleMarkerEntityId
      ? { ...normalized.adapter, cycleMarkerEntityId: currentAdapter.cycleMarkerEntityId }
      : normalized.adapter;
    assertNoAdapterCollision(snapshot, normalized.device, adapter.entityId);
    const ha = credentialSnapshot();
    const source = await withClient(ha, async (client) => readLaundrySource(client, adapter.entityId));
    validateExistingLaundrySource(source, adapter);
    const validationId = putSession(validations, {
      ...sessionBase(origin, snapshot, normalized.device, source.sourceFingerprint, ha.identity),
      adapter,
    });
    return {
      ok: true,
      status: 'validated',
      validationId,
      expiresInSeconds: LAUNDRY_SESSION_TTL_MS / 1000,
      device: normalized.device,
      adapter,
      source: { entityId: adapter.entityId, name: source.state.attributes.friendly_name ?? adapter.entityId },
    };
  }

  async function applyExisting(input, origin) {
    if (!laundryExactObject(input, ['validationId', 'confirmed']) || input.confirmed !== true) {
      throw createLaundryError('LAUNDRY_CONFIRMATION_REQUIRED', 400, 'Die geprüfte Änderung muss ausdrücklich bestätigt werden.');
    }
    const session = takeSession(validations, input.validationId, origin);
    const reservation = await reserveApply(session);
    try {
      const ha = assertSessionCredentialSnapshot(session);
      const source = await withClient(ha, async (client) => readLaundrySource(client, session.adapter.entityId));
      validateExistingLaundrySource(source, session.adapter);
      if (source.sourceFingerprint !== session.sourceFingerprint) {
        throw createLaundryError('LAUNDRY_SOURCE_CHANGED', 409, 'Die Home-Assistant-Quelle wurde seit der Prüfung geändert.');
      }
      await finalReservedCommit(session, reservation, session.adapter);
      return {
        ok: true, status: 'configured', device: session.device,
        entityId: session.adapter.entityId, adapter: session.adapter,
      };
    } finally {
      await releaseReservation(session, reservation);
    }
  }

  async function previewDisable(input, origin) {
    if (!laundryExactObject(input, ['device']) || !['washer', 'dryer'].includes(input.device)) {
      throw createLaundryError('LAUNDRY_INVALID_REQUEST', 400, 'Die Disable-Anfrage ist ungültig.');
    }
    const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
    const adapter = snapshot.parsed.globalEntities.laundry[input.device] ?? null;
    const previewId = putSession(disablePreviews, sessionBase(origin, snapshot, input.device, null));
    return {
      ok: true,
      status: 'preview',
      previewId,
      expiresInSeconds: LAUNDRY_SESSION_TTL_MS / 1000,
      device: input.device,
      adapter,
    };
  }

  async function applyDisable(input, origin) {
    if (!laundryExactObject(input, ['previewId', 'confirmed']) || input.confirmed !== true) {
      throw createLaundryError('LAUNDRY_CONFIRMATION_REQUIRED', 400, 'Die geprüfte Deaktivierung muss ausdrücklich bestätigt werden.');
    }
    const session = takeSession(disablePreviews, input.previewId, origin);
    await configMutations.run(() => {
      assertSetupRecoveryHealthy();
      if (reservations.has(session.device)) {
        throw createLaundryError('LAUNDRY_TARGET_RESERVED', 409, 'Das Laundry-Ziel wird bereits geändert.');
      }
      const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
      assertLaundryTargetUnchanged(session, snapshot);
      if (snapshot.parsed.globalEntities.laundry[session.device] === null) return;
      writeLaundryAdapterAtomically(householdConfigPath, snapshot, session.device, null, replaceConfig);
    });
    return { ok: true, status: 'disabled', device: session.device, adapter: null };
  }

  async function previewBlueprint(input, origin) {
    const normalized = normalizeBlueprintLaundryPayload(input);
    if (!normalized) throw createLaundryError('LAUNDRY_INVALID_REQUEST', 400, 'Die Blueprint-Anfrage ist ungültig.');
    const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
    const ha = credentialSnapshot();
    const source = await withClient(ha, async (client) => readLaundrySource(client, normalized.inputs.powerSensorEntityId));
    const powerUnit = validatePowerLaundrySource(source);
    const suffix = randomBytes(6).toString('hex');
    const automationId = `hauser_${normalized.device}_laundry_${suffix}`;
    const automationAlias = `Hauser ${normalized.device} laundry ${suffix}`;
    const helperName = `Hauser ${normalized.device} laundry ${suffix}`;
    const expectedHelperId = `hauser_${normalized.device}_laundry_${suffix}`;
    const ownershipMarker = `hauser-laundry:${automationId}:${randomBytes(8).toString('hex')}`;
    const previewId = putSession(previews, {
      ...sessionBase(origin, snapshot, normalized.device, source.sourceFingerprint, ha.identity),
      inputs: normalized.inputs,
      automationId,
      automationAlias,
      expectedAutomationEntityId: `automation.${automationId}`,
      helperName,
      expectedHelperEntityId: `input_select.${expectedHelperId}`,
      ownershipMarker,
      powerUnit,
    });
    return {
      ok: true,
      status: 'preview',
      previewId,
      expiresInSeconds: LAUNDRY_SESSION_TTL_MS / 1000,
      device: normalized.device,
      blueprint: { path: LAUNDRY_BLUEPRINT_PATH },
      helper: {
        name: helperName,
        entityId: null,
        idAssignedBy: 'home_assistant_during_apply',
        options: ['idle', 'running', 'done'],
      },
      automation: {
        id: automationId,
        entityId: null,
        expectedEntityId: `automation.${automationId}`,
        entityIdStatus: 'expected_not_confirmed',
        alias: automationAlias,
      },
      inputs: { ...normalized.inputs, unitOfMeasurement: powerUnit },
    };
  }

  async function applyBlueprint(input, origin) {
    if (!laundryExactObject(input, ['previewId', 'confirmed']) || input.confirmed !== true) {
      throw createLaundryError('LAUNDRY_CONFIRMATION_REQUIRED', 400, 'Die geprüfte Änderung muss ausdrücklich bestätigt werden.');
    }
    const session = takeSession(previews, input.previewId, origin);
    const reservation = await reserveApply(session);
    let blueprintCreated = false;
      let blueprintGeneration = null;
      let helper = null;
      let automation = null;
      let expectedAutomation = null;
      let expectedLoadedAutomation = null;
      let helperWriteAttempted = false;
      let automationWriteAttempted = false;
      let client;
      try {
        const ha = assertSessionCredentialSnapshot(session);
        client = clientFactory(ha.credentials);
        const source = await readLaundrySource(client, session.inputs.powerSensorEntityId);
        validatePowerLaundrySource(source);
        if (source.sourceFingerprint !== session.sourceFingerprint) {
          throw createLaundryError('LAUNDRY_SOURCE_CHANGED', 409, 'Die Home-Assistant-Quelle wurde seit der Vorschau geändert.');
        }

        const blueprints = await client.ws('blueprint/list', { domain: 'automation' });
        const helperItems = inputSelectItems(await client.ws('input_select/list'));
        const registryBefore = entityRegistryItems(await client.ws('config/entity_registry/list'));
        const automationBefore = await laundryRest(
          client, 'GET', `/api/config/automation/config/${session.automationId}`, undefined, [200, 404],
        );
        const automationStateBefore = await laundryRest(
          client, 'GET', `/api/states/${encodeURIComponent(session.expectedAutomationEntityId)}`, undefined, [200, 404],
        );
        const helperStateBefore = await laundryRest(
          client, 'GET', `/api/states/${encodeURIComponent(session.expectedHelperEntityId)}`, undefined, [200, 404],
        );
        const expectedHelperId = session.expectedHelperEntityId.slice('input_select.'.length);
        const registryCollision = registryBefore.some((entry) => (
          entry?.entity_id === session.expectedAutomationEntityId
          || entry?.entity_id === session.expectedHelperEntityId
          || (entry?.platform === 'automation' && entry?.unique_id === session.automationId)
          || (entry?.platform === 'input_select' && entry?.unique_id === expectedHelperId)
        ));
        const helperCollision = helperItems.some((entry) => entry?.name === session.helperName
          || entry?.id === expectedHelperId);
        if (automationBefore.status !== 404 || automationStateBefore.status !== 404
            || helperStateBefore.status !== 404 || registryCollision || helperCollision) {
          throw createLaundryError('LAUNDRY_TARGET_CONFLICT', 409, 'Ein vorgesehenes Home-Assistant-Ziel existiert bereits.');
        }

        let yaml;
        try { yaml = readFileSync(blueprintFile, 'utf8'); } catch {
          throw createLaundryError('LAUNDRY_BLUEPRINT_MISSING', 500, 'Der mitgelieferte Wäsche-Blueprint fehlt.');
        }
        if (!blueprintExists(blueprints, LAUNDRY_BLUEPRINT_PATH)) {
          assertSetupRecoveryHealthy();
          await client.ws('blueprint/save', {
            domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, yaml, allow_override: false,
          });
          blueprintCreated = true;
          const generationInput = {
            power_sensor: session.inputs.powerSensorEntityId,
            state_helper: session.expectedHelperEntityId,
            start_threshold: session.inputs.startThreshold,
            end_threshold: session.inputs.endThreshold,
            start_hold_seconds: session.inputs.startHoldSeconds,
            end_hold_seconds: session.inputs.endHoldSeconds,
          };
          const generationReadback = await client.ws('blueprint/substitute', {
            domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, input: generationInput,
          });
          const expectedGeneration = canonicalLaundrySubstitution(generationInput);
          if (!generationReadback?.substituted_config
              || typeof generationReadback.substituted_config !== 'object'
              || !verifyLoadedAutomationConfig(generationReadback.substituted_config, expectedGeneration)) {
            throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Die gespeicherte Wäsche-Blueprintgeneration konnte nicht verifiziert werden.');
          }
          blueprintGeneration = {
            input: generationInput,
            fingerprint: laundryFingerprint(generationReadback.substituted_config),
          };
        }

        helperWriteAttempted = true;
        let helperCreate = null;
        let helperCreateError = null;
        try {
          assertSetupRecoveryHealthy();
          helperCreate = createdInputSelect(await client.ws('input_select/create', {
            name: session.helperName,
            options: ['idle', 'running', 'done'],
            icon: session.device === 'washer' ? 'mdi:washing-machine' : 'mdi:tumble-dryer',
          }));
        } catch (error) { helperCreateError = error; }
        assertSetupRecoveryHealthy();
        const helperOwnership = await resolveOwnedHelper(
          client, session, helperCreate?.id ?? null, sleep, Boolean(helperCreateError),
        );
        if (helperOwnership.status === 'owned') {
          helper = helperOwnership.helper;
        } else if (helperCreateError && helperOwnership.status === 'absent') {
          throw helperCreateError;
        } else if (helperOwnership.status === 'unknown') {
          throw createLaundryError('LAUNDRY_OUTCOME_UNKNOWN', 502, 'Das Ergebnis der Home-Assistant-Helper-Erstellung ist nicht eindeutig.', {
            status: 'outcome_unknown', target: { helperName: session.helperName },
          });
        } else {
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Home Assistant konnte den erzeugten Wäsche-Helper nicht verifizieren.');
        }

        const automationInput = {
          power_sensor: session.inputs.powerSensorEntityId,
          state_helper: helper.entityId,
          start_threshold: session.inputs.startThreshold,
          end_threshold: session.inputs.endThreshold,
          start_hold_seconds: session.inputs.startHoldSeconds,
          end_hold_seconds: session.inputs.endHoldSeconds,
        };
        expectedAutomation = {
          alias: session.automationAlias,
          description: `Hauser laundry automation ownership ${session.ownershipMarker}`,
          use_blueprint: { path: LAUNDRY_BLUEPRINT_PATH, input: automationInput },
          mode: 'restart',
        };
        const substituted = await client.ws('blueprint/substitute', {
          domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, input: automationInput,
        });
        const canonicalSubstitution = canonicalLaundrySubstitution(automationInput);
        if (!substituted?.substituted_config || typeof substituted.substituted_config !== 'object'
            || !verifyLoadedAutomationConfig(substituted.substituted_config, canonicalSubstitution)) {
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Der Wäsche-Blueprint konnte nicht strukturell verifiziert werden.');
        }
        expectedLoadedAutomation = {
          ...canonicalSubstitution,
          id: session.automationId,
          alias: session.automationAlias,
          description: expectedAutomation.description,
        };
        automationWriteAttempted = true;
        let automationWriteError = null;
        try {
          assertSetupRecoveryHealthy();
          await laundryRest(
            client, 'POST', `/api/config/automation/config/${session.automationId}`, expectedAutomation, [200, 201],
          );
        } catch (error) { automationWriteError = error; }
        assertSetupRecoveryHealthy();
        const automationOwnership = await resolveOwnedAutomation(
          client, session, expectedAutomation, expectedLoadedAutomation,
          sleep, Boolean(automationWriteError),
        );
        if (automationOwnership.status === 'owned') {
          automation = automationOwnership.automation;
        } else if (automationOwnership.status === 'owned_invalid') {
          automation = automationOwnership.automation;
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Die geladene Wäsche-Automation entspricht nicht dem erzeugten Objekt.');
        } else if (automationWriteError && automationOwnership.status === 'absent') {
          throw automationWriteError;
        } else if (automationOwnership.status === 'unknown') {
          throw createLaundryError('LAUNDRY_OUTCOME_UNKNOWN', 502, 'Das Ergebnis der Home-Assistant-Automationserstellung ist nicht eindeutig.', {
            status: 'outcome_unknown', target: { automationId: session.automationId },
          });
        } else {
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Home Assistant konnte die erzeugte Wäsche-Automation nicht verifizieren.');
        }

        await finalReservedCommit(session, reservation, {
          type: 'entity', entityId: helper.entityId,
          runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
          cycleMarkerEntityId: automation.entityId,
        });
        return {
          ok: true,
          status: 'configured',
          device: session.device,
          helper: { id: helper.id, entityId: helper.entityId },
          automation: { id: session.automationId, entityId: automation.entityId },
          blueprint: { path: LAUNDRY_BLUEPRINT_PATH, created: blueprintCreated },
        };
      } catch (error) {
        assertSetupRecoveryHealthy();
        let cleanupFailed = false;
        let automationUncertain = false;
        let helperUncertain = false;

        if (client && automationWriteAttempted && expectedAutomation && !automation) {
          try {
            const ownership = await inspectAutomationOwnership(
              client, session, expectedAutomation, null, false,
            );
            if (ownership.status === 'owned_config') automation = ownership.automation;
            else if (ownership.status === 'unknown') automationUncertain = true;
          } catch { automationUncertain = true; }
        }
        if (client && helperWriteAttempted && !helper) {
          try {
            assertSetupRecoveryHealthy();
            const ownership = await resolveOwnedHelper(client, session, null, sleep, true);
            if (ownership.status === 'owned') helper = ownership.helper;
            else if (ownership.status === 'unknown') helperUncertain = true;
          } catch { helperUncertain = true; }
        }

        let automationGone = !automationWriteAttempted;
        if (client && automation) {
          try {
            const currentOwnership = expectedAutomation
              ? await inspectAutomationOwnership(
                client, session, expectedAutomation, expectedLoadedAutomation,
              )
              : { status: 'unknown' };
            if (currentOwnership.status === 'absent') {
              automationGone = true;
            } else if (!['owned', 'owned_invalid'].includes(currentOwnership.status)
                || (automation.entityId && currentOwnership.automation?.entityId !== automation.entityId)) {
              automationGone = false;
              cleanupFailed = true;
            } else {
              assertSetupRecoveryHealthy();
              await laundryRest(client, 'DELETE', `/api/config/automation/config/${session.automationId}`, undefined, [200, 204]);
              const entityIds = new Set([
                session.expectedAutomationEntityId,
                automation.entityId,
              ].filter(Boolean));
              assertSetupRecoveryHealthy();
              automationGone = await pollLaundryCleanup(async () => {
                assertSetupRecoveryHealthy();
                const config = await laundryRest(
                  client, 'GET', `/api/config/automation/config/${session.automationId}`, undefined, [200, 404],
                );
                const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
                if (config.status !== 404 || registry.some((entry) => entry?.unique_id === session.automationId
                    || entityIds.has(entry?.entity_id))) return false;
                for (const entityId of entityIds) {
                  const state = await laundryRest(
                    client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404],
                  );
                  if (state.status !== 404) return false;
                }
                return true;
              }, sleep);
              if (!automationGone) cleanupFailed = true;
            }
          } catch (cleanupError) {
            if (isSetupRecoveryRequiredError(cleanupError)) throw cleanupError;
            cleanupFailed = true;
          }
        } else if (automationUncertain) {
          automationGone = false;
        } else if (automationWriteAttempted) {
          automationGone = true;
        }

        let helperGone = !helperWriteAttempted;
        if (client && helper && automationGone) {
          try {
            const currentOwnership = await inspectHelperOwnership(client, session, helper.id);
            if (currentOwnership.status === 'absent') {
              helperGone = true;
            } else if (currentOwnership.status !== 'owned'
                || currentOwnership.helper?.id !== helper.id
                || currentOwnership.helper?.entityId !== helper.entityId) {
              helperGone = false;
              cleanupFailed = true;
            } else {
              assertSetupRecoveryHealthy();
              await client.ws('input_select/delete', { input_select_id: helper.id });
              assertSetupRecoveryHealthy();
              helperGone = await pollLaundryCleanup(async () => {
                assertSetupRecoveryHealthy();
                const items = inputSelectItems(await client.ws('input_select/list'));
                const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
                const state = await laundryRest(
                  client, 'GET', `/api/states/${encodeURIComponent(helper.entityId)}`, undefined, [200, 404],
                );
                return !items.some((entry) => entry?.id === helper.id || entry?.name === session.helperName)
                  && !registry.some((entry) => entry?.unique_id === helper.id || entry?.entity_id === helper.entityId)
                  && state.status === 404;
              }, sleep);
              if (!helperGone) cleanupFailed = true;
            }
          } catch (cleanupError) {
            if (isSetupRecoveryRequiredError(cleanupError)) throw cleanupError;
            cleanupFailed = true;
          }
        } else if (helperUncertain || !automationGone) {
          helperGone = false;
        } else if (helperWriteAttempted) {
          helperGone = true;
        }

        let blueprintGone = !blueprintCreated;
        if (client && blueprintCreated && automationGone && !automationUncertain) {
          let inUse = false;
          try {
            const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
            for (const entry of registry.filter((candidate) => candidate?.platform === 'automation'
              && registryEntityId(candidate, 'automation'))) {
              const loaded = await client.ws('automation/config', { entity_id: entry.entity_id });
              if (loaded?.config?.use_blueprint?.path === LAUNDRY_BLUEPRINT_PATH) {
                inUse = true;
                break;
              }
            }
          } catch { inUse = true; }
          if (!inUse) {
            try {
              const currentBlueprints = await client.ws('blueprint/list', { domain: 'automation' });
              const currentGeneration = blueprintGeneration && blueprintExists(currentBlueprints, LAUNDRY_BLUEPRINT_PATH)
                ? await client.ws('blueprint/substitute', {
                  domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, input: blueprintGeneration.input,
                })
                : null;
              const generationMatches = Boolean(currentGeneration?.substituted_config
                && typeof currentGeneration.substituted_config === 'object'
                && laundryFingerprint(currentGeneration.substituted_config) === blueprintGeneration?.fingerprint);
              if (!generationMatches) {
                cleanupFailed = true;
              } else {
                assertSetupRecoveryHealthy();
                await client.ws('blueprint/delete', { domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH });
                assertSetupRecoveryHealthy();
                blueprintGone = await pollLaundryCleanup(async () => {
                  assertSetupRecoveryHealthy();
                  return !blueprintExists(
                    await client.ws('blueprint/list', { domain: 'automation' }), LAUNDRY_BLUEPRINT_PATH,
                  );
                }, sleep);
                if (!blueprintGone) cleanupFailed = true;
              }
            } catch (cleanupError) {
              if (isSetupRecoveryRequiredError(cleanupError)) throw cleanupError;
              cleanupFailed = true;
            }
          } else {
            cleanupFailed = true;
          }
        } else if (blueprintCreated) {
          blueprintGone = false;
        }

        const remaining = {};
        if (automation && !automationGone) remaining.automationId = session.automationId;
        if (helper && !helperGone) remaining.inputSelectId = helper.id;
        if (blueprintCreated && !blueprintGone) remaining.blueprintPath = LAUNDRY_BLUEPRINT_PATH;
        if (error?.code === 'LAUNDRY_OUTCOME_UNKNOWN' || automationUncertain || helperUncertain) {
          throw createLaundryError('LAUNDRY_OUTCOME_UNKNOWN', 502, 'Das Ergebnis der Home-Assistant-Schreiboperation ist nicht eindeutig.', {
            status: 'outcome_unknown',
            ...(Object.keys(remaining).length ? { remaining } : {}),
            target: error?.details?.target ?? { automationId: session.automationId, helperName: session.helperName },
          });
        }
        if (cleanupFailed || Object.keys(remaining).length) {
          throw createLaundryError('LAUNDRY_PARTIAL_FAILURE', 502, 'Home Assistant konnte nicht vollständig zurückgerollt werden.', {
            status: 'partial_failure', remaining,
          });
        }
        throw error;
      } finally {
        try { client?.close?.(); } catch { /* best effort */ }
        await releaseReservation(session, reservation);
      }
  }

  return {
    applyBlueprint,
    applyDisable,
    applyExisting,
    previewBlueprint,
    previewDisable,
    validateExisting,
  };
}

export function serveLaundry(req, res, coordinator, route, origin) {
  if (req.method !== 'POST') {
    jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Die Wäsche-Route unterstützt ausschließlich POST.' }, { allow: 'POST' });
    return;
  }
  const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';', 1)[0].trim();
  if (contentType !== 'application/json') {
    jsonResponse(res, 415, { ok: false, code: 'LAUNDRY_CONTENT_TYPE_REQUIRED', message: 'Die Wäsche-Route erwartet application/json.' });
    return;
  }
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > LAUNDRY_BODY_MAX) oversized = true;
  });
  req.on('end', async () => {
    if (oversized) {
      jsonResponse(res, 413, { ok: false, code: 'LAUNDRY_REQUEST_TOO_LARGE', message: 'Die Wäsche-Anfrage ist zu groß.' });
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch {
      jsonResponse(res, 400, { ok: false, code: 'LAUNDRY_INVALID_JSON', message: 'Die Wäsche-Anfrage enthält kein gültiges JSON.' });
      return;
    }
    try {
      const handlers = {
        '/api/laundry/existing/validate': coordinator.validateExisting,
        '/api/laundry/existing/apply': coordinator.applyExisting,
        '/api/laundry/blueprint/preview': coordinator.previewBlueprint,
        '/api/laundry/blueprint/apply': coordinator.applyBlueprint,
        '/api/laundry/disable/preview': coordinator.previewDisable,
        '/api/laundry/disable/apply': coordinator.applyDisable,
      };
      const result = await handlers[route](payload, origin);
      jsonResponse(res, 200, result);
    } catch (error) {
      const response = laundryPublicError(error);
      jsonResponse(res, response.status, response.payload);
    }
  });
}
