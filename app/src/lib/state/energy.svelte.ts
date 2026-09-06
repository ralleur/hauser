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
import { createSnapshotStore } from '../data/query-cache.ts';
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
  /** true, sobald es überhaupt einen Erzeugungssensor gibt. Ohne ihn hat das
      Haus keine Solarseite — dann bleiben Solar-Knoten und -KPIs weg, statt
      dauerhaft „—" anzuzeigen (Paket 3, docs/20). */
  hasGeneration: boolean;
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

/* ── Snapshot der Kurven (Paket 5, docs/20) ──
   Die Werte hängen an den HA-Entitäten; nach einem Reload stehen sie erst da,
   wenn die Verbindung steht. Bis dahin füllt der letzte Stand die Lücken —
   Feld für Feld, damit ein echter Wert nie von einem alten verdeckt wird.
   Konfiguration (`configured`, `hasGeneration`) kommt immer aus der laufenden
   Sitzung, nie aus dem Snapshot. */
const ENERGY_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
const ENERGY_SAVE_INTERVAL_MS = 30 * 1000;

interface EnergyReadings {
  pv: number | null;
  load: number | null;
  grid: number | null;
  today: EnergyView['today'];
}

const energySnapshot = createSnapshotStore<EnergyReadings>({
  key: 'hmi:energy-readings',
  maxAgeMs: ENERGY_SNAPSHOT_MAX_AGE_MS,
  validate: (value): value is EnergyReadings => {
    const candidate = value as Partial<EnergyReadings> | null;
    return !!candidate && typeof candidate === 'object' && !!candidate.today;
  },
});

let restoredReadings: EnergyReadings | null = energySnapshot.restoreSync()?.value ?? null;
let lastSavedAt = 0;

function anyValue(readings: EnergyReadings): boolean {
  return readings.pv !== null || readings.load !== null
    || Object.values(readings.today).some((value) => value !== null);
}

function rememberReadings(readings: EnergyReadings, now = Date.now()): void {
  restoredReadings = readings;
  if (now - lastSavedAt < ENERGY_SAVE_INTERVAL_MS) return;
  lastSavedAt = now;
  void energySnapshot.save(readings, now);
}

function fillFromSnapshot(readings: EnergyReadings): EnergyReadings {
  const previous = restoredReadings;
  if (!previous) return readings;
  return {
    pv: readings.pv ?? previous.pv,
    load: readings.load ?? previous.load,
    grid: readings.grid ?? previous.grid,
    today: {
      produced: readings.today.produced ?? previous.today.produced,
      consumed: readings.today.consumed ?? previous.today.consumed,
      fedIn: readings.today.fedIn ?? previous.today.fedIn,
      drawn: readings.today.drawn ?? previous.today.drawn,
    },
  };
}

export function energyView(): EnergyView {
  const pv = sumRefs(ENERGY_SENSORS.pv, kw);
  const load = sumRefs(ENERGY_SENSORS.load, kw);
  // Netz-Fluss aus (PV − Last): >0 Überschuss/Einspeisung, <0 Bezug. Nur wenn
  // beide Werte echte Sensoren haben; sonst bleibt Netz unbekannt statt geraten.
  const grid = pv !== null && load !== null ? pv - load : null;
  const hasConfig = configured(ENERGY_SENSORS.pv) || configured(ENERGY_SENSORS.load);
  const hasGeneration = [
    ENERGY_SENSORS.pv, ENERGY_SENSORS.producedToday, ENERGY_SENSORS.fedInToday,
  ].some(configured);
  const readings: EnergyReadings = {
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
  if (hasConfig && anyValue(readings)) rememberReadings(readings);
  return {
    configured: hasConfig,
    hasGeneration,
    ...(hasConfig ? fillFromSnapshot(readings) : readings),
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
