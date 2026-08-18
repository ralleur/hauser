import { m } from '../../paraglide/messages.js';
import { fmtKw } from '../format.ts';
import type { EnergyView } from './energy.svelte.ts';
import type { LoadBreakdown } from './energy-load.ts';
import { energyPanelData, type EnergyMetric, type EnergyPanelData } from './energy-periods.ts';

export interface PhoneEnergyMetric {
  label: string;
  value: string;
  unit: 'kW' | 'kWh';
}

export interface PhoneEnergySegment {
  key: string;
  label: string;
  value: string;
  share: string;
}

export interface PhoneEnergyModel {
  status: {
    kind: 'available' | 'unconfigured' | 'unavailable';
    text: string;
  };
  live: PhoneEnergyMetric[];
  gridDirection: 'Bezug' | 'Einspeisung' | 'Netzfluss';
  kpis: PhoneEnergyMetric[];
  breakdown: PhoneEnergySegment[];
  canExpand: boolean;
}

function projectMetric(metric: EnergyMetric): PhoneEnergyMetric {
  return {
    label: metric.label,
    value: metric.value === null ? '—' : fmtKw(metric.value),
    unit: metric.unit,
  };
}

export function projectPhoneEnergy(
  view: EnergyView,
  load: LoadBreakdown,
  panel: EnergyPanelData = energyPanelData(view, 'today', 'flow'),
): PhoneEnergyModel {
  const status = !view.configured
    ? { kind: 'unconfigured' as const, text: m.energy_no_sensors() }
    : view.pv === null && view.load === null
      ? { kind: 'unavailable' as const, text: m.phone_energy_sensors_unavailable() }
      : { kind: 'available' as const, text: m.phone_energy_available() };

  return {
    status,
    live: [panel.primary, ...panel.secondary].map(projectMetric),
    gridDirection: view.grid !== null && view.grid > 0.05
      ? 'Einspeisung'
      : view.grid !== null && view.grid < -0.05
        ? 'Bezug'
        : 'Netzfluss',
    kpis: panel.kpis.map(projectMetric),
    breakdown: load.segments.map((segment) => ({
      key: segment.key,
      label: segment.label,
      value: fmtKw(segment.value),
      share: `${Math.round(segment.fraction * 100)} %`,
    })),
    canExpand: view.load !== null,
  };
}
