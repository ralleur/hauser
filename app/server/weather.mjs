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
    current: 'temperature_2m,weather_code,precipitation,wind_speed_10m',
    hourly: 'temperature_2m',
    past_hours: '1',
    forecast_hours: '1',
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
        };
        cache = { data, at: now() };
        return data;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return { read };
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
