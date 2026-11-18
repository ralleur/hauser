import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { createWeatherService, homeLocationFromHaConfig, openMeteoForecastUrl } from '../../server/weather.mjs';
import { parseOutdoor, parseWeatherDetails } from './state/weather.ts';

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
  it('uses the selected HA provider and live sensors, with unit conversion and real forecast times', async () => {
    const calls: string[] = [], upstreams: string[] = [];
    const service = createWeatherService({
      now: () => Date.parse('2026-11-18T08:00Z'),
      readSettings: () => ({ entityId: 'weather.fusion', temperature: 'sensor.outdoor', rain: 'binary_sensor.rain' }),
      resolveCredentials: () => ({}),
      clientFactory: () => ({ close: () => {}, ws: async (type: string, options: any) => {
        calls.push(type);
        if (type === 'get_states') return [
          { entity_id: 'weather.fusion', state: 'cloudy', attributes: { friendly_name: 'Weather Fusion AI', temperature: 68, temperature_unit: '°F', wind_speed: 2, wind_speed_unit: 'm/s', precipitation_unit: 'in' } },
          { entity_id: 'sensor.outdoor', state: '50', attributes: { unit_of_measurement: '°F' } },
          { entity_id: 'binary_sensor.rain', state: 'on' },
        ];
        if (type === 'get_config') return { time_zone: 'Europe/Berlin' };
        expect(options).toMatchObject({ domain: 'weather', service: 'get_forecasts', return_response: true });
        const forecast = options.service_data.type === 'hourly'
          ? [{ datetime: '2026-11-18T10:00:00+01:00', condition: 'rainy', temperature: 50, precipitation: 0.1, wind_speed: 2 }]
          : [{ datetime: '2026-11-18T00:00:00+01:00', condition: 'rainy', temperature: 68, templow: 32 }];
        return { response: { 'weather.fusion': { forecast } } };
      } }), fetchImpl: fakeFetch(FORECAST, upstreams),
    });
    const result = await service.read();
    expect(result.source).toBe('Weather Fusion AI');
    expect(result.pollAfterSeconds).toBe(30);
    expect(result.current).toMatchObject({ temperature_2m: 10, weather_code: 61, wind_speed_10m: 7.2, precipitation: null });
    expect(result.hourly.time).toEqual(['2026-11-18T10:00']);
    expect(result.utc_offset_seconds).toBe(3600);
    expect(result.hourly.precipitation[0]).toBeCloseTo(2.54);
    expect(parseOutdoor(result).condition).toBe('rainy');
    expect(parseWeatherDetails(result).hours[0]).toMatchObject({ time: Date.parse('2026-11-18T09:00Z'), temp: 10 });
    expect(parseWeatherDetails(result).days[0]).toMatchObject({ high: 20, low: 0 });
    expect(upstreams).toHaveLength(0);
    expect(calls).toEqual(['get_states', 'get_config', 'call_service', 'call_service']);
  });

  it('applies live sensor updates without repeatedly fetching the Open-Meteo forecast', async () => {
    let clock = 0, wet = 'on', rainId = 'binary_sensor.rain';
    const urls: string[] = [];
    const service = createWeatherService({ now: () => clock,
      readSettings: () => ({ rain: rainId }), resolveCredentials: () => ({}),
      clientFactory: () => ({ close: () => {}, rest: async () => ({ status: 200, body: HOME }),
        ws: async () => [{ entity_id: rainId, state: wet, attributes: { unit_of_measurement: 'mm/h' } }] }), fetchImpl: fakeFetch(FORECAST, urls),
    });
    expect((await service.read()).current.weather_code).toBe(61);
    wet = 'off'; clock += 31_000;
    expect((await service.read()).current.weather_code).toBe(3);
    rainId = 'sensor.rain_rate'; wet = '0'; clock += 31_000;
    expect((await service.read()).current).toMatchObject({ weather_code: 3, precipitation: 0 });
    expect(urls).toHaveLength(1);
  });

  it('does not reuse another provider or invent forecasts when the selected source is unavailable', async () => {
    let entityId = 'weather.first';
    const service = createWeatherService({ readSettings: () => ({ entityId }), resolveCredentials: () => ({}),
      clientFactory: () => ({ close: () => {}, ws: async (type: string) => {
        if (type === 'get_states') return [{ entity_id: 'weather.first', state: 'sunny', attributes: { temperature: 12 } }];
        throw new Error('Forecast not supported');
      } }),
    });
    expect((await service.read()).hourly.time).toEqual([]);
    entityId = 'weather.missing';
    expect(await service.read()).toMatchObject({ ok: false, code: 'WEATHER_UNAVAILABLE' });
  });

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

  it('prüft Schnee an Start, Ziel und zwei Zwischenpunkten und nutzt den frühesten Treffer', async () => {
    const clock = Date.parse('2026-11-16T06:10:00Z');
    const urls: string[] = [];
    const ending = Date.parse('2026-11-16T06:30:00Z') / 1000;
    const service = createWeatherService({ now: () => clock, fetchImpl: async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => [
        { minutely_15: { time: [ending], snowfall: [0] } },
        { minutely_15: { time: [ending + 900], snowfall: [0.5] } },
        { minutely_15: { time: [ending], snowfall: [0.1] } },
      ] };
    } });
    const points = [[50, 6], [50, 6.2], [50, 6.6]];
    expect(await service.readRouteSnow(points)).toBe('2026-11-16T06:15:00.000Z');
    expect(await service.readRouteSnow(points)).toBe('2026-11-16T06:15:00.000Z');
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.get('longitude')).toBe('6.00,6.60,6.20,6.40');
  });
});
