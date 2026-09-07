import type { EnergyView } from './energy.svelte.ts';

import { m } from '../../paraglide/messages.js';
export type EnergyPeriod = 'today' | 'week' | 'month' | 'total';
export type EnergyPage = 'flow' | 'consumption';

export interface EnergyPeriodOption {
  id: EnergyPeriod;
  label: string;
}

export const ENERGY_PERIODS: EnergyPeriodOption[] = [
  { id: 'today', label: m.period_today() },
  { id: 'week', label: m.period_last_week() },
  { id: 'month', label: m.period_last_month() },
  { id: 'total', label: m.period_total() },
];

/* Eine Kennzahl existiert nur mit Wert. Was das Haus nicht messen kann, wird
   nicht gezeigt — kein Gedankenstrich als Wert (R3, docs/23). */
export interface EnergyMetric {
  label: string;
  value: number;
  unit: 'kW' | 'kWh';
}

/* Zwischenstand beim Bauen: hier darf ein Wert noch fehlen. */
interface RawMetric {
  label: string;
  value: number | null;
  unit: 'kW' | 'kWh';
}

export interface EnergyPanelData {
  /** null, wenn der Leitwert gerade nicht messbar ist. */
  primary: EnergyMetric | null;
  secondary: EnergyMetric[];
  kpis: EnergyMetric[];
  hint: string | null;
}

interface RawPanelData {
  primary: RawMetric;
  secondary: RawMetric[];
  kpis: RawMetric[];
  hint: string | null;
}

function measured(metrics: RawMetric[]): EnergyMetric[] {
  return metrics.filter((metric): metric is EnergyMetric => metric.value !== null);
}

function measuredPanel(raw: RawPanelData): EnergyPanelData {
  return {
    primary: raw.primary.value === null ? null : (raw.primary as EnergyMetric),
    secondary: measured(raw.secondary),
    kpis: measured(raw.kpis),
    hint: raw.hint,
  };
}

const PERIOD_HINT: Record<Exclude<EnergyPeriod, 'today'>, string> = {
  week: m.period_missing_week(),
  month: m.period_missing_month(),
  total: m.period_missing_total(),
};

/** Summen eines Zeitraums aus der Statistik (R21); null = noch keine. */
export interface EnergyPeriodSums {
  produced: number | null;
  consumed: number | null;
  fedIn: number | null;
  drawn: number | null;
}

export function energyPanelData(
  view: EnergyView,
  period: EnergyPeriod,
  page: EnergyPage,
  sums: EnergyPeriodSums | null = null,
): EnergyPanelData {
  if (period !== 'today') {
    if (!sums) return historicalPlaceholder(period);
    /* Zeiträume kennen keine Live-Werte, nur Summen. Die Solarregel gilt
       wie heute: ohne Erzeugungssensor keine Solarzeile (R3). */
    const solar = view.hasGeneration;
    return measuredPanel({
      primary: { label: '', value: null, unit: 'kWh' },
      secondary: [],
      kpis: [
        ...(solar ? [{ label: m.energy_produced(), value: sums.produced, unit: 'kWh' as const }] : []),
        { label: m.energy_consumed(), value: sums.consumed, unit: 'kWh' },
        ...(solar ? [{ label: m.energy_fed_in(), value: sums.fedIn, unit: 'kWh' as const }] : []),
        { label: m.energy_drawn(), value: sums.drawn, unit: 'kWh' },
      ],
      hint: null,
    });
  }

  /* Ohne Erzeugungssensor hat das Haus keine Solarseite (Paket 3, docs/20):
     Kennzahlen, die es nur mit Erzeugung gibt, fallen ganz weg — ein Feld,
     das für immer „—" zeigt, sieht aus wie ein Defekt. */
  const solar = view.hasGeneration;

  if (page === 'consumption') {
    return measuredPanel({
      primary: { label: m.energy_measured_load(), value: view.load, unit: 'kW' },
      secondary: [
        { label: m.energy_grid_import(), value: view.grid !== null && view.grid < -0.05 ? Math.abs(view.grid) : null, unit: 'kW' },
        ...(solar
          ? [{ label: m.energy_pv_share(), value: view.pv !== null && view.load !== null ? Math.min(view.pv, view.load) : null, unit: 'kW' as const }]
          : []),
      ],
      kpis: [
        { label: m.energy_consumed(), value: view.today.consumed, unit: 'kWh' },
        { label: m.energy_drawn(), value: view.today.drawn, unit: 'kWh' },
        ...(solar
          ? [
              { label: m.energy_self_use(), value: ownUseToday(view), unit: 'kWh' as const },
              { label: m.energy_fed_in(), value: view.today.fedIn, unit: 'kWh' as const },
            ]
          : []),
      ],
      hint: liveValueHint(view, m.energy_no_load_sensors(), m.energy_load_sensors_no_value()),
    });
  }

  return measuredPanel({
    primary: solar
      ? { label: m.energy_solar_now(), value: view.pv, unit: 'kW' }
      : { label: m.energy_measured_load(), value: view.load, unit: 'kW' },
    secondary: [
      ...(solar ? [{ label: m.energy_measured_load(), value: view.load, unit: 'kW' as const }] : []),
      { label: gridLabel(view.grid), value: view.grid === null ? null : Math.abs(view.grid), unit: 'kW' },
    ],
    kpis: [
      ...(solar ? [{ label: m.energy_produced(), value: view.today.produced, unit: 'kWh' as const }] : []),
      { label: m.energy_consumed(), value: view.today.consumed, unit: 'kWh' },
      ...(solar ? [{ label: m.energy_fed_in(), value: view.today.fedIn, unit: 'kWh' as const }] : []),
      { label: m.energy_drawn(), value: view.today.drawn, unit: 'kWh' },
    ],
    hint: liveValueHint(view, m.energy_no_sensors(), m.energy_sensors_no_value()),
  });
}

/* Woche, Monat und Gesamt kommen erst mit der HA-Statistics-API. Bis dahin
   steht dort der Hinweissatz — und keine Reihe leerer Kennzahlen (R3). */
function historicalPlaceholder(period: Exclude<EnergyPeriod, 'today'>): EnergyPanelData {
  return { primary: null, secondary: [], kpis: [], hint: PERIOD_HINT[period] };
}

function liveValueHint(view: EnergyView, unconfigured: string, noValue: string): string | null {
  if (!view.configured) return unconfigured;
  if (view.pv === null && view.load === null) return noValue;
  return null;
}

function gridLabel(grid: number | null): string {
  if (grid !== null && grid > 0.05) return m.energy_feed_in();
  if (grid !== null && grid < -0.05) return m.energy_draw();
  return m.energy_grid_flow();
}

function ownUseToday(view: EnergyView): number | null {
  if (view.today.produced !== null && view.today.fedIn !== null) {
    return Math.max(0, view.today.produced - view.today.fedIn);
  }
  return null;
}
