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

export interface EnergyMetric {
  label: string;
  value: number | null;
  unit: 'kW' | 'kWh';
}

export interface EnergyPanelData {
  primary: EnergyMetric;
  secondary: EnergyMetric[];
  kpis: EnergyMetric[];
  hint: string | null;
}

const PERIOD_HINT: Record<Exclude<EnergyPeriod, 'today'>, string> = {
  week: m.period_missing_week(),
  month: m.period_missing_month(),
  total: m.period_missing_total(),
};

export function energyPanelData(view: EnergyView, period: EnergyPeriod, page: EnergyPage): EnergyPanelData {
  if (period !== 'today') {
    return historicalPlaceholder(period, page);
  }

  if (page === 'consumption') {
    return {
      primary: { label: m.energy_measured_load(), value: view.load, unit: 'kW' },
      secondary: [
        { label: m.energy_grid_import(), value: view.grid !== null && view.grid < -0.05 ? Math.abs(view.grid) : null, unit: 'kW' },
        { label: m.energy_pv_share(), value: view.pv !== null && view.load !== null ? Math.min(view.pv, view.load) : null, unit: 'kW' },
      ],
      kpis: [
        { label: m.energy_consumed(), value: view.today.consumed, unit: 'kWh' },
        { label: m.energy_drawn(), value: view.today.drawn, unit: 'kWh' },
        { label: m.energy_self_use(), value: ownUseToday(view), unit: 'kWh' },
        { label: m.energy_fed_in(), value: view.today.fedIn, unit: 'kWh' },
      ],
      hint: liveValueHint(view, m.energy_no_load_sensors(), m.energy_load_sensors_no_value()),
    };
  }

  return {
    primary: { label: m.energy_solar_now(), value: view.pv, unit: 'kW' },
    secondary: [
      { label: m.energy_measured_load(), value: view.load, unit: 'kW' },
      { label: gridLabel(view.grid), value: view.grid === null ? null : Math.abs(view.grid), unit: 'kW' },
    ],
    kpis: [
      { label: m.energy_produced(), value: view.today.produced, unit: 'kWh' },
      { label: m.energy_consumed(), value: view.today.consumed, unit: 'kWh' },
      { label: m.energy_fed_in(), value: view.today.fedIn, unit: 'kWh' },
      { label: m.energy_drawn(), value: view.today.drawn, unit: 'kWh' },
    ],
    hint: liveValueHint(view, m.energy_no_sensors(), m.energy_sensors_no_value()),
  };
}

function historicalPlaceholder(period: Exclude<EnergyPeriod, 'today'>, page: EnergyPage): EnergyPanelData {
  return {
    primary: { label: page === 'consumption' ? 'Verbrauch' : m.energy_title(), value: null, unit: 'kWh' },
    secondary: [
      { label: page === 'consumption' ? m.energy_grid_import() : 'Erzeugung', value: null, unit: 'kWh' },
      { label: page === 'consumption' ? m.energy_self_use() : m.energy_feed_in(), value: null, unit: 'kWh' },
    ],
    kpis: page === 'consumption'
      ? [
          { label: m.energy_consumed(), value: null, unit: 'kWh' },
          { label: m.energy_drawn(), value: null, unit: 'kWh' },
          { label: m.energy_self_use(), value: null, unit: 'kWh' },
          { label: m.energy_peak_load(), value: null, unit: 'kW' },
        ]
      : [
          { label: m.energy_produced(), value: null, unit: 'kWh' },
          { label: m.energy_consumed(), value: null, unit: 'kWh' },
          { label: m.energy_fed_in(), value: null, unit: 'kWh' },
          { label: m.energy_drawn(), value: null, unit: 'kWh' },
        ],
    hint: PERIOD_HINT[period],
  };
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
