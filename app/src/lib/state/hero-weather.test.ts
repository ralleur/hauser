import { describe, expect, it } from 'vitest';
import { heroWeatherDurationMs, heroWeatherLayer, simulatedWeather } from './hero-weather.ts';
import { BRIGHT_LUX, DARK_LUX, dimFromLux, smoothDim } from './ambient-light.ts';

describe('Wetter über der Bühne (Paket 9)', () => {
  it('zeigt bei Sonne und ohne Messung gar nichts', () => {
    expect(heroWeatherLayer('sunny', 10, false)).toBeNull();
    expect(heroWeatherLayer(null, 10, false)).toBeNull();
  });

  it('macht aus Bewölkung einen unbewegten Schleier', () => {
    expect(heroWeatherLayer('cloudy', 10, false)).toMatchObject({ kind: 'haze', still: true });
  });

  it('lässt Regen und Schnee ziehen — mit dem Wind schneller', () => {
    const calm = heroWeatherLayer('rainy', 0, false)!;
    const windy = heroWeatherLayer('rainy', 40, false)!;
    expect(calm.kind).toBe('rain');
    expect(windy.intensity).toBeGreaterThan(calm.intensity);
    expect(heroWeatherDurationMs(windy)).toBeLessThan(heroWeatherDurationMs(calm));
    expect(heroWeatherLayer('snowy', 5, false)!.kind).toBe('snow');
  });

  it('fällt bei reduzierter Bewegung auf den Schleier zurück', () => {
    expect(heroWeatherLayer('rainy', 30, true)).toMatchObject({ kind: 'haze', still: true });
  });
});

describe('Werkstatt-Schalter für das Wetter', () => {
  it('ohne Parameter bleibt die Messung maßgeblich', () => {
    expect(simulatedWeather('')).toBeUndefined();
    expect(simulatedWeather('?idle=5')).toBeUndefined();
  });

  it('friert jede der vier Lagen ein', () => {
    expect(simulatedWeather('?weather=rainy')).toBe('rainy');
    expect(simulatedWeather('?weather=snowy')).toBe('snowy');
    expect(simulatedWeather('?weather=cloudy')).toBe('cloudy');
    expect(simulatedWeather('?weather=sunny')).toBe('sunny');
  });

  it('schaltet die Schicht mit off ganz ab', () => {
    expect(simulatedWeather('?weather=off')).toBeNull();
  });

  it('ignoriert Unsinn, statt etwas zu erfinden', () => {
    expect(simulatedWeather('?weather=hagel')).toBeUndefined();
  });
});

describe('Umgebungslicht (Paket 9)', () => {
  it('dimmt im Dunkeln voll und im Hellen gar nicht', () => {
    expect(dimFromLux(DARK_LUX, 0.4)).toBe(0.4);
    expect(dimFromLux(BRIGHT_LUX, 0.4)).toBe(0);
    expect(dimFromLux(null, 0.4)).toBe(0);
  });

  it('bleibt dazwischen stufenlos und monoton', () => {
    const dim = dimFromLux(60, 0.4);
    expect(dim).toBeGreaterThan(0);
    expect(dim).toBeLessThan(0.4);
    expect(dimFromLux(30, 0.4)).toBeGreaterThan(dim);
  });

  it('zieht neue Messwerte träge nach', () => {
    expect(smoothDim(0, 0.4)).toBeCloseTo(0.1, 3);
  });
});
