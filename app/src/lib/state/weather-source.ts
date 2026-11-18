// SPDX-License-Identifier: AGPL-3.0-only
import { apiRequest } from '../api/client.ts';

export const WEATHER_SOURCE_KEY = 'hmi:weather-source:v1';
export const WEATHER_SOURCE_FIELDS = ['entityId', 'temperature', 'rain', 'wind', 'humidity'] as const;
export type WeatherSourceConfig = Partial<Record<typeof WEATHER_SOURCE_FIELDS[number], string>>;

export function loadWeatherSource(): WeatherSourceConfig {
  try { return JSON.parse(localStorage.getItem(WEATHER_SOURCE_KEY) ?? '{}'); } catch { return {}; }
}

export async function saveWeatherSource(config: WeatherSourceConfig): Promise<void> {
  const value: WeatherSourceConfig = {};
  for (const key of WEATHER_SOURCE_FIELDS) {
    const id = config[key]?.trim();
    if (!id) continue;
    const pattern = key === 'entityId' ? /^weather\.[a-z0-9_]+$/ : key === 'rain' ? /^(?:sensor|binary_sensor)\.[a-z0-9_]+$/ : /^sensor\.[a-z0-9_]+$/;
    if (!pattern.test(id)) throw new Error('INVALID_ENTITY_ID');
    value[key] = id;
  }
  const current = await apiRequest('config');
  if (!current.ok) throw new Error('WEATHER_SOURCE_SAVE_FAILED');
  const saved = await apiRequest('config', { method: 'PUT', ifMatch: current.etag, body: { updates: { [WEATHER_SOURCE_KEY]: JSON.stringify(value) } } });
  if (!saved.ok) throw new Error('WEATHER_SOURCE_SAVE_FAILED');
  localStorage.setItem(WEATHER_SOURCE_KEY, JSON.stringify(value));
}
