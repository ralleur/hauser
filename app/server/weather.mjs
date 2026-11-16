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
} = {}) {
  let location = null;   // { value, at }
  let cache = null;      // { data, at }
  let inflight = null;
  let routeSnow = null;

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
    if (cache && now() - cache.at < ttlMs) return cache.data;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const coords = await readLocation();
        if (!coords) return cache?.data ?? { ok: false, code: 'WEATHER_LOCATION_UNAVAILABLE' };
        const forecast = await readForecast(coords).catch(() => null);
        if (!forecast) return cache?.data ?? { ok: false, code: 'WEATHER_UNAVAILABLE' };
        const data = {
          ok: true,
          version: 1,
          updatedAt: new Date(now()).toISOString(),
          current: forecast.current ?? null,
          hourly: forecast.hourly ?? null,
          minutely_15: forecast.minutely_15 ?? null,
          daily: forecast.daily ?? null,
          utc_offset_seconds: forecast.utc_offset_seconds ?? null,
        };
        cache = { data, at: now() };
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
