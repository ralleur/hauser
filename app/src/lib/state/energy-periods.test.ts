import { describe, expect, it } from 'vitest';
import { energyPanelData, type EnergyPage, type EnergyPeriod } from './energy-periods.ts';
import type { EnergyView } from './energy.svelte.ts';

const baseView: EnergyView = {
  configured: true,
  pv: 3.2,
  load: 1.8,
  grid: 1.4,
  today: {
    produced: 12.4,
    consumed: 9.1,
    fedIn: 5.6,
    drawn: 2.3,
  },
};

describe('energy period panel data', () => {
  it('maps today flow data from the live energy view', () => {
    const data = energyPanelData(baseView, 'today', 'flow');

    expect(data.primary).toEqual({ label: 'Solar aktuell', value: 3.2, unit: 'kW' });
    expect(data.secondary).toEqual([
      { label: 'Erfasste Last', value: 1.8, unit: 'kW' },
      { label: 'Einspeisung', value: 1.4, unit: 'kW' },
    ]);
    expect(data.kpis.map((k) => [k.label, k.value])).toEqual([
      ['Erzeugt', 12.4],
      ['Verbraucht', 9.1],
      ['Eingespeist', 5.6],
      ['Bezogen', 2.3],
    ]);
  });

  it('maps today consumption page without inventing unavailable values', () => {
    const data = energyPanelData(baseView, 'today', 'consumption');

    expect(data.primary).toEqual({ label: 'Erfasste Last', value: 1.8, unit: 'kW' });
    expect(data.secondary).toEqual([
      { label: 'Netzbezug', value: null, unit: 'kW' },
      { label: 'PV-Anteil', value: 1.8, unit: 'kW' },
    ]);
    expect(data.kpis.map((k) => [k.label, k.value])).toEqual([
      ['Verbraucht', 9.1],
      ['Bezogen', 2.3],
      ['Eigenverbrauch', 6.800000000000001],
      ['Eingespeist', 5.6],
    ]);
  });

  it('keeps configured-but-unavailable live sensors graceful', () => {
    const data = energyPanelData({
      ...baseView,
      pv: null,
      load: null,
    }, 'today', 'flow');

    expect(data.hint).toBe('Energie-Sensoren konfiguriert, aber noch ohne aktuellen Wert.');
  });

  it.each<[EnergyPeriod, EnergyPage, string]>([
    ['week', 'flow', 'Für letzte Woche fehlen noch Energy-Statistics-Daten.'],
    ['month', 'consumption', 'Für letzten Monat fehlen noch Energy-Statistics-Daten.'],
    ['total', 'flow', 'Für Gesamtwerte fehlen noch Energy-Statistics-Daten.'],
  ])('uses graceful absence for %s/%s until aggregate statistics exist', (period, page, hint) => {
    const data = energyPanelData(baseView, period, page);

    expect(data.primary.value).toBeNull();
    expect(data.secondary.every((m) => m.value === null)).toBe(true);
    expect(data.kpis.every((m) => m.value === null)).toBe(true);
    expect(data.hint).toBe(hint);
  });
});
