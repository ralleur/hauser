import { describe, expect, it } from 'vitest';
import { classifyTrend, parseOutdoor, openMeteoUrl, COLOGNE } from './weather.ts';

describe('classifyTrend', () => {
  it('meldet steigend/fallend jenseits des Totbands', () => {
    expect(classifyTrend(20, 20.5, 0.3)).toBe('rising');
    expect(classifyTrend(20, 19.5, 0.3)).toBe('falling');
  });

  it('meldet „gleich" innerhalb des Totbands', () => {
    expect(classifyTrend(20, 20.2, 0.3)).toBe('steady');
    expect(classifyTrend(20, 19.8, 0.3)).toBe('steady');
    expect(classifyTrend(20, 20, 0.3)).toBe('steady');
  });

  it('ist null ohne Vergleichswert', () => {
    expect(classifyTrend(undefined, 20, 0.3)).toBeNull();
    expect(classifyTrend(null, 20, 0.3)).toBeNull();
    expect(classifyTrend(20, null, 0.3)).toBeNull();
  });
});

describe('parseOutdoor', () => {
  it('liest Temperatur, Änderung, Sonne und Wind aus der bestehenden Open-Meteo-Antwort', () => {
    const reading = parseOutdoor({
      current: { temperature_2m: 22.4, weather_code: 0, wind_speed_10m: 12, precipitation: 0 },
      hourly: { temperature_2m: [20.0, 22.0] },
    });
    expect(reading).toEqual({
      temp: 22.4,
      trend: 'rising',
      tempDelta: 2.4,
      condition: 'sunny',
      windSpeed: 12,
    });
  });

  it('klassifiziert Regen und windiges Wetter ohne neue Datenquelle', () => {
    const rainy = parseOutdoor({
      current: { temperature_2m: 14, weather_code: 61, wind_speed_10m: 35, precipitation: 1.2 },
      hourly: { temperature_2m: [14] },
    });
    expect(rainy.condition).toBe('rainy');
    expect(rainy.windSpeed).toBe(35);
  });

  it('meldet Schneecodes nicht fälschlich als Regen', () => {
    const snowy = parseOutdoor({
      current: { temperature_2m: -1, weather_code: 73, precipitation: 0.8 },
    });
    expect(snowy.condition).toBe('snowy');
  });

  it('toleriert fehlende Felder vollständig', () => {
    expect(parseOutdoor({})).toEqual({
      temp: null,
      trend: null,
      tempDelta: null,
      condition: null,
      windSpeed: null,
    });
  });
});

describe('openMeteoUrl', () => {
  it('nutzt feste Köln-Koordinaten und fordert Wettercode, Niederschlag und Wind mit an', () => {
    const url = openMeteoUrl();
    expect(url).toContain(`latitude=${COLOGNE.latitude}`);
    expect(url).toContain(`longitude=${COLOGNE.longitude}`);
    expect(url).toContain('current=temperature_2m%2Cweather_code%2Cprecipitation%2Cwind_speed_10m');
  });
});
