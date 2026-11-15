/* SPDX-License-Identifier: AGPL-3.0-only
 * Morgenpendeln: TomTom bleibt die HA-Datenquelle; Hauser zeichnet und zeigt.
 * Keine Anbieter-Schlüssel, keine eigenen Routing-Abfragen. */
import { jsonResponse, readRoomImageJsonBody, requestOriginAllowed } from './shared.mjs';
import { commutePlace, writeTomTomRoute } from './commute-route-editor.mjs';
import { classifyArea, joinAreaRings, clipAreaRing, clipPolyline } from './ambient-map-renderer.mjs';

export const COMMUTE_KEY = 'hmi:commute:v1';
export const DEFAULT_COMMUTE = Object.freeze({ entryId: '', days: [1, 2, 3, 4, 5], from: '06:00', until: '09:00', arrival: '08:00', parkingEntity: '', showRain: true });
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_AGE = 30 * 60_000;
const text = (v, limit = 180) => typeof v === 'string' ? v.slice(0, limit) : '';
const numeric = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 85 && Math.abs(p[1]) <= 180;
const goodState = (s) => s && !['unknown', 'unavailable', ''].includes(s.state);

// Background geometry is display data: subpixel bends and areas add work but
// no visible detail. Keep the live route untouched.
function simplifyMapLine(points) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = points[first], b = points[last], dx = b[0] - a[0], dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    let furthest = -1, distance = .25 * .25;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
      const d = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
      if (d > distance) { distance = d; furthest = i; }
    }
    if (furthest >= 0) { keep[furthest] = 1; stack.push([first, furthest], [furthest, last]); }
  }
  return points.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}
function visibleMapRing(ring) {
  let twiceArea = 0;
  for (let i = 1; i < ring.length; i++) twiceArea += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(twiceArea) >= 1;
}
// Overscan on every edge keeps auto-alignment inside rendered geography.
const MAP_BOUNDS = { minX: -150, maxX: 1150, minY: -90, maxY: 690 };

export function parseCommuteConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.entryId !== 'string' || !/^[\w-]{0,80}$/.test(value.entryId)
    || !Array.isArray(value.days) || value.days.length > 7 || !value.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    || ![value.from, value.until, value.arrival].every((v) => typeof v === 'string' && CLOCK.test(v))
    || typeof value.parkingEntity !== 'string' || (value.parkingEntity !== '' && !/^(sensor|binary_sensor)\.[a-z0-9_]+$/.test(value.parkingEntity))
    || (value.showRain !== undefined && typeof value.showRain !== 'boolean')
    || (value.entryId && (!value.days.length || value.from === value.until))) return null;
  const places = value.places && { start: commutePlace(value.places.start), destination: commutePlace(value.places.destination) };
  if (value.places && (!places.start || !places.destination)) return null;
  return { entryId: value.entryId, days: [...new Set(value.days)], from: value.from, until: value.until, arrival: value.arrival, parkingEntity: value.parkingEntity, showRain: value.showRain ?? true, ...(places ? { places } : {}) };
}

export function commuteInWindow(config, date) {
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (config.from <= config.until) return config.days.includes(date.getDay()) && hm >= config.from && hm < config.until;
  const day = hm < config.until ? (date.getDay() + 6) % 7 : date.getDay();
  return config.days.includes(day) && (hm >= config.from || hm < config.until);
}

/** One projection for roads, route, traffic and pins, shared by web and iOS. */
export function commuteGeometry(route) {
  if (!Array.isArray(route?.points) || route.points.length < 2 || route.points.length > 10_000 || !route.points.every(point)) return null;
  const points = route.points;
  const lat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cos = Math.cos(lat * Math.PI / 180);
  const xs = points.map((p) => p[1] * cos), ys = points.map((p) => p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(680 / Math.max(maxX - minX, .003), 285 / Math.max(maxY - minY, .003));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const project = ([a, b]) => [Math.round((500 + (b * cos - cx) * scale) * 10) / 10, Math.round((280 - (a - cy) * scale) * 10) / 10];
  const line = points.map(project);
  const sections = (Array.isArray(route.live?.sections) ? route.live.sections : []).slice(0, 100)
    .filter((s) => Array.isArray(s.points) && s.points.length >= 2 && s.points.length <= 10_000 && s.points.every(point))
    .map((s) => ({ points: s.points.map(project), severe: Number(s.magnitude) >= 3 || Number(s.delay) >= 300, category: text(s.category, 40) }));
  return {
    line, sections, project,
    bounds: [cy + (280 - MAP_BOUNDS.maxY) / scale, (cx + (MAP_BOUNDS.minX - 500) / scale) / cos,
      cy + (280 - MAP_BOUNDS.minY) / scale, (cx + (MAP_BOUNDS.maxX - 500) / scale) / cos],
  };
}

export function projectCommute(config, route, states, registry, now = Date.now()) {
  const computedAt = Date.parse(route?.live?.at);
  const duration = numeric(route?.duration), delay = numeric(route?.live?.delay);
  const geometry = commuteGeometry(route);
  if (!geometry || duration === null || !Number.isFinite(computedAt) || computedAt > now + 60_000 || now - computedAt > MAX_AGE) return null;
  const owned = new Set(registry.filter((e) => e.config_entry_id === config.entryId).map((e) => e.entity_id));
  if (!states.some((s) => owned.has(s.entity_id) && goodState(s) && s.attributes?.live === true)) return null;
  const reports = states.filter((s) => owned.has(s.entity_id) && s.entity_id.startsWith('geo_location.') && goodState(s))
    .map((s) => {
      const a = s.attributes ?? {};
      return { title: text(a.summary || a.description || a.friendly_name), category: text(a.type, 40), delay: numeric(a.delay) ?? 0,
        point: point([a.latitude, a.longitude]) ? geometry.project([a.latitude, a.longitude]) : null };
    }).sort((a, b) => b.delay - a.delay).slice(0, 20);
  const parking = states.find((s) => s.entity_id === config.parkingEntity && goodState(s));
  const parkingAge = parking ? now - Date.parse(parking.last_updated) : Infinity;
  return { name: text(route.destination?.label, 80), durationMinutes: Math.ceil(duration / 60), delayMinutes: delay === null ? null : Math.ceil(delay / 60),
    updatedAt: new Date(computedAt).toISOString(), line: geometry.line, sections: geometry.sections, reports,
    parking: parking && parkingAge >= -60_000 && parkingAge < MAX_AGE
      ? { name: text(parking.attributes?.friendly_name, 80), state: text(parking.state, 60), unit: text(parking.attributes?.unit_of_measurement, 20) } : null };
}

export function rainStart(forecast, now) {
  if (!forecast?.updatedAt || now - Date.parse(forecast.updatedAt) > MAX_AGE || !Number.isFinite(Date.parse(forecast.updatedAt))) return null;
  if (numeric(forecast?.current?.rain) > 0) return new Date(now).toISOString();
  const times = forecast?.minutely_15?.time, amounts = forecast?.minutely_15?.rain;
  if (!Array.isArray(times) || !Array.isArray(amounts)) return null;
  const offset = typeof forecast.utc_offset_seconds === 'number' ? forecast.utc_offset_seconds * 1000 : 0;
  for (let i = 0; i < times.length; i++) {
    if (typeof times[i] !== 'string' || !(numeric(amounts[i]) > 0)) continue;
    const at = Date.parse(`${times[i]}Z`) - offset;
    // The amount belongs to the preceding 15 minutes, not the next interval.
    if (at >= now && at - now <= 2 * 60 * 60_000) return new Date(Math.max(now, at - 15 * 60_000)).toISOString();
  }
  return null;
}

export function createCommuteService({ configStore, clientFactory, resolveCredentials, readForecast = async () => null, fetchImpl = fetch, now = () => Date.now() }) {
  let cache = null, inflight = null, roadCache = null, roadsFlight = null, previewFlight = null;
  function config() {
    try { return parseCommuteConfig(JSON.parse(configStore.read()[COMMUTE_KEY])) ?? { ...DEFAULT_COMMUTE }; }
    catch { return { ...DEFAULT_COMMUTE }; }
  }
  async function withClient(fn, timeoutMs = 30_000) {
    const credentials = resolveCredentials();
    if (!credentials) throw new Error('HA_UNAVAILABLE');
    const client = clientFactory({ ...credentials, timeoutMs });
    try { return await fn(client); } finally { client.close(); }
  }
  async function sources() {
    return withClient(async (client) => {
      const registry = await client.ws('config/entity_registry/list');
      const result = await client.rest('GET', '/api/states');
      if (!Array.isArray(registry) || result.status !== 200 || !Array.isArray(result.body)) throw new Error('HA_UNAVAILABLE');
      return { registry, states: result.body };
    });
  }
  async function options() {
    const { registry, states } = await sources();
    const ids = new Map();
    for (const entry of registry) {
      if (entry.platform !== 'tomtom' || !entry.config_entry_id) continue;
      const state = states.find((s) => s.entity_id === entry.entity_id);
      if (state?.attributes?.search_mode !== 'route_live') continue;
      ids.set(entry.config_entry_id, { id: entry.config_entry_id, name: text(state.attributes.friendly_name || entry.original_name || entry.entity_id, 100) });
    }
    const home = states.find((s) => s.entity_id === 'zone.home');
    return { config: config(), home: commutePlace({ ...home?.attributes, label: home?.attributes?.friendly_name || 'Home' }), routes: [...ids.values()], parking: states.filter((s) => /^(sensor|binary_sensor)\./.test(s.entity_id))
      .map((s) => ({ id: s.entity_id, name: text(s.attributes?.friendly_name || s.entity_id, 100) })) };
  }
  function roadsFor(route) {
    const geo = commuteGeometry(route);
    if (!geo) return { roads: [], areas: [] };
    const key = geo.bounds.map((n) => n.toFixed(4)).join(',');
    if (roadCache?.key === key) return roadCache.map;
    if (!roadsFlight) {
      roadsFlight = (async () => {
        const [south, west, north, east] = geo.bounds;
        // Limit the OSM query to a regional commute, and coarsen long routes.
        if (north - south > 3 || east - west > 5) return;
        const regional = north - south > .3 || east - west > .4;
        const types = regional ? 'motorway|trunk|primary|secondary' : 'motorway|trunk|primary|secondary|tertiary|residential';
        const landuse = regional ? 'reservoir|forest|recreation_ground|village_green' : 'reservoir|forest|meadow|grass|recreation_ground|village_green';
        const natural = regional ? 'wood' : 'wood|grassland|scrub';
        const leisure = regional ? 'park' : 'park|garden';
        const bbox = `${south},${west},${north},${east}`;
        const query = `[out:json][timeout:90];(
          way(${bbox})["highway"~"^(${types})(_link)?$"];
          wr(${bbox})["natural"="water"];
          wr(${bbox})["waterway"="riverbank"];
          wr(${bbox})["landuse"~"^(${landuse})$"];
          wr(${bbox})["natural"~"^(${natural})$"];
          wr(${bbox})["leisure"~"^(${leisure})$"];
        );out geom;`;
        for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
          try {
            const response = await fetchImpl(endpoint, { method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Hauser commute (+https://hauserhome.app)' },
              body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(95_000) });
            if (!response.ok) continue;
            const reader = response.body.getReader(), chunks = []; let size = 0;
            while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
              if (size > 128 * 1024 * 1024) { await reader.cancel(); throw new Error('COMMUTE_MAP_TOO_LARGE'); } chunks.push(value); }
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (data.remark || !Array.isArray(data.elements) || !data.elements.length) continue;
            const roads = data.elements.filter((w) => w.tags?.highway && Array.isArray(w.geometry) && w.geometry.length >= 2).slice(0, 12_000)
              .flatMap((w) => clipPolyline(w.geometry.filter((p) => point([p.lat, p.lon])).map((p) => geo.project([p.lat, p.lon])), MAP_BOUNDS))
              .map(simplifyMapLine).filter((l) => l.length > 1);
            const areas = data.elements.flatMap((element) => {
              const layer = classifyArea(element.tags);
              if (!layer) return [];
              const project = (geometry) => Array.isArray(geometry) && geometry.every((p) => point([p.lat, p.lon]))
                ? geometry.map((p) => geo.project([p.lat, p.lon])) : [];
              let rings;
              if (element.type === 'way') rings = joinAreaRings([project(element.geometry)]);
              else if (element.type === 'relation' && element.tags.type === 'multipolygon') {
                const members = (element.members ?? []).filter((m) => m.type === 'way');
                const outer = joinAreaRings(members.filter((m) => m.role === 'outer' || m.role === '').map((m) => project(m.geometry)));
                if (!outer.length) return [];
                rings = [...outer, ...joinAreaRings(members.filter((m) => m.role === 'inner').map((m) => project(m.geometry)))];
              } else return [];
              rings = rings.map((ring) => clipAreaRing(ring, MAP_BOUNDS)).filter(visibleMapRing).map(simplifyMapLine).filter((ring) => ring.length >= 4);
              return rings.length ? [{ layer, rings }] : [];
            });
            const map = { roads, areas, mapKey: `overscan-v1:${key}` };
            roadCache = { key, map };
            if (cache?.roadsKey === key && cache.route) Object.assign(cache.route, map);
            return;
          } catch { /* Try the same alternate map source as the home map. */ }
        }
      })().catch(() => {}).finally(() => { roadsFlight = null; });
    }
    return { roads: [], areas: [] };
  }
  async function read() {
    const selected = config();
    if (!selected.entryId) return { config: selected, route: null };
    if (cache && cache.id === selected.entryId && now() - cache.at < 60_000) return { config: selected, route: cache.route };
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const { registry, states } = await sources();
        const raw = await withClient((client) => client.ws('tomtom/route', { config_entry_id: selected.entryId }));
        const route = projectCommute(selected, raw, states, registry, now());
        if (route) {
          Object.assign(route, roadsFor(raw));
          route.rainAt = selected.showRain ? rainStart(await readForecast().catch(() => null), now()) : null;
        }
        cache = { id: selected.entryId, at: now(), route, roadsKey: commuteGeometry(raw)?.bounds.map((n) => n.toFixed(4)).join(',') };
        return { config: selected, route };
      } catch { return { config: selected, route: null, unavailable: true }; }
    })().finally(() => { inflight = null; });
    return inflight;
  }
  async function serve(req, res, allowedOrigins) {
    try {
      if (!requestOriginAllowed(req, allowedOrigins)) { jsonResponse(res, 403, { code: 'ORIGIN_FORBIDDEN' }); return; }
      const url = new URL(req.url, 'http://hauser.local');
      const path = url.pathname;
      const responseStatus = (status) => status.route?.mapKey && status.route.mapKey === url.searchParams.get('mapKey')
        ? { ...status, route: { ...status.route, roads: undefined, areas: undefined } } : status;
      if (req.method === 'POST' && path === '/api/admin/commute/preview') {
        if (!previewFlight) {
          previewFlight = (async () => {
            const status = await read();
            if (!status.config.entryId || (status.route && url.searchParams.get('refresh') !== '1')) return status;
            await withClient((client) => client.ws('call_service', { domain: 'tomtom', service: 'refresh',
              service_data: { config_entry_id: status.config.entryId } }), 90_000);
            if (inflight) await inflight;
            cache = null;
            return read();
          })().finally(() => { previewFlight = null; });
        }
        const status = await previewFlight;
        jsonResponse(res, status.route ? 200 : 503, responseStatus(status), { 'cache-control': 'no-store' }); return;
      }
      if (req.method === 'GET' && path === '/api/admin/commute/places') {
        const query = (url.searchParams.get('q') ?? '').trim();
        if (query.length < 3 || query.length > 200) { jsonResponse(res, 400, { code: 'INVALID_COMMUTE_PLACE' }); return; }
        const result = await withClient((client) => client.ws('tomtom/search', { text: query, limit: 5 }));
        jsonResponse(res, 200, { results: (result?.results ?? []).map(commutePlace).filter(Boolean).slice(0, 5) }); return;
      }
      if (req.method === 'GET' && path === '/api/admin/commute/route') {
        const entryId = url.searchParams.get('entryId') ?? '';
        if (!(await options()).routes.some((r) => r.id === entryId)) { jsonResponse(res, 400, { code: 'COMMUTE_ROUTE_MISSING' }); return; }
        const route = await withClient((client) => client.ws('tomtom/route', { config_entry_id: entryId }));
        const selected = config();
        function place(end) {
          const value = route?.[end];
          const label = selected.entryId === entryId ? selected.places?.[end] : null;
          return commutePlace(label && value && Math.abs(label.latitude - value.latitude) < .00001 && Math.abs(label.longitude - value.longitude) < .00001 ? label : value);
        }
        jsonResponse(res, 200, { start: place('start'), destination: place('destination') }); return;
      }
      if (req.method === 'PUT' && path === '/api/admin/commute/route') {
        const input = await readRoomImageJsonBody(req, { maxBytes: 8192 });
        const body = parseCommuteConfig(input?.config);
        const start = commutePlace(input?.start), destination = commutePlace(input?.destination);
        const name = text(input?.name, 80).trim();
        if (!body || !start || !destination || !body.days.length || body.from === body.until || (!body.entryId && !name)
          || (start.latitude === destination.latitude && start.longitude === destination.longitude)) { jsonResponse(res, 400, { code: 'INVALID_COMMUTE' }); return; }
        if (body.entryId && !(await options()).routes.some((r) => r.id === body.entryId)) { jsonResponse(res, 400, { code: 'COMMUTE_ROUTE_MISSING' }); return; }
        const entryId = await withClient((client) => writeTomTomRoute(client, { ...body, name, start, destination, config: body }));
        const saved = { ...body, entryId, places: { start, destination } };
        configStore.update({ [COMMUTE_KEY]: JSON.stringify(saved) }); cache = null;
        jsonResponse(res, 200, { config: saved }); return;
      }
      if (req.method === 'GET' && path === '/api/commute') {
        jsonResponse(res, 200, responseStatus(await read()), { 'cache-control': 'no-store' }); return;
      }
      if (req.method === 'GET' && path === '/api/admin/commute') {
        jsonResponse(res, 200, await options(), { 'cache-control': 'no-store' }); return;
      }
      if (req.method === 'PUT' && path === '/api/admin/commute') {
        const body = parseCommuteConfig(await readRoomImageJsonBody(req, { maxBytes: 4096 }));
        if (!body) { jsonResponse(res, 400, { code: 'INVALID_COMMUTE' }); return; }
        if (body.entryId && !(await options()).routes.some((r) => r.id === body.entryId)) { jsonResponse(res, 400, { code: 'COMMUTE_ROUTE_MISSING' }); return; }
        const previous = config();
        if (body.entryId && (previous.entryId !== body.entryId || previous.from !== body.from || previous.until !== body.until || JSON.stringify(previous.days) !== JSON.stringify(body.days))) {
          await withClient((client) => writeTomTomRoute(client, { entryId: body.entryId, config: body }));
        }
        configStore.update({ [COMMUTE_KEY]: JSON.stringify(body) }); cache = null;
        jsonResponse(res, 200, { config: body }); return;
      }
      jsonResponse(res, 405, { code: 'METHOD_NOT_ALLOWED' });
    } catch { jsonResponse(res, 503, { code: 'COMMUTE_UNAVAILABLE' }); }
  }
  return { read, options, serve };
}
