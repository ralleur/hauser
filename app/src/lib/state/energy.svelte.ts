/* ============================================
   Energie-Sicht (ADR-018, docs/07 Screen 10) — komponiert die read-only
   HA-Sensoren (ENERGY_SENSORS) zur Fluss- + KPI-Sicht des Energy-Screens.
   Liest ausschließlich die gemergte Sicht (runtime.merged) der Sensor-Entitäten;
   kennt weder EntityStore noch Backend. Nicht konfigurierte/nicht verfügbare
   Sensoren → null (die UI zeigt „—" bzw. lässt den Node inaktiv).

   Einheiten-Normalisierung: HA liefert Leistung oft in W, Energie oft in Wh —
   die UI rechnet in kW/kWh. `unit` aus dem Sensor entscheidet (W/Wh → /1000).
   ============================================ */

import { runtime } from '../adapter/runtime.svelte.ts';
import { ENERGY_SENSORS, energyRefIds, type EnergySensorRef, type LoadSource } from './app.svelte.ts';
import { computeLoadBreakdown, type LoadBreakdown } from './energy-load.ts';
import type { SensorValue } from '../adapter/types.ts';

function readSensor(eid: string | null): SensorValue | null {
  if (!eid) return null;
  return (runtime.merged(eid) as SensorValue | undefined) ?? null;
}

function sumRefs(
  ref: EnergySensorRef | readonly LoadSource[],
  read: (eid: string) => number | null,
): number | null {
  const refs = energyRefIds(ref);
  if (!refs.length) return null;
  let sum = 0;
  let seen = false;
  for (const eid of refs) {
    const value = read(eid);
    if (value === null) continue;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

/* Leistung → kW (W/kW-Einheit; unbekannte Einheit: wie geliefert). */
function kw(eid: string): number | null {
  const s = readSensor(eid);
  if (!s || s.value === null) return null;
  return s.unit === 'W' ? s.value / 1000 : s.value;
}

/* Energie → kWh (Wh/kWh-Einheit; unbekannte Einheit: wie geliefert). */
function kwh(eid: string): number | null {
  const s = readSensor(eid);
  if (!s || s.value === null) return null;
  return s.unit === 'Wh' ? s.value / 1000 : s.value;
}

function configured(ref: EnergySensorRef | readonly LoadSource[]): boolean {
  return energyRefIds(ref).length > 0;
}

export interface EnergyView {
  /** true, sobald mindestens PV oder Last konfiguriert ist (sonst Hinweis-State) */
  configured: boolean;
  pv: number | null;
  load: number | null;
  /** Netz: >0 Einspeisung, <0 Bezug. Abgeleitet aus (PV − Last). null = unbekannt. */
  grid: number | null;
  today: {
    produced: number | null;
    consumed: number | null;
    fedIn: number | null;
    drawn: number | null;
  };
}

export function energyView(): EnergyView {
  const pv = sumRefs(ENERGY_SENSORS.pv, kw);
  const load = sumRefs(ENERGY_SENSORS.load, kw);
  // Netz-Fluss aus (PV − Last): >0 Überschuss/Einspeisung, <0 Bezug. Nur wenn
  // beide Werte echte Sensoren haben; sonst bleibt Netz unbekannt statt geraten.
  const grid = pv !== null && load !== null ? pv - load : null;
  const hasConfig = configured(ENERGY_SENSORS.pv) || configured(ENERGY_SENSORS.load);
  return {
    configured: hasConfig,
    pv,
    load,
    grid,
    today: {
      produced: sumRefs(ENERGY_SENSORS.producedToday, kwh),
      consumed: sumRefs(ENERGY_SENSORS.consumedToday, kwh),
      fedIn: sumRefs(ENERGY_SENSORS.fedInToday, kwh),
      drawn: sumRefs(ENERGY_SENSORS.drawnToday, kwh),
    },
  };
}

/* Aufschlüsselung der aktuellen „Erfassten Last" nach Quelle (B-19): liest jede
   `ENERGY_SENSORS.load`-Quelle über denselben kW-Seam wie energyView().load und
   delegiert die Segment-/Prozent-/„Sonstige"-Mathematik an die reine Utility.
   Reaktiv via runtime.merged — im Overlay in einem $derived aufrufen. */
export function loadBreakdown(): LoadBreakdown {
  const inputs = ENERGY_SENSORS.load.map((source) => ({
    label: source.label,
    value: kw(source.entityId),
    group: source.group,
  }));
  return computeLoadBreakdown(inputs);
}
