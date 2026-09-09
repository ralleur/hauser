/* REST-Zugang für Widgets und Kurzbefehle (Plan 21, Stufe 4).

   Widgets und App Intents laufen ohne WebSocket: sie schalten über
   `POST /api/app/command` und lesen Zustände über `GET /api/app/states`.
   Beides spricht mit Home Assistant über dessen REST-API mit den Zugangs-
   daten, die dieser Server ohnehin hält — der HA-Token verlässt den Host
   nie. Zugelassen sind nur gekoppelte Geräte oder eine freigegebene Origin. */
import { jsonResponse, readSmallJson, requestOriginAllowed } from './shared.mjs';

const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
const SERVICE_NAME = /^[a-z_]+$/;
const MAX_STATE_IDS = 60;

export function createAppCommandService({ resolveAccess, fetchImpl = fetch, timeoutMs = 8_000 }) {
  async function haFetch(path, init = {}) {
    const access = resolveAccess();
    if (!access) throw Object.assign(new Error('Home Assistant ist nicht verbunden.'), { code: 'HA_UNAVAILABLE', status: 503 });
    const base = access.baseUrl.replace(/\/+$/, '');
    const response = await fetchImpl(`${base}/api/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${access.token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw Object.assign(new Error(`Home Assistant antwortet mit ${response.status}.`), { code: 'HA_ERROR', status: 502 });
    return response;
  }

  return {
    async command({ domain, service, entityId, data }) {
      if (!ENTITY_ID.test(entityId) || !SERVICE_NAME.test(domain) || !SERVICE_NAME.test(service)) {
        throw Object.assign(new Error('Ungültiger Befehl.'), { code: 'COMMAND_INVALID', status: 400 });
      }
      await haFetch(`services/${domain}/${service}`, { method: 'POST', body: JSON.stringify({ entity_id: entityId, ...(data ?? {}) }) });
    },
    /** Bewohner aus Home Assistant (`person.*`) für die Personen-Kopplung. */
    async persons() {
      const response = await haFetch('states');
      const all = await response.json();
      return (Array.isArray(all) ? all : [])
        .filter((s) => typeof s?.entity_id === 'string' && s.entity_id.startsWith('person.'))
        .map((s) => ({ entityId: s.entity_id, name: s.attributes?.friendly_name ?? s.entity_id.slice(7), state: s.state ?? null }));
    },
    async states(ids) {
      const wanted = ids.filter((id) => ENTITY_ID.test(id)).slice(0, MAX_STATE_IDS);
      const response = await haFetch('states');
      const all = await response.json();
      const byId = new Map(Array.isArray(all) ? all.map((s) => [s.entity_id, s]) : []);
      return wanted.map((id) => {
        const state = byId.get(id);
        return state
          ? { entityId: id, state: state.state, attributes: state.attributes ?? {}, changedAt: state.last_changed ?? null }
          : { entityId: id, state: null, attributes: {}, changedAt: null };
      });
    },
  };
}

function fail(res, error) {
  jsonResponse(res, error?.status ?? 500, { ok: false, code: error?.code ?? 'APP_COMMAND_FAILED', message: error?.message ?? 'Fehler.' });
}

export async function serveAppCommands(req, res, { service, allowedOrigins }) {
  const url = new URL(req.url || '/', 'http://hauser.local');
  if (!req.hauserDevice && !requestOriginAllowed(req, allowedOrigins)) {
    return jsonResponse(res, 403, { ok: false, code: 'APP_ORIGIN_FORBIDDEN', message: 'Nur gekoppelte Geräte oder eine freigegebene Origin.' });
  }
  if (url.pathname === '/api/app/command' && req.method === 'POST') {
    return readSmallJson(req, res, async (payload) => {
      try {
        await service.command({
          domain: String(payload?.domain ?? ''),
          service: String(payload?.service ?? ''),
          entityId: String(payload?.entityId ?? ''),
          data: payload?.data && typeof payload.data === 'object' ? payload.data : {},
        });
        jsonResponse(res, 200, { ok: true });
      } catch (error) { fail(res, error); }
    });
  }
  if (url.pathname === '/api/app/persons' && req.method === 'GET') {
    try {
      jsonResponse(res, 200, { ok: true, persons: await service.persons() }, { 'cache-control': 'no-store' });
    } catch (error) { fail(res, error); }
    return;
  }
  if (url.pathname === '/api/app/states' && req.method === 'GET') {
    const ids = String(url.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
      jsonResponse(res, 200, { ok: true, states: await service.states(ids) }, { 'cache-control': 'no-store' });
    } catch (error) { fail(res, error); }
    return;
  }
  jsonResponse(res, 404, { ok: false, code: 'APP_ROUTE_NOT_FOUND', message: 'Die App-Route wurde nicht gefunden.' });
}
