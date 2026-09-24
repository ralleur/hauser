import { describe, expect, it } from 'vitest';
import { balance, countersFromEnergyPrefs, curveFromBuckets, periodWindow } from './energy-history.svelte.ts';
import { hostileHome } from '../stresshaus/hostile-home.ts';

const DAY = 86_400_000;

describe('energy history (R21: real curves, no invented ones)', () => {
  it('sums five-minute means of all load sensors per slice and keeps gaps as gaps', () => {
    const dayStart = new Date(2026, 8, 7).getTime();
    const curve = curveFromBuckets({
      'sensor.a': [{ start: dayStart, end: dayStart + 300_000, mean: 400 }, { start: dayStart + 300_000, end: dayStart + 600_000, mean: 600 }],
      'sensor.b': [{ start: dayStart, end: dayStart + 300_000, mean: 100 }],
      'sensor.pv': [{ start: dayStart + 300_000, end: dayStart + 600_000, mean: 2000 }],
    }, ['sensor.a', 'sensor.b'], ['sensor.pv'], dayStart, (_id, value) => value / 1000);
    expect(curve).toEqual([
      { t: 0, load: 0.5, prod: null },
      { t: 0.003, load: 0.6, prod: 2 },
    ]);
  });

  it('ignores slices outside the day and slices without a mean', () => {
    const dayStart = new Date(2026, 8, 7).getTime();
    const curve = curveFromBuckets({
      'sensor.a': [{ start: dayStart - DAY, end: dayStart, mean: 5 }, { start: dayStart, end: dayStart + 300_000, mean: null }],
    }, ['sensor.a'], [], dayStart, (_id, value) => value);
    expect(curve).toEqual([]);
  });

  it('frames last week as the previous Monday-to-Monday and last month as the previous calendar month', () => {
    const now = new Date(2026, 8, 7, 15, 0); // Montag, 7. September 2026
    const week = periodWindow('week', now);
    expect(week.start).toEqual(new Date(2026, 7, 31));
    expect(week.end).toEqual(new Date(2026, 8, 7));
    const month = periodWindow('month', now);
    expect(month.start).toEqual(new Date(2026, 7, 1));
    expect(month.end).toEqual(new Date(2026, 8, 1));
    expect(periodWindow('total', now).start.getFullYear()).toBe(2000);
  });

  it('takes the meters for week, month and total from the Home Assistant energy dashboard, even a crooked one', () => {
    const counters = countersFromEnergyPrefs(hostileHome().energyPrefs);
    expect(counters).toEqual({
      produced: ['sensor.pv_ertrag'],
      drawn: ['sensor.netz_bezug_wh'],
      fedIn: ['sensor.netz_einspeisung', 'sensor.alter_zaehler'],
      batteryOut: ['sensor.akku_abgabe'],
      batteryIn: ['sensor.akku_ladung'],
    });
    for (const broken of [null, undefined, 'x', {}, { energy_sources: 'x' }, { energy_sources: [null, 7] }]) {
      expect(countersFromEnergyPrefs(broken)).toEqual({ produced: [], drawn: [], fedIn: [], batteryOut: [], batteryIn: [] });
    }
  });

  it('balances house consumption like the dashboard and stays open when a known meter has no value', () => {
    const counters = { drawn: ['g'], produced: ['pv'], fedIn: ['out'], batteryOut: ['bo'], batteryIn: ['bi'] };
    expect(balance(counters, { drawn: 100, produced: 50, fedIn: 30, batteryOut: 10, batteryIn: 12 })).toBe(118);
    expect(balance(counters, { drawn: 100, produced: null, fedIn: 30, batteryOut: 10, batteryIn: 12 })).toBeNull();
    expect(balance({ ...counters, produced: [], batteryOut: [], batteryIn: [] }, { drawn: 100, produced: null, fedIn: 30, batteryOut: null, batteryIn: null })).toBe(70);
    expect(balance(counters, { drawn: null, produced: 50, fedIn: 30, batteryOut: 10, batteryIn: 12 })).toBeNull();
  });
});
