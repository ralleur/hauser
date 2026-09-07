/* ── Werkstatt-Simulator (Paket 4) ──
   Dämmerung und Nachdimmen zeigen sich im Alltag zweimal am Tag für zwanzig
   Minuten. Zum Beurteilen — passen Tag- und Nachtbild überhaupt aufeinander? —
   ist das zu wenig. Dieser Zustand hält deshalb Überschreibungen, die der
   Simulator setzt und die sonst niemand anfasst.

   `null` heißt immer „nicht simuliert": dann gilt der echte Sonnenstand
   beziehungsweise der echte Lichtzustand des Raums. Nichts davon wird
   gespeichert — ein Neuladen beendet jede Simulation. */

import type { WeatherCondition } from './weather.ts';

/** Wetterlage von Hand, `'off'` schaltet die Schicht ganz ab — dieselben Werte
    wie der Adressparameter `?weather=`, nur ohne Neuladen. */
export type SimulatedWeatherChoice = WeatherCondition | 'off';

/** Energiewerte von Hand (R20): Erzeugung und Last in kW, dazu die zwei
    Sonderfälle, die der Screen anders zeichnet — Haus ohne Erzeugungssensor
    (keine Solarseite, R3) und Haus ohne jeden Sensor (nur das Bild). */
export interface SimulatedEnergy {
  pv: number;
  load: number;
  generation: boolean;
  configured: boolean;
}

export const simulation = $state({
  /** Dämmerungsstand 0…1, überschreibt die Sonnenhöhe. */
  dusk: null as number | null,
  /** Erzwingt „alle zugewiesenen Lichter aus" und damit `dark-off`. */
  lightsOff: null as boolean | null,
  /** Wetterlage von Hand; `null` heißt „echte Messung". */
  weather: null as SimulatedWeatherChoice | null,
  /* Erkannte Flächen farbig über dem Raumbild (Paket 13). Anders als die
     übrigen Felder überschreibt das nichts — es macht nur sichtbar, was die
     Erkennung gefunden hat, und beantwortet damit die Frage, ob das Wetter im
     richtigen Fenster zieht. */
  regions: false,
  /** Energiewerte von Hand; `null` heißt „echte Sensoren". */
  energy: null as SimulatedEnergy | null,
});

export function setSimulatedEnergy(value: SimulatedEnergy | null): void {
  simulation.energy = value === null ? null : {
    pv: Math.max(0, value.pv),
    load: Math.max(0, value.load),
    generation: value.generation,
    configured: value.configured,
  };
}

export function setSimulatedDusk(value: number | null): void {
  simulation.dusk = value === null ? null : Math.min(1, Math.max(0, value));
}

export function setSimulatedLightsOff(value: boolean | null): void {
  simulation.lightsOff = value;
}

export function setSimulatedWeather(value: SimulatedWeatherChoice | null): void {
  simulation.weather = value;
}

export function setRegionOverlay(value: boolean): void {
  simulation.regions = value;
}

/** Alles zurück auf die Wirklichkeit. */
export function clearSimulation(): void {
  simulation.dusk = null;
  simulation.lightsOff = null;
  simulation.weather = null;
  simulation.regions = false;
  simulation.energy = null;
}

export function simulationActive(): boolean {
  return simulation.dusk !== null || simulation.lightsOff !== null
    || simulation.weather !== null || simulation.regions || simulation.energy !== null;
}
