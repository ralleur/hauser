import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { createWeatherService, homeLocationFromHaConfig, openMeteoForecastUrl } from '../../server/weather.mjs';

const HOME = { latitude: 49.6, longitude: 6.55 };

function fakeClient(config: unknown, calls: string[]) {
  return () => ({
    rest: async (_method: string, path: string) => { calls.push(path); return { status: 200, body: config }; },
    close: () => {},
  });
}

function fakeFetch(body: unknown, urls: string[], status = 200) {
  return async (url: string) => {
    urls.push(url);
    return { status, text: async () => JSON.stringify(body) };
  };
}

const FORECAST = { current: { temperature_2m: 12.3, weather_code: 61, precipitation: 0.4, wind_speed_10m: 9 }, hourly: { temperature_2m: [11.8, 12.3] } };

describe('Außenwetter vom Server', () => {
  it('nimmt nur gültige Heimatkoordinaten aus der HA-Konfiguration', () => {
    expect(homeLocationFromHaConfig({ latitude: 49.6, longitude: 6.55, location_name: 'Home' })).toEqual(HOME);
    expect(homeLocationFromHaConfig({ latitude: 95, longitude: 6.55 })).toBe(null);
    expect(homeLocationFromHaConfig({ latitude: '49.6', longitude: 6.55 })).toBe(null);
    expect(homeLocationFromHaConfig(null)).toBe(null);
  });

  it('fragt Open-Meteo mit dem Ort aus Home Assistant und ohne feste Zeitzone', () => {
    const url = openMeteoForecastUrl(HOME);
    expect(url).toContain('latitude=49.6');
    expect(url).toContain('longitude=6.55');
    expect(url).toContain('timezone=auto');
  });

  it('liefert Wetterwerte ohne Koordinaten und cacht Ort und Wetter', async () => {
    const calls: string[] = [];
    const urls: string[] = [];
    let clock = 1_000_000;
    const service = createWeatherService({
      clientFactory: fakeClient(HOME, calls),
      resolveCredentials: () => ({ baseUrl: 'http://ha', token: 't' }),
      fetchImpl: fakeFetch(FORECAST, urls),
      now: () => clock,
      ttlMs: 60_000,
    });
    const first = await service.read();
    expect(first.ok).toBe(true);
    expect(first.current.temperature_2m).toBe(12.3);
    expect(JSON.stringify(first)).not.toContain('49.6');
    expect(calls).toEqual(['/api/config']);
    expect(urls).toHaveLength(1);

    clock += 30_000;
    expect(await service.read()).toBe(first);
    expect(urls).toHaveLength(1);

    clock += 60_000;
    await service.read();
    expect(urls).toHaveLength(2);
    expect(calls).toEqual(['/api/config']);
  });

  it('hält den letzten Stand, wenn Open-Meteo ausfällt, und meldet ohne Ort ehrlich nichts', async () => {
    let clock = 0;
    let status = 200;
    const service = createWeatherService({
      clientFactory: fakeClient(HOME, []),
      resolveCredentials: () => ({ baseUrl: 'http://ha', token: 't' }),
      fetchImpl: async () => ({ status, text: async () => JSON.stringify(FORECAST) }),
      now: () => clock,
      ttlMs: 1_000,
    });
    const first = await service.read();
    expect(first.ok).toBe(true);
    status = 500;
    clock += 5_000;
    expect(await service.read()).toBe(first);

    const without = createWeatherService({
      clientFactory: fakeClient(HOME, []),
      resolveCredentials: () => null,
      fetchImpl: fakeFetch(FORECAST, []),
    });
    expect(await without.read()).toEqual({ ok: false, code: 'WEATHER_LOCATION_UNAVAILABLE' });
  });
});
