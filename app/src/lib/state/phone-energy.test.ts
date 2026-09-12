// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import phoneEnergy from '../components/phone/PhoneEnergy.svelte?raw';
import phoneShell from '../shells/PhoneAppShell.svelte?raw';

import type { EnergyView } from './energy.svelte.ts';
import type { EnergyCurvePoint } from './energy-history.svelte.ts';
import type { LoadBreakdown } from './energy-load.ts';
import { compareToYesterday, fmtPower, integrateLoad, projectPhoneEnergy } from './phone-energy.ts';

const phoneShellCss = readFileSync(new URL('../../styles/phone-shell.css', import.meta.url), 'utf8');

const availableView: EnergyView = {
  configured: true,
  hasGeneration: true,
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

const breakdown: LoadBreakdown = {
  total: 1.8,
  segments: [
    { key: 'src:Wärmepumpe', label: 'Wärmepumpe', value: 1.2, fraction: 2 / 3, offset: 0 },
    { key: 'other', label: 'Sonstige', value: 0.6, fraction: 1 / 3, offset: 2 / 3 },
  ],
};

describe('phone energy projection (R37: a story behind the numbers)', () => {
  it('leads with the power now, lists solar and grid as lines, and splits the period into lead and rest', () => {
    const model = projectPhoneEnergy(availableView, breakdown, undefined, { loadSourceCount: 1 });

    expect(model.status.kind).toBe('available');
    expect(model.now).toEqual({ label: 'Verbrauch jetzt', power: { value: '1,8', unit: 'kW' } });
    expect(model.nowLines).toEqual([
      { label: 'Solar', power: { value: '3,2', unit: 'kW' } },
      { label: 'Einspeisung', power: { value: '1,4', unit: 'kW' } },
    ]);
    expect(model.lead).toEqual({ label: 'Erzeugt', value: '12,4', unit: 'kWh' });
    expect(model.rest).toEqual([
      { label: 'Verbraucht', value: '9,1', unit: 'kWh' },
      { label: 'Eingespeist', value: '5,6', unit: 'kWh' },
      { label: 'Bezogen', value: '2,3', unit: 'kWh' },
    ]);
    expect(model.consumers).toEqual([
      { key: 'src:Wärmepumpe', label: 'Wärmepumpe', power: { value: '1,2', unit: 'kW' }, share: 2 / 3, sharePct: '67 %' },
      { key: 'other', label: 'Sonstige', power: { value: '600', unit: 'W' }, share: 1 / 3, sharePct: '33 %' },
    ]);
    expect(model.comparison).toBeNull();
  });

  it('calls several plugs measured devices, not the house load, and reads small power in watts', () => {
    const model = projectPhoneEnergy({ ...availableView, hasGeneration: false, pv: null, grid: null, load: 0.2 }, breakdown, undefined, { loadSourceCount: 3 });
    expect(model.now).toEqual({ label: 'Gemessene Geräte', power: { value: '200', unit: 'W' } });
    // Ohne Erzeugung gibt es keine Netzaussage — und keinen „Netzfluss"-Satz.
    expect(model.nowLines).toEqual([]);
    expect(fmtPower(0.05)).toEqual({ value: '50', unit: 'W' });
    expect(fmtPower(1)).toEqual({ value: '1,0', unit: 'kW' });
  });

  it('names grid draw with its power and stays silent when the flow is balanced', () => {
    expect(projectPhoneEnergy({ ...availableView, pv: 0.4, load: 1.9, grid: -1.5 }, breakdown).nowLines)
      .toContainEqual({ label: 'Netzbezug', power: { value: '1,5', unit: 'kW' } });
    expect(projectPhoneEnergy({ ...availableView, grid: 0.02 }, breakdown).nowLines.map((line) => line.label))
      .toEqual(['Solar']);
  });

  it('distinguishes unconfigured from unavailable and shows nothing invented', () => {
    const absentView: EnergyView = {
      configured: false,
      hasGeneration: true,
      pv: null,
      load: null,
      grid: null,
      today: { produced: null, consumed: null, fedIn: null, drawn: null },
    };
    const unconfigured = projectPhoneEnergy(absentView, { total: 0, segments: [] });
    const unavailable = projectPhoneEnergy({ ...absentView, configured: true }, { total: 0, segments: [] });

    expect(unconfigured.status).toEqual({ kind: 'unconfigured', text: 'Keine Energie-Sensoren konfiguriert.' });
    expect(unavailable.status).toEqual({ kind: 'unavailable', text: 'Energie-Sensoren konfiguriert, aber aktuell nicht verfügbar.' });
    expect(unavailable.now).toBeNull();
    expect(unavailable.nowLines).toEqual([]);
    expect(unavailable.lead).toBeNull();
    expect(unavailable.consumers).toEqual([]);
  });

  it('compares today with yesterday up to the same time of day, from the same five-minute means', () => {
    const flat = (load: number): EnergyCurvePoint[] =>
      Array.from({ length: 288 }, (_, i) => ({ t: i / 288, load, prod: null }));
    // 12 Scheiben je Stunde: bis 06:00 sind es 72 Scheiben à 1/12 h.
    expect(integrateLoad(flat(1), 0.25)).toBeCloseTo(6, 5);
    expect(compareToYesterday(flat(0.9), flat(1), 0.25)).toEqual({ yesterday: '6,0', deltaPct: -10 });
    // Kurz nach Mitternacht ist gestern noch zu klein für einen Prozentwert.
    expect(compareToYesterday(flat(1), flat(0.1), 1 / 288)).toEqual({ yesterday: '0,0', deltaPct: null });
    expect(compareToYesterday(flat(1), null, 0.5)).toBeNull();
    expect(compareToYesterday(null, flat(1), 0.5)).toBeNull();
  });
});

describe('phone energy shell, source and accessibility boundaries', () => {
  it('mounts PhoneEnergy only at the canonical more/energy target and preserves sibling branches and fallback', () => {
    expect(phoneShell).toContain("energy: () => import('../components/phone/PhoneEnergy.svelte')");
    expect(phoneShell).not.toMatch(/^\s*import PhoneEnergy/m);
    expect(phoneShell).toContain("shopping: () => import('../components/phone/PhoneShopping.svelte')");
    expect(phoneShell).toContain("reminders: () => import('../components/phone/PhoneReminders.svelte')");
    expect(phoneShell).toMatch(/target\.area !== 'more'[\s\S]*return target\.subtarget/);
    expect(phoneShell).toMatch(/activePhoneScreenId[\s\S]*<PhoneScreenComponent/);
    expect(phoneShell).toContain('m.phone_view_preparing()');
  });

  it('binds only the shared read-only energy projections and keeps the period with the history, not the live value', () => {
    expect(phoneEnergy).toMatch(/energyView\(\)/);
    expect(phoneEnergy).toMatch(/energyPanelData\(e,\s*period,\s*'flow',\s*sums\)/);
    expect(phoneEnergy).toMatch(/loadBreakdown\(\)/);
    expect(phoneEnergy).toMatch(/initEnergyHistory\(\)/);
    // Der Zeitraum steht unter „Jetzt", nicht darüber: die Auswahl gehört zur Auswertung.
    expect(phoneEnergy.indexOf('class="phone-energy-now"')).toBeLessThan(phoneEnergy.indexOf('class="phone-energy-periods"'));
    expect(phoneEnergy).toMatch(/role="radiogroup"/);
    // Kein Seitenwechsel mehr, kein „Netzrichtung"-Satz, kein Statussatz bei gesunden Daten.
    expect(phoneEnergy).not.toContain('phone-energy-mode');
    expect(phoneEnergy).not.toContain('Netzrichtung');
    expect(phoneEnergy).not.toContain('phone_energy_available');

    for (const forbidden of [
      'EnergyScreen', 'PanelAppShell', 'EnergyLoadOverlay', 'energy-hero-assets',
      'ENERGY_CURVE', 'hls.js', 'IconPicker', 'icon-recents', 'runtime', 'entity_id',
    ]) {
      expect(phoneEnergy).not.toContain(forbidden);
    }
  });

  it('provides one main and h1, a labelled curve only with data, and a real expand button for all consumers', () => {
    expect((phoneEnergy.match(/<main\b/g) ?? [])).toHaveLength(1);
    expect((phoneEnergy.match(/<h1\b/g) ?? [])).toHaveLength(1);
    expect(phoneEnergy).toMatch(/\{#if period === 'today' && loadArea\}[\s\S]*<figure class="phone-energy-curve" aria-label=\{m\.energy_today\(\)\}/);
    expect(phoneEnergy).toMatch(/<dl class="phone-energy-kpis"/);
    expect(phoneEnergy).toMatch(/<button class="phone-energy-more pressable"[\s\S]*aria-expanded=\{showAll\}/);
  });

  it('owns a bounded vertical scrollport, prevents horizontal overflow and keeps the period row on one line', () => {
    expect(phoneShellCss).toMatch(/\.phone-energy\s*\{[^}]*height:\s*100%;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
    expect(phoneShellCss).toMatch(/\.phone-energy-periods\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
    expect(phoneShellCss).toMatch(/\.phone-energy-period\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(phoneShellCss).not.toContain('.phone-energy-breakdown');
  });
});
