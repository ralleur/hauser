/* ============================================
   Ambient-Klimazeile (Standby): Außentemperatur und Wetterlage über Open-Meteo
   (öffentlich, ohne API-Key). Im Betrieb fragt die Oberfläche den eigenen
   Server (`/api/weather`), der den Ort aus Home Assistant kennt; nur die
   statische Demo ruft Open-Meteo direkt mit festen Beispielkoordinaten auf.
   State-/Fetch-Teil: weather.svelte.ts.
   ============================================ */

export type TempTrend = 'rising' | 'steady' | 'falling';
export type WeatherCondition = 'sunny' | 'rainy' | 'snowy' | 'cloudy';

/* Beispielort der Demo (Köln, grob gerundet) — im Betrieb kommt der Ort aus
   Home Assistant, siehe server/weather.mjs. */
export const DEMO_COORDS = { latitude: 50.94, longitude: 6.96 } as const;

export function openMeteoUrl(coords: { latitude: number; longitude: number }): string {
  const p = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    current: 'temperature_2m,weather_code,precipitation,wind_speed_10m',
    hourly: 'temperature_2m',
    past_hours: '1',
    forecast_hours: '1',
    daily: 'sunrise,sunset',
    forecast_days: '1',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number | null;
    weather_code?: number | null;
    precipitation?: number | null;
    wind_speed_10m?: number | null;
  };
  hourly?: { temperature_2m?: (number | null)[] };
  /* Ortszeit ohne Versatz („2026-09-24T07:18"), dazu der Versatz des Ortes. */
  daily?: { sunrise?: (string | null)[]; sunset?: (string | null)[] } | null;
  utc_offset_seconds?: number | null;
}

export interface OutdoorReading {
  temp: number | null;
  trend: TempTrend | null;
  /* Änderung gegenüber der vorigen Stunde. Für auffällige Sprünge in der
     Tagesbotschaft; null, wenn Open-Meteo keinen Vergleichswert liefert. */
  tempDelta: number | null;
  condition: WeatherCondition | null;
  windSpeed: number | null;
  /* Heutiger Auf- und Untergang in ms seit Epoche (Sonnenbogen der Energie);
     fehlt in älteren gespeicherten Ständen. */
  sunrise?: number | null;
  sunset?: number | null;
}

/* Open-Meteo nennt die Zeit des Ortes ohne Versatz; mit `utc_offset_seconds`
   wird daraus ein Zeitpunkt. Alles andere ist kein Sonnenstand. */
function localInstant(value: string | null | undefined, offsetSeconds: number | null | undefined): number | null {
  if (typeof value !== 'string' || typeof offsetSeconds !== 'number' || !Number.isFinite(offsetSeconds)) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const utc = Date.parse(`${value}:00Z`);
  return Number.isFinite(utc) ? utc - offsetSeconds * 1000 : null;
}

export function classifyTrend(
  prev: number | null | undefined,
  curr: number | null | undefined,
  deadband: number,
): TempTrend | null {
  if (typeof prev !== 'number' || typeof curr !== 'number') return null;
  const delta = curr - prev;
  if (delta > deadband) return 'rising';
  if (delta < -deadband) return 'falling';
  return 'steady';
}

/* WMO-Codes 0/1 sind klar bzw. überwiegend klar. Niederschlags-Codes beginnen
   bei 51; zusätzlich gewinnt ein realer aktueller Niederschlagswert. */
function weatherCondition(
  code: number | null | undefined,
  precipitation: number | null | undefined,
): WeatherCondition | null {
  if (typeof code === 'number' && [71, 73, 75, 77, 85, 86].includes(code)) return 'snowy';
  if (typeof precipitation === 'number' && precipitation > 0) return 'rainy';
  if (typeof code !== 'number') return null;
  if (code <= 1) return 'sunny';
  if (code >= 51) return 'rainy';
  return 'cloudy';
}

/* Aktuelles Wetter plus Vergleich zur Vorstunde. Werte bleiben null, wenn das
   jeweilige Feld fehlt; dadurch kann die Textlogik gezielt degradieren. */
export function parseOutdoor(data: OpenMeteoResponse): OutdoorReading {
  const temp = typeof data.current?.temperature_2m === 'number'
    ? data.current.temperature_2m : null;
  const hourly = data.hourly?.temperature_2m ?? [];
  const prev = hourly.length && typeof hourly[0] === 'number' ? hourly[0] : null;
  const tempDelta = temp !== null && prev !== null
    ? Number((temp - prev).toFixed(1)) : null;
  return {
    temp,
    trend: classifyTrend(prev, temp, 0.3),
    tempDelta,
    condition: weatherCondition(data.current?.weather_code, data.current?.precipitation),
    windSpeed: typeof data.current?.wind_speed_10m === 'number'
      ? data.current.wind_speed_10m : null,
    sunrise: localInstant(data.daily?.sunrise?.[0], data.utc_offset_seconds),
    sunset: localInstant(data.daily?.sunset?.[0], data.utc_offset_seconds),
  };
}
