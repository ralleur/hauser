/* ============================================
   Ambient-Klimazeile (Standby): Außentemperatur und Wetterlage für Köln über
   Open-Meteo (öffentlich, ohne API-Key). Die Anfrage trägt nur feste
   Stadtkoordinaten, keine Nutzerdaten. State-/Fetch-Teil: weather.svelte.ts.
   ============================================ */

export type TempTrend = 'rising' | 'steady' | 'falling';
export type WeatherCondition = 'sunny' | 'rainy' | 'snowy' | 'cloudy';

/* Köln (Innenstadt) — bewusst nur grob gerundet. */
export const COLOGNE = { latitude: 50.94, longitude: 6.96 } as const;

export function openMeteoUrl(coords: { latitude: number; longitude: number } = COLOGNE): string {
  const p = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    current: 'temperature_2m,weather_code,precipitation,wind_speed_10m',
    hourly: 'temperature_2m',
    past_hours: '1',
    forecast_hours: '1',
    timezone: 'Europe/Berlin',
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
}

export interface OutdoorReading {
  temp: number | null;
  trend: TempTrend | null;
  /* Änderung gegenüber der vorigen Stunde. Für auffällige Sprünge in der
     Tagesbotschaft; null, wenn Open-Meteo keinen Vergleichswert liefert. */
  tempDelta: number | null;
  condition: WeatherCondition | null;
  windSpeed: number | null;
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
  };
}
