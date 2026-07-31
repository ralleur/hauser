// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import phoneEnergy from '../components/phone/PhoneEnergy.svelte?raw';
import phoneShell from '../shells/PhoneAppShell.svelte?raw';

import type { EnergyView } from './energy.svelte.ts';
import type { LoadBreakdown } from './energy-load.ts';
import { projectPhoneEnergy } from './phone-energy.ts';

const phoneShellCss = readFileSync(new URL('../../styles/phone-shell.css', import.meta.url), 'utf8');

const availableView: EnergyView = {
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

const breakdown: LoadBreakdown = {
  total: 1.8,
  segments: [
    { key: 'src:Wärmepumpe', label: 'Wärmepumpe', value: 1.2, fraction: 2 / 3, offset: 0 },
    { key: 'other', label: 'Sonstige', value: 0.6, fraction: 1 / 3, offset: 2 / 3 },
  ],
};

describe('phone energy projection', () => {
  it('projects today live values, textual grid direction, KPIs and real load segments', () => {
    const model = projectPhoneEnergy(availableView, breakdown);

    expect(model.status).toEqual({ kind: 'available', text: 'Aktuelle Energiewerte verfügbar.' });
    expect(model.live).toEqual([
      { label: 'Solar aktuell', value: '3,2', unit: 'kW' },
      { label: 'Erfasste Last', value: '1,8', unit: 'kW' },
      { label: 'Einspeisung', value: '1,4', unit: 'kW' },
    ]);
    expect(model.kpis).toEqual([
      { label: 'Erzeugt', value: '12,4', unit: 'kWh' },
      { label: 'Verbraucht', value: '9,1', unit: 'kWh' },
      { label: 'Eingespeist', value: '5,6', unit: 'kWh' },
      { label: 'Bezogen', value: '2,3', unit: 'kWh' },
    ]);
    expect(model.breakdown).toEqual([
      { key: 'src:Wärmepumpe', label: 'Wärmepumpe', value: '1,2', share: '67 %' },
      { key: 'other', label: 'Sonstige', value: '0,6', share: '33 %' },
    ]);
    expect(model.canExpand).toBe(true);
  });

  it('keeps unknown values as dashes and distinguishes unconfigured from unavailable', () => {
    const absentView: EnergyView = {
      configured: false,
      pv: null,
      load: null,
      grid: null,
      today: { produced: null, consumed: null, fedIn: null, drawn: null },
    };
    const unconfigured = projectPhoneEnergy(absentView, { total: 0, segments: [] });
    const unavailable = projectPhoneEnergy({ ...absentView, configured: true }, { total: 0, segments: [] });

    expect(unconfigured.status).toEqual({ kind: 'unconfigured', text: 'Keine Energie-Sensoren konfiguriert.' });
    expect(unavailable.status).toEqual({ kind: 'unavailable', text: 'Energie-Sensoren konfiguriert, aber aktuell nicht verfügbar.' });
    expect(unavailable.live.map((metric) => [metric.label, metric.value])).toEqual([
      ['Solar aktuell', '—'],
      ['Erfasste Last', '—'],
      ['Netzfluss', '—'],
    ]);
    expect(unavailable.kpis.every((metric) => metric.value === '—')).toBe(true);
    expect(unavailable.canExpand).toBe(false);
  });

  it.each([
    [1.4, 'Einspeisung'],
    [-1.5, 'Bezug'],
    [0, 'Netzfluss'],
    [null, 'Netzfluss'],
    [0.05, 'Netzfluss'],
    [-0.05, 'Netzfluss'],
    [0.01, 'Netzfluss'],
    [-0.01, 'Netzfluss'],
    [0.051, 'Einspeisung'],
    [-0.051, 'Bezug'],
  ] as const)('projects the current grid direction for %s as %s', (grid, direction) => {
    const model = projectPhoneEnergy({ ...availableView, grid }, breakdown);
    expect(model.gridDirection).toBe(direction);
  });

  it('labels negative grid flow as Bezug without relying on color', () => {
    const model = projectPhoneEnergy({ ...availableView, pv: 0.4, load: 1.9, grid: -1.5 }, breakdown);
    expect(model.live.at(-1)).toEqual({ label: 'Bezug', value: '1,5', unit: 'kW' });
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

  it('binds only the shared read-only energy projections and mirrors the panel toolbar', () => {
    expect(phoneEnergy).toMatch(/energyView\(\)/);
    expect(phoneEnergy).toMatch(/energyPanelData\(e,\s*period,\s*page\)/);
    expect(phoneEnergy).toMatch(/loadBreakdown\(\)/);
    expect(phoneEnergy).toContain('class="energy-panel-top phone-energy-toolbar"');
    expect(phoneEnergy).toContain('class="energy-period-row"');
    expect(phoneEnergy).toContain('class="energy-page-toggle pressable"');

    for (const forbidden of [
      'EnergyScreen', 'PanelAppShell', 'EnergyLoadOverlay', 'energy-hero-assets',
      'ENERGY_CURVE', 'hls.js', 'IconPicker', 'icon-recents', 'runtime', 'entity_id',
    ]) {
      expect(phoneEnergy).not.toContain(forbidden);
    }
  });

  it('provides one main and h1, dynamically renders the current text direction, semantic KPI groups and a real expand button', () => {
    expect((phoneEnergy.match(/<main\b/g) ?? [])).toHaveLength(1);
    expect((phoneEnergy.match(/<h1\b/g) ?? [])).toHaveLength(1);
    expect(phoneEnergy).toContain('Netzrichtung: {model.gridDirection}.');
    expect(phoneEnergy).not.toContain('Netzrichtung: Bezug, Einspeisung oder Netzfluss.');
    expect(phoneEnergy).toMatch(/<dl\b/);
    expect(phoneEnergy).toMatch(/<button[\s\S]*aria-expanded=\{expanded\}[\s\S]*aria-controls="phone-energy-breakdown"/);
    expect(phoneEnergy).toContain('disabled={!model.canExpand}');
  });

  it('owns a bounded vertical scrollport, prevents horizontal overflow and removes motion when requested', () => {
    expect(phoneShellCss).toMatch(/\.phone-energy\s*\{[^}]*height:\s*100%;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
    expect(phoneShellCss).toMatch(/\.phone-energy-drilldown\s*\{[^}]*min-height:\s*var\(--touch-min\);/s);
    expect(phoneShellCss).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.phone-energy-breakdown/s);
  });
});
