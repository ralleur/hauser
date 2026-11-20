/* ============================================
   Ambient-Klimazeile (Standby): Außentemperatur und Wetterlage über Open-Meteo
   (öffentlich, ohne API-Key). Im Betrieb fragt die Oberfläche den eigenen
   Server (`/api/weather`), der den Ort aus Home Assistant kennt; nur die
   statische Demo ruft Open-Meteo direkt mit festen Beispielkoordinaten auf.
   State-/Fetch-Teil: weather.svelte.ts.
   ============================================ */

export type TempTrend = 'rising' | 'steady' | 'falling';
export type WeatherCondition = 'sunny' | 'rainy' | 'snowy' | 'cloudy';

/* Symbol der Wetterzeile im Ruhebild: dieselbe Lage, die auch Regen und
   Schnee über die Tafel zieht — vorher stand dort immer die Sonne, auch wenn
   es regnete (simon42-Forum, Cpt.Hardy 2026-10-01). Ohne Lage bleibt das
   neutrale Thermometer. */
const CONDITION_ICONS: Record<WeatherCondition, string> = {
  sunny: 'i-weather-sunny',
  cloudy: 'i-weather-cloudy',
  rainy: 'i-weather-rainy',
  snowy: 'i-weather-snowy',
};

export function weatherConditionIcon(condition: WeatherCondition | null | undefined): string {
  return condition ? CONDITION_ICONS[condition] : 'i-sun-thermometer-outline';
}

/* Beispielort der Demo (Köln, grob gerundet) — im Betrieb kommt der Ort aus
   Home Assistant, siehe server/weather.mjs. */
export const DEMO_COORDS = { latitude: 50.94, longitude: 6.96 } as const;

export function openMeteoUrl(coords: { latitude: number; longitude: number }): string {
  const p = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m',
    past_hours: '1',
    forecast_hours: '48',
    daily: 'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max',
    forecast_days: '7',
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
    sunrise?: string | null;
    sunset?: string | null;
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

function sunInstant(value: string | null | undefined): number | null {
  const instant = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(instant) ? instant : null;
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
export function weatherCondition(
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
    sunrise: sunInstant(data.current?.sunrise) ?? localInstant(data.daily?.sunrise?.[0], data.utc_offset_seconds),
    sunset: sunInstant(data.current?.sunset) ?? localInstant(data.daily?.sunset?.[0], data.utc_offset_seconds),
  };
}


export interface ForecastHour {
  time: number; temp: number | null; condition: WeatherCondition | null;
  rainChance: number | null; rain: number | null; wind: number | null;
}
export interface ForecastDay {
  date: string; high: number | null; low: number | null;
  condition: WeatherCondition | null; rainChance: number | null;
}
export interface WeatherDetails {
  source?: string;
  updatedAt: number; offsetSeconds: number; feelsLike: number | null; humidity: number | null;
  windDirection: number | null; uv: number | null; uvIsMaximum: boolean;
  hours: ForecastHour[]; days: ForecastDay[];
}

/* Keep the provider's local times tied to its offset, including when the
   panel and home are in different time zones. Missing values stay missing. */
export function parseWeatherDetails(value: unknown, now = Date.now()): WeatherDetails {
  const data = value as Record<string, any>;
  const current = data?.current ?? {}, hourly = data?.hourly ?? {}, daily = data?.daily ?? {};
  const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const offset = number(data?.utc_offset_seconds) ?? 0;
  const today = new Date(now + offset * 1000).toISOString().slice(0, 10);
  const todayIndex = Array.isArray(daily.time) ? daily.time.indexOf(today) : 0;
  const currentUv = number(current.uv_index), maximumUv = number(daily.uv_index_max?.[todayIndex]);
  return {
    source: typeof data?.source === 'string' ? data.source : undefined,
    updatedAt: typeof data?.updatedAt === 'string' ? Date.parse(data.updatedAt) : now,
    offsetSeconds: number(data?.utc_offset_seconds) ?? 0,
    feelsLike: number(current.apparent_temperature), humidity: number(current.relative_humidity_2m),
    windDirection: number(current.wind_direction_10m), uv: currentUv ?? maximumUv, uvIsMaximum: currentUv === null && maximumUv !== null,
    hours: (Array.isArray(hourly.time) ? hourly.time : []).flatMap((time: string, i: number) => {
      const instant = localInstant(time, data.utc_offset_seconds);
      return instant === null ? [] : [{ time: instant, temp: number(hourly.temperature_2m?.[i]),
        condition: weatherCondition(number(hourly.weather_code?.[i]), number(hourly.precipitation?.[i])),
        rainChance: number(hourly.precipitation_probability?.[i]), rain: number(hourly.precipitation?.[i]), wind: number(hourly.wind_speed_10m?.[i]) }];
    }),
    days: (Array.isArray(daily.time) ? daily.time : []).map((date: string, i: number) => ({
      date, high: number(daily.temperature_2m_max?.[i]), low: number(daily.temperature_2m_min?.[i]),
      condition: weatherCondition(number(daily.weather_code?.[i]), null), rainChance: number(daily.precipitation_probability_max?.[i]),
    })),
  };
}
