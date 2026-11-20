/* Außenwetter (Issue #15): Der Ort gehört dem Server, nicht dem Browser.

   Vorher fragte die Oberfläche Open-Meteo direkt mit fest eingetragenen
   Stadtkoordinaten — jeder Haushalt sah das Wetter derselben Stadt. Jetzt
   liest der Server einmal die Heimatkoordinaten aus Home Assistant
   (`/api/config`, dieselbe Quelle wie der Stadtplan), fragt Open-Meteo selbst
   und gibt nur die Wetterwerte weiter. Koordinaten verlassen den Server nicht;
   Open-Meteo sieht die Adresse des Servers, nicht die des Panels.

   Beides ist gecacht: der Ort für Stunden, das Wetter für Minuten. Fällt
   Open-Meteo aus, bleibt der letzte Stand stehen — die Klimazeile ist
   best-effort und nie ein Fehler auf dem Panel. */
import { jsonResponse } from './shared.mjs';

const WEATHER_TTL_MS = 10 * 60 * 1000;
const LOCATION_TTL_MS = 6 * 60 * 60 * 1000;
const OPEN_METEO_TIMEOUT_MS = 10_000;
const OPEN_METEO_BODY_MAX = 64 * 1024;
export const WEATHER_SOURCE_KEY = 'hmi:weather-source:v1';
const CONDITION_CODES = { sunny: 0, 'clear-night': 0, partlycloudy: 2, cloudy: 3, fog: 45, rainy: 61, pouring: 65,
  snowy: 71, 'snowy-rainy': 68, hail: 96, lightning: 95, 'lightning-rainy': 95, windy: 3, 'windy-variant': 3, exceptional: 99 };
function number(value) { return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null; }
function celsius(value, unit) { const n = number(value); return n === null ? null : unit === '°F' ? (n - 32) * 5 / 9 : n; }
function windKmh(value, unit) { const n = number(value); return n === null ? null : n * ({ 'm/s': 3.6, mph: 1.609344, kn: 1.852 }[unit] ?? 1); }
function rainfall(value, unit) { const n = number(value); return n === null ? null : n * (unit?.startsWith('in') ? 25.4 : 1); }
export function weatherSourceConfig(raw) {
  const config = {};
  for (const key of ['entityId', 'temperature', 'feelsLike', 'rain', 'wind', 'humidity', 'uv']) {
    const value = raw?.[key];
    const pattern = key === 'entityId' ? /^weather\.[a-z0-9_]+$/ : key === 'rain' ? /^(?:sensor|binary_sensor)\.[a-z0-9_]+$/ : /^sensor\.[a-z0-9_]+$/;
    if (typeof value === 'string' && pattern.test(value)) config[key] = value;
  }
  return config;
}

function zoneOffset(zone, timestamp) {
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(timestamp)).find(part => part.type === 'timeZoneName')?.value;
    const match = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 3600 + Number(match[3]) * 60) : 0;
  } catch { return 0; }
}

function homeSunTimes(attributes, coords, timestamp, offset) {
  const day = new Date(timestamp + offset * 1000).toISOString().slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  let calculated = {};
  if (coords) {
    // Same NOAA calculation as the native SunModel. sun.sun only exposes the
    // next event, so after sunrise/sunset it can already refer to tomorrow.
    const rad = Math.PI / 180;
    const dayOfYear = (midnight - Date.UTC(Number(day.slice(0, 4)), 0, 1)) / 86400000 + 1;
    const gamma = 2 * Math.PI / 365 * (dayOfYear - 1);
    const equation = 229.18 * (.000075 + .001868 * Math.cos(gamma) - .032077 * Math.sin(gamma) - .014615 * Math.cos(2 * gamma) - .040849 * Math.sin(2 * gamma));
    const declination = .006918 - .399912 * Math.cos(gamma) + .070257 * Math.sin(gamma) - .006758 * Math.cos(2 * gamma) + .000907 * Math.sin(2 * gamma) - .002697 * Math.cos(3 * gamma) + .00148 * Math.sin(3 * gamma);
    const cosAngle = Math.cos(90.833 * rad) / (Math.cos(coords.latitude * rad) * Math.cos(declination)) - Math.tan(coords.latitude * rad) * Math.tan(declination);
    if (cosAngle >= -1 && cosAngle <= 1) {
      const angle = Math.acos(cosAngle) / rad;
      calculated = { sunrise: midnight + (720 - 4 * (coords.longitude + angle) - equation) * 60000,
        sunset: midnight + (720 - 4 * (coords.longitude - angle) - equation) * 60000 };
    }
  }
  return Object.fromEntries([['sunrise', 'next_rising'], ['sunset', 'next_setting']].map(([key, attribute]) => {
    const next = typeof attributes?.[attribute] === 'string' ? Date.parse(attributes[attribute]) : NaN;
    const today = Number.isFinite(next) && new Date(next + offset * 1000).toISOString().slice(0, 10) === day;
    const instant = today ? next : calculated[key];
    return [key, Number.isFinite(instant) ? new Date(instant).toISOString() : null];
  }));
}

function haForecast(rows, attributes, daily = false, offset = 0) {
  const list = Array.isArray(rows) ? rows.filter(row => typeof row?.datetime === 'string' && Number.isFinite(Date.parse(row.datetime))).slice(0, daily ? 10 : 72) : [];
  const field = (name, convert = value => number(value)) => list.map(row => convert(row[name]));
  return {
    time: list.map(row => new Date(Date.parse(row.datetime) + offset * 1000).toISOString().slice(0, daily ? 10 : 16)),
    weather_code: field('condition', value => CONDITION_CODES[value] ?? null),
    ...(daily ? { temperature_2m_max: field('temperature', value => celsius(value, attributes.temperature_unit)),
      temperature_2m_min: field('templow', value => celsius(value, attributes.temperature_unit)), precipitation_probability_max: field('precipitation_probability'),
      uv_index_max: field('uv_index') }
      : { temperature_2m: field('temperature', value => celsius(value, attributes.temperature_unit)),
        precipitation_probability: field('precipitation_probability'), precipitation: field('precipitation', value => rainfall(value, attributes.precipitation_unit)),
        wind_speed_10m: field('wind_speed', value => windKmh(value, attributes.wind_speed_unit)) }),
  };
}

/** Dieselbe Abfrage, die die Oberfläche früher selbst stellte; `timezone=auto`
    richtet die Stundenwerte am Ort aus, nicht an einer festen Zeitzone. */
export function openMeteoForecastUrl({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,rain,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m',
    minutely_15: 'rain',
    forecast_minutely_15: '12',
    past_hours: '1',
    forecast_hours: '48',
    /* Auf- und Untergang für den Sonnenbogen über der Energie. */
    daily: 'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max',
    forecast_days: '7',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

/** Heimatkoordinaten aus der Antwort von `GET /api/config` — oder `null`. */
export function homeLocationFromHaConfig(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { latitude, longitude } = payload;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function routeWeatherPoints(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const [lat, lon] = points[i], [previousLat, previousLon] = points[i - 1];
    const length = Math.hypot(lat - previousLat, (lon - previousLon) * Math.cos((lat + previousLat) * Math.PI / 360));
    distances.push(distances[i - 1] + length);
  }
  const total = distances.at(-1);
  const samples = [points[0], points.at(-1)];
  for (const fraction of [1 / 3, 2 / 3]) {
    const target = total * fraction;
    const i = distances.findIndex((distance, index) => index > 0 && distance >= target);
    if (i < 1 || distances[i] === distances[i - 1]) continue;
    const weight = (target - distances[i - 1]) / (distances[i] - distances[i - 1]);
    samples.push(points[i - 1].map((start, axis) => start + (points[i][axis] - start) * weight));
  }
  return [...new Set(samples.map(([lat, lon]) => `${lat.toFixed(2)},${lon.toFixed(2)}`))].map((point) => point.split(','));
}

function earliestSnow(forecasts, timestamp) {
  let first = Infinity;
  for (const forecast of forecasts) {
    const times = forecast?.minutely_15?.time, snowfall = forecast?.minutely_15?.snowfall;
    if (!Array.isArray(times) || !Array.isArray(snowfall)) continue;
    for (const [i, seconds] of times.entries()) {
      const end = seconds * 1000;
      if (Number.isFinite(seconds) && snowfall[i] > 0 && end > timestamp && end <= timestamp + 2 * 60 * 60_000) {
        first = Math.min(first, Math.max(timestamp, end - 15 * 60_000));
      }
    }
  }
  return first === Infinity ? null : new Date(first).toISOString();
}

export function createWeatherService({
  clientFactory,
  resolveCredentials,
  fetchImpl = fetch,
  now = () => Date.now(),
  ttlMs = WEATHER_TTL_MS,
  locationTtlMs = LOCATION_TTL_MS,
  timeoutMs = OPEN_METEO_TIMEOUT_MS,
  readSettings = () => ({}),
} = {}) {
  let location = null;   // { value, at }
  let cache = null;      // { data, at }
  let inflight = null;
  let routeSnow = null;
  let meteoCache = null;
  let forecastZone = null;

  async function homeAssistantWeather(selected, base) {
    const credentials = resolveCredentials();
    if (!credentials) return null;
    const client = clientFactory(credentials);
    try {
      const states = await client.ws('get_states');
      const byId = new Map(states.map(state => [state.entity_id, state]));
      const entity = byId.get(selected.entityId), attributes = entity?.attributes ?? {};
      if (selected.entityId && (!entity || ['unavailable', 'unknown'].includes(entity.state))) return null;
      if (entity && (!forecastZone || now() - forecastZone.at >= locationTtlMs)) {
        const config = await client.ws('get_config').catch(() => null);
        forecastZone = { value: config?.time_zone ?? 'UTC', coordinates: homeLocationFromHaConfig(config), at: now() };
      }
      const offset = entity ? zoneOffset(forecastZone.value, now()) : 0;
      const forecast = async type => {
        if (!entity) return [];
        try {
          const result = await client.ws('call_service', { domain: 'weather', service: 'get_forecasts',
            target: { entity_id: selected.entityId }, service_data: { type }, return_response: true });
          return result?.response?.[selected.entityId]?.forecast ?? [];
        } catch { return []; }
      };
      const [hourly, daily] = await Promise.all([forecast('hourly'), forecast('daily')]);
      const current = entity ? { temperature_2m: celsius(attributes.temperature, attributes.temperature_unit),
        apparent_temperature: celsius(attributes.apparent_temperature, attributes.temperature_unit), relative_humidity_2m: number(attributes.humidity),
        weather_code: CONDITION_CODES[entity.state] ?? null, precipitation: number(attributes.precipitation),
        wind_speed_10m: windKmh(attributes.wind_speed, attributes.wind_speed_unit), wind_direction_10m: number(attributes.wind_bearing),
        uv_index: number(attributes.uv_index), ...homeSunTimes(byId.get('sun.sun')?.attributes, forecastZone.coordinates, now(), offset) } : { ...base?.current };
      for (const [key, field] of [['temperature', 'temperature_2m'], ['feelsLike', 'apparent_temperature'], ['humidity', 'relative_humidity_2m'], ['wind', 'wind_speed_10m'], ['rain', 'precipitation'], ['uv', 'uv_index']]) {
        const sensor = byId.get(selected[key]);
        if (!sensor || ['unavailable', 'unknown'].includes(sensor.state)) continue;
        const unit = sensor.attributes?.unit_of_measurement;
        if (key === 'rain' && sensor.entity_id.startsWith('binary_sensor.')) {
          if (sensor.state === 'on') current.weather_code = 61;
          else if (sensor.state === 'off' && [61, 65].includes(current.weather_code)) current.weather_code = 3;
          // A wet/dry contact does not measure a precipitation amount.
          current.precipitation = null;
          continue;
        }
        const value = key === 'temperature' || key === 'feelsLike' ? celsius(sensor.state, unit) : key === 'wind' ? windKmh(sensor.state, unit) : key === 'rain' ? rainfall(sensor.state, unit) : number(sensor.state);
        if (value === null || (key === 'humidity' && (value < 0 || value > 100)) || (['rain', 'uv'].includes(key) && value < 0)) continue;
        current[field] = value;
        if (key === 'rain' && value > 0 && ![71, 73, 75, 77, 85, 86].includes(current.weather_code)) current.weather_code = 61;
        if (key === 'rain' && value === 0 && [61, 65].includes(current.weather_code)) current.weather_code = 3;
      }
      if (!Number.isFinite(current.temperature_2m)) return null;
      return { ...(base ?? {}), current, source: entity ? String(attributes.friendly_name ?? selected.entityId) : 'Open-Meteo + Home Assistant',
        ...(entity ? { hourly: haForecast(hourly, attributes, false, offset), daily: haForecast(daily, attributes, true, offset), minutely_15: null, utc_offset_seconds: offset } : {}) };
    } finally { client.close?.(); }
  }

  async function readLocation() {
    if (location && now() - location.at < locationTtlMs) return location.value;
    const credentials = resolveCredentials();
    if (!credentials) return location?.value ?? null;
    const client = clientFactory(credentials);
    try {
      const result = await client.rest('GET', '/api/config');
      const value = result?.status === 200 ? homeLocationFromHaConfig(result.body) : null;
      if (value) location = { value, at: now() };
      /* Antwortet Home Assistant gerade nicht, gilt der zuletzt bekannte Ort
         weiter — er ändert sich praktisch nie. */
      return value ?? location?.value ?? null;
    } catch {
      return location?.value ?? null;
    } finally {
      client.close?.();
    }
  }

  async function readForecast(coords) {
    const response = await fetchImpl(openMeteoForecastUrl(coords), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) return null;
    const text = await response.text();
    if (Buffer.byteLength(text) > OPEN_METEO_BODY_MAX) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  }

  async function read() {
    const selected = weatherSourceConfig(readSettings());
    const key = JSON.stringify(selected);
    const custom = Object.keys(selected).length > 0;
    if (cache?.key === key && now() - cache.at < (custom ? Math.min(ttlMs, 30_000) : ttlMs)) return cache.data;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const previous = cache?.key === key ? cache.data : null;
        let forecast = null;
        if (!selected.entityId) {
          const coords = await readLocation();
          if (!coords) return previous ?? { ok: false, code: 'WEATHER_LOCATION_UNAVAILABLE' };
          const locationKey = JSON.stringify(coords);
          if (meteoCache?.key === locationKey && now() - meteoCache.at < ttlMs) forecast = meteoCache.data;
          else {
            forecast = await readForecast(coords).catch(() => null);
            if (forecast) meteoCache = { key: locationKey, at: now(), data: forecast };
          }
        }
        if (custom) forecast = await homeAssistantWeather(selected, forecast).catch(() => null);
        if (!forecast) return previous ?? { ok: false, code: 'WEATHER_UNAVAILABLE' };
        const data = {
          ok: true,
          version: 1,
          source: forecast.source ?? 'Open-Meteo',
          pollAfterSeconds: custom ? 30 : 900,
          updatedAt: new Date(now()).toISOString(),
          current: forecast.current ?? null,
          hourly: forecast.hourly ?? null,
          minutely_15: forecast.minutely_15 ?? null,
          daily: forecast.daily ?? null,
          utc_offset_seconds: forecast.utc_offset_seconds ?? null,
        };
        cache = { data, at: now(), key };
        return data;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function readRouteSnow(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const samples = routeWeatherPoints(points);
    const key = JSON.stringify(samples);
    const timestamp = now();
    if (routeSnow?.key !== key || timestamp - routeSnow.at >= ttlMs) {
      const params = new URLSearchParams({ latitude: samples.map(([lat]) => lat).join(','), longitude: samples.map(([, lon]) => lon).join(','),
        minutely_15: 'snowfall', forecast_minutely_15: '9', timeformat: 'unixtime' });
      const forecasts = (async () => {
        const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(Math.min(timeoutMs, 4000)) });
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : [data];
      })().catch(() => []);
      routeSnow = { key, at: timestamp, forecasts };
    }
    return earliestSnow(await routeSnow.forecasts, timestamp);
  }

  return { read, readRouteSnow };
}

export async function serveWeather(req, res, service) {
  if (req.method !== 'GET') {
    jsonResponse(res, 405, { ok: false, code: 'WEATHER_METHOD_NOT_ALLOWED', message: 'Nur GET.' }, { allow: 'GET' });
    return;
  }
  const data = await service.read();
  if (!data.ok) {
    jsonResponse(res, 503, { ...data, message: 'Kein Außenwetter verfügbar.' });
    return;
  }
  jsonResponse(res, 200, data);
}
