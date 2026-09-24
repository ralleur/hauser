/* Ein Home Assistant zum Anfassen: spricht den WebSocket- und REST-Vertrag, den
   Hauser nutzt (die Liste in server/ha-gateway.mjs), und liefert das Stresshaus
   aus src/lib/stresshaus/hostile-home.ts. Jeder Token gilt.

   Allein starten:  node scripts/stresshaus/fake-ha.mjs [port]
   Aus dem Crawler: startFakeHa({ port }) */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { hostileHome, seededRandom } from '../../src/lib/stresshaus/hostile-home.ts';

const HA_VERSION = '2026.9.0';

function compressed(state) {
  return {
    s: state.state,
    a: state.attributes,
    c: state.context.id,
    lc: Date.parse(state.last_changed) / 1000,
    lu: Date.parse(state.last_updated) / 1000,
  };
}

function inRange(event, start, end) {
  const s = Date.parse(event.start.length === 10 ? `${event.start}T00:00:00` : event.start);
  const e = Date.parse(event.end.length === 10 ? `${event.end}T00:00:00` : event.end);
  return !(Number.isFinite(s) && Number.isFinite(e)) || (s < end && e > start) || s >= start && s < end;
}

/* Unruhe: ein Home Assistant, das nie stillhält — Zustände kippen im
   Viertelsekundentakt, Geräte verschwinden und kommen wieder, Optionslisten
   schrumpfen unter der Auswahl weg, Namen wechseln, jede zehnte
   Dienstanfrage scheitert oder hängt, und alle 45 Sekunden startet „HA" neu
   (alle Verbindungen zu). */
export function startFakeHa({ port = 0, host = '127.0.0.1', home = hostileHome(), log = () => {}, unruhe = false, seed = 1 } = {}) {
  const states = new Map(home.states.map((s) => [s.entity_id, structuredClone(s)]));
  const entitySubscribers = new Set();
  const seen = new Map();
  const rng = seededRandom(seed);
  const timers = [];

  function note(type) { seen.set(type, (seen.get(type) ?? 0) + 1); }

  function setState(entityId, patch) {
    const current = states.get(entityId);
    if (!current) return;
    const now = new Date().toISOString();
    const next = { ...current, ...patch, attributes: { ...current.attributes, ...(patch.attributes ?? {}) }, last_changed: now, last_updated: now };
    states.set(entityId, next);
    for (const sub of entitySubscribers) {
      if (sub.filter && !sub.filter.has(entityId)) continue;
      sub.send({ id: sub.id, type: 'event', event: { c: { [entityId]: { '+': { s: next.state, a: patch.attributes ?? {}, lc: Date.parse(now) / 1000 } } } } });
    }
  }

  function broadcast(event, filterId) {
    for (const sub of entitySubscribers) {
      if (filterId && sub.filter && !sub.filter.has(filterId)) continue;
      sub.send({ id: sub.id, type: 'event', event });
    }
  }

  function startUnrest() {
    const ids = () => [...states.keys()].filter((id) => !id.startsWith('sun.') && !id.startsWith('zone.'));
    const pick = (list) => list[Math.floor(rng() * list.length)];
    timers.push(setInterval(() => {
      const list = ids();
      if (!list.length) return;
      const id = pick(list);
      const current = states.get(id);
      const roll = rng();
      if (roll < 0.3) setState(id, { state: current.state === 'on' ? 'off' : 'on' });
      else if (roll < 0.42) setState(id, { state: pick(['unavailable', 'unknown']) });
      else if (roll < 0.55) setState(id, { attributes: { brightness: Math.floor(rng() * 320) - 20, current_position: Math.floor(rng() * 140) - 20, percentage: Math.floor(rng() * 120) } });
      else if (roll < 0.68) {
        const lists = Object.keys(current.attributes).filter((k) => Array.isArray(current.attributes[k]));
        if (lists.length) {
          const key = pick(lists);
          const value = current.attributes[key];
          setState(id, { attributes: { [key]: rng() < 0.5 ? [] : [...value, ...value.slice(0, 2)] } });
        }
      } else if (roll < 0.78) setState(id, { attributes: { friendly_name: pick(['', 'Umbenannt', 'x'.repeat(300), '<i>kursiv</i>', null]) } });
      else if (roll < 0.86) {
        const removed = states.get(id);
        states.delete(id);
        broadcast({ r: [id] }, id);
        setTimeout(() => {
          if (states.has(id)) return;
          states.set(id, removed);
          broadcast({ a: { [id]: compressed(removed) } }, id);
        }, 3000);
      }
    }, 250));
    timers.push(setInterval(() => {
      log('Unruhe: Home Assistant startet neu');
      for (const client of wss.clients) client.close(1012, 'restart');
    }, 45_000));
  }

  function callService(msg) {
    const { domain, service, target, service_data: data = {}, return_response: wantsResponse } = msg;
    const ids = [target?.entity_id ?? data.entity_id].flat().filter(Boolean);
    if (domain === 'calendar' && service === 'get_events') {
      const start = Date.parse(data.start_date_time);
      const end = Date.parse(data.end_date_time);
      const response = {};
      for (const id of ids) {
        if (home.failingCalendars.includes(id)) {
          return { error: { code: 'home_assistant_error', message: `Kalender ${id} antwortet nicht` } };
        }
        response[id] = { events: (home.calendarEvents[id] ?? []).filter((ev) => inRange(ev, start, end)) };
      }
      return { result: { context: { id: 'ctx-cal' }, response } };
    }
    if (domain === 'weather' && service === 'get_forecasts') {
      const response = {};
      for (const id of ids) response[id] = { forecast: home.forecasts[id]?.[data.type ?? 'daily'] ?? [] };
      return { result: { context: { id: 'ctx-wx' }, response } };
    }
    if (domain === 'todo' && service === 'get_items') {
      const response = {};
      for (const id of ids) response[id] = { items: home.todoItems[id] ?? [] };
      return { result: { context: { id: 'ctx-todo' }, response } };
    }
    for (const id of ids) {
      const state = states.get(id)?.state;
      if (service === 'turn_on') setState(id, { state: 'on', attributes: 'brightness' in data ? { brightness: data.brightness } : {} });
      else if (service === 'turn_off') setState(id, { state: 'off' });
      else if (service === 'toggle') setState(id, { state: state === 'on' ? 'off' : 'on' });
      else if (service === 'open_cover') setState(id, { state: 'open', attributes: { current_position: 100 } });
      else if (service === 'close_cover') setState(id, { state: 'closed', attributes: { current_position: 0 } });
    }
    return { result: { context: { id: `ctx-${Date.now()}` }, ...(wantsResponse ? { response: {} } : {}) } };
  }

  function handle(msg, send, socket) {
    note(msg.type);
    const ok = (result = null) => send({ id: msg.id, type: 'result', success: true, result });
    const fail = (code, message) => send({ id: msg.id, type: 'result', success: false, error: { code, message } });
    switch (msg.type) {
      case 'supported_features': return ok();
      case 'ping': return send({ id: msg.id, type: 'pong' });
      case 'get_config': return ok(home.config);
      case 'get_states': return ok([...states.values()]);
      case 'config/area_registry/list': return ok(home.areas);
      case 'config/device_registry/list': return ok(home.devices);
      case 'config/entity_registry/list': return ok(home.entities);
      case 'config/entity_registry/update': {
        const entry = home.entities.find((e) => e.entity_id === msg.entity_id);
        if (!entry) return fail('not_found', 'Entity not found');
        if ('name' in msg) entry.name = msg.name;
        return ok({ entity_entry: entry });
      }
      case 'subscribe_entities': {
        const sub = { id: msg.id, send, filter: Array.isArray(msg.entity_ids) ? new Set(msg.entity_ids) : null };
        entitySubscribers.add(sub);
        socket.setMaxListeners(0);
        socket.on('close', () => entitySubscribers.delete(sub));
        ok();
        const a = {};
        for (const s of states.values()) if (!sub.filter || sub.filter.has(s.entity_id)) a[s.entity_id] = compressed(s);
        return send({ id: msg.id, type: 'event', event: { a } });
      }
      case 'subscribe_events': return ok();
      case 'unsubscribe_events': return ok();
      case 'call_service': {
        const respond = () => {
          if (unruhe && rng() < 0.1) return fail('home_assistant_error', 'Unruhe: Dienst gescheitert');
          const out = callService(msg);
          return out.error ? fail(out.error.code, out.error.message) : ok(out.result);
        };
        return unruhe ? void setTimeout(respond, rng() < 0.2 ? 1500 : 0) : respond();
      }
      case 'todo/item/list': return ok({ items: home.todoItems[msg.entity_id] ?? [] });
      case 'camera/stream': return fail('home_assistant_error', 'Stream nicht verfügbar');
      case 'persistent_notification/subscribe': {
        ok();
        const created = new Date().toISOString();
        return send({
          id: msg.id, type: 'event', event: {
            type: 'current',
            notifications: {
              n1: { notification_id: 'n1', title: '<b>Update</b> verfügbar', message: 'Eine **sehr** lange Nachricht '.repeat(40), created_at: created },
              n2: { notification_id: 'n2', title: '<b>Update</b> verfügbar', message: '', created_at: created },
              n3: { notification_id: 'n3', title: null, message: null, created_at: 'gestern' },
            },
          },
        });
      }
      case 'logbook/get_events': {
        const when = Date.now() / 1000 - 600;
        return ok([
          { when, entity_id: 'automation.hauser_licht', name: 'Hauser Licht', message: 'triggered', context_id: 'x' },
          { when, entity_id: 'automation.hauser_licht', name: 'Hauser Licht', message: 'triggered', context_id: 'x' },
          { when: 'kaputt', entity_id: null, name: null, message: null },
        ]);
      }
      case 'recorder/statistics_during_period': {
        const start = Date.parse(msg.start_time) || Date.now() - 86_400_000;
        const out = {};
        for (const id of msg.statistic_ids ?? []) {
          out[id] = [0, 0, 1, 2].map((h) => ({ start: start + h * 3_600_000, end: start + (h + 1) * 3_600_000, mean: h === 2 ? null : 100 * h, sum: h, change: h === 3 ? -4 : 1, state: 1 }));
        }
        return ok(out);
      }
      case 'energy/get_prefs': return ok(home.energyPrefs);
      default: return fail('unknown_command', `Unknown command: ${msg.type}`);
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    note(`HTTP ${req.method} ${url.pathname.replace(/\/[a-z_]+\.[a-z0-9_]+$/, '/<entity>')}`);
    const headers = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Content-Type': 'application/json',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
    const json = (status, body) => { res.writeHead(status, headers); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/') return json(200, { message: 'API running.' });
    if (url.pathname === '/api/config') return json(200, home.config);
    if (url.pathname === '/api/states') return json(200, [...states.values()]);
    if (url.pathname.startsWith('/api/states/')) {
      const state = states.get(decodeURIComponent(url.pathname.slice('/api/states/'.length)));
      return state ? json(200, state) : json(404, { message: 'Entity not found.' });
    }
    /* Kamerabilder: ein winziges JPEG für verfügbare Kameras, ein Fehler für nicht verfügbare — wie echtes HA. */
    const camera = url.pathname.match(/^\/api\/camera_proxy(?:_stream)?\/(camera\.[a-z0-9_]+)$/);
    if (camera) {
      const cam = states.get(camera[1]);
      if (!cam || cam.state === 'unavailable') return json(500, { message: 'Kamera nicht erreichbar' });
      res.writeHead(200, { ...headers, 'Content-Type': 'image/jpeg' });
      res.end(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64'));
      return;
    }
    /* REST-Dienstaufrufe: so schaltet der Server für die iOS-App (/api/app/command) und holt ihre
       Einkaufslisten (todo.get_items?return_response). */
    const service = url.pathname.match(/^\/api\/services\/([a-z_]+)\/([a-z_]+)$/);
    if (service && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let data = {};
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* leer */ }
        const wantsResponse = url.searchParams.has('return_response');
        if (unruhe && rng() < 0.1) return json(500, { message: 'Unruhe: Dienst gescheitert' });
        const out = callService({ domain: service[1], service: service[2], service_data: data, target: data.entity_id ? { entity_id: data.entity_id } : undefined, return_response: wantsResponse });
        if (out.error) return json(500, { message: out.error.message });
        return wantsResponse ? json(200, { changed_states: [], service_response: out.result.response ?? {} }) : json(200, []);
      });
      return;
    }
    if (url.pathname === '/api/calendars') {
      return json(200, [...states.values()].filter((s) => s.entity_id.startsWith('calendar.'))
        .map((s) => ({ entity_id: s.entity_id, name: s.attributes.friendly_name ?? null })));
    }
    if (url.pathname.startsWith('/api/calendars/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/calendars/'.length));
      if (home.failingCalendars.includes(id)) return json(500, { message: `Kalender ${id} antwortet nicht` });
      const start = Date.parse(url.searchParams.get('start') ?? '') || 0;
      const end = Date.parse(url.searchParams.get('end') ?? '') || Infinity;
      const when = (v) => (v.length === 10 ? { date: v } : { dateTime: v });
      return json(200, (home.calendarEvents[id] ?? []).filter((ev) => inRange(ev, start, end))
        .map((ev) => ({ ...ev, start: when(ev.start), end: when(ev.end) })));
    }
    if (url.pathname === '/api/template' && req.method === 'POST') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/plain' });
      res.end(JSON.stringify([...states.values()].filter((s) => s.entity_id.startsWith('weather.')).map((s) => s.state)));
      return;
    }
    // Bilder, Kamera, Flows: HA hat hier schlechte Laune.
    return json(500, { message: 'Stresshaus sagt nein' });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!(req.url ?? '').startsWith('/api/websocket')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const send = (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
      let authed = false;
      send({ type: 'auth_required', ha_version: HA_VERSION });
      ws.on('message', (raw) => {
        let msgs;
        try { msgs = [JSON.parse(String(raw))].flat(); } catch { return; }
        for (const msg of msgs) {
          if (!authed) {
            if (msg.type === 'auth') { authed = true; send({ type: 'auth_ok', ha_version: HA_VERSION }); }
            continue;
          }
          try { handle(msg, send, ws); } catch (err) { log(`fake-ha: ${msg.type} warf ${err}`); }
        }
      });
    });
  });

  if (unruhe) startUnrest();

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        url: `http://${host}:${address.port}`,
        seen,
        close: () => new Promise((done) => { timers.forEach(clearInterval); wss.clients.forEach((c) => c.terminate()); server.close(() => done()); }),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ha = await startFakeHa({ port: Number(process.argv[2] ?? 8129), log: console.log });
  console.log(`Stresshaus-HA läuft auf ${ha.url}`);
}
