/* ============================================
   Wetter über dem Raumbild (B-01B, Paket 9) — reine Zuordnung
   --------------------------------------------
   Aus der Wetterlage wird genau eine Schicht: Regen, Schnee oder ein
   Schleier. Was die Schicht kostet, entscheidet die Fallback-Matrix hier —
   nicht die Komponente. Alles darin läuft später ausschließlich über
   transform und opacity (Regel 2 aus docs/20).
   ============================================ */

import type { WeatherCondition } from './weather.ts';

export type HeroWeatherKind = 'rain' | 'snow' | 'haze';

export interface HeroWeatherLayer {
  kind: HeroWeatherKind;
  /** 0…1 — steuert Deckkraft und Tempo der Schicht. */
  intensity: number;
  /** true = nur der Schleier, keine ziehenden Tropfen/Flocken. */
  still: boolean;
}

/* Fallback-Matrix (docs/audit-2026-07-13, B-01B):
     sunny            → gar keine Schicht
     cloudy           → Schleier, unbewegt
     rainy / snowy    → ziehende Schicht, Tempo aus dem Wind
     unbekannt/fehlt  → gar keine Schicht (nie raten)
   `prefers-reduced-motion` fällt immer auf den Schleier zurück: die Aussage
   „es regnet" bleibt, die Bewegung entfällt. */
export function heroWeatherLayer(
  condition: WeatherCondition | null,
  windSpeed: number | null,
  reducedMotion: boolean,
): HeroWeatherLayer | null {
  if (condition === null || condition === 'sunny') return null;
  if (condition === 'cloudy') return { kind: 'haze', intensity: 0.5, still: true };
  const wind = typeof windSpeed === 'number' ? windSpeed : 0;
  // 0 km/h → ruhig, ab 40 km/h volle Intensität.
  const intensity = Math.min(1, 0.45 + Math.max(0, wind) / 40 * 0.55);
  if (reducedMotion) return { kind: 'haze', intensity: Math.min(0.6, intensity), still: true };
  return { kind: condition === 'snowy' ? 'snow' : 'rain', intensity, still: false };
}

/* ── Werkstatt-Schalter (Abnahme Paket 9: „vier Wetterlagen simuliert") ──
   `?weather=sunny|cloudy|rainy|snowy` friert die Lage ein, ohne auf echtes
   Wetter zu warten; `?weather=off` schaltet die Schicht ganz ab. Analog zu
   `?dusk=`, `?idle=` und `?deepnight=1`. `undefined` heißt „kein Schalter" —
   auch bei einem Tippfehler, dann zählt weiter die gemessene Lage. */
const SIMULATED: readonly WeatherCondition[] = ['sunny', 'cloudy', 'rainy', 'snowy'];

/** Welche Lage gilt: der Simulator schlägt den Adressparameter, der die
    Messung schlägt. `null` heißt „keine Schicht" — sei es, weil die Sonne
    scheint, oder weil jemand sie ausgeschaltet hat. */
export function resolvedWeatherCondition(
  manual: WeatherCondition | 'off' | null,
  search: string,
  measured: WeatherCondition | null,
): WeatherCondition | null {
  if (manual !== null) return manual === 'off' ? null : manual;
  const forced = simulatedWeather(search);
  if (forced === null) return null;
  return forced === undefined ? measured : forced;
}

export function simulatedWeather(search: string): WeatherCondition | null | undefined {
  const value = new URLSearchParams(search).get('weather');
  if (value === null) return undefined;
  if (value === 'off') return null;
  return SIMULATED.find((entry) => entry === value);
}

/** Dauer eines Durchlaufs der ziehenden Schicht — je stärker, desto schneller. */
export function heroWeatherDurationMs(layer: HeroWeatherLayer): number {
  const fastest = layer.kind === 'snow' ? 9000 : 1400;
  const slowest = layer.kind === 'snow' ? 18000 : 2600;
  return Math.round(slowest - (slowest - fastest) * layer.intensity);
}
