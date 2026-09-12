import { m } from '../../paraglide/messages.js';
import { fmtKw } from '../format.ts';
import { intlLocale } from './locale.svelte.ts';
import type { EnergyView } from './energy.svelte.ts';
import type { EnergyCurvePoint } from './energy-history.svelte.ts';
import type { LoadBreakdown } from './energy-load.ts';
import { energyPanelData, type EnergyMetric, type EnergyPanelData } from './energy-periods.ts';

/* ── Energie am Telefon (R37): eine Geschichte hinter den Zahlen ──
   Jetzt (Leistung, klein in Watt), dann der Zeitraum mit Verlauf und einer
   Einordnung, dann die größten Verbraucher. Alles aus denselben Projektionen
   wie das Panel; hier wird nur beschriftet und formatiert. */

export interface PhonePower {
  value: string;
  unit: 'W' | 'kW';
}

export interface PhoneEnergyMetric {
  label: string;
  value: string;
  unit: 'kW' | 'kWh';
}

export interface PhoneEnergyLine {
  label: string;
  power: PhonePower;
}

export interface PhoneEnergyConsumer {
  key: string;
  label: string;
  power: PhonePower;
  /** Anteil an der Gesamtlast, 0…1 — für den Balken. */
  share: number;
  sharePct: string;
}

export interface PhoneEnergyComparison {
  /** kWh bis zur gleichen Uhrzeit, aus den Fünf-Minuten-Mitteln beider Tage. */
  yesterday: string;
  /** Abweichung in Prozent, null wenn gestern zu klein für einen Vergleich. */
  deltaPct: number | null;
}

export interface PhoneEnergyModel {
  status: {
    kind: 'available' | 'unconfigured' | 'unavailable';
    text: string;
  };
  /** Der Hauptwert: Leistung jetzt. null, wenn nicht messbar. */
  now: PhoneEnergyLine | null;
  /** Solar, Netzbezug oder Einspeisung — nur was das Haus wirklich misst. */
  nowLines: PhoneEnergyLine[];
  lead: PhoneEnergyMetric | null;
  rest: PhoneEnergyMetric[];
  hint: string | null;
  comparison: PhoneEnergyComparison | null;
  consumers: PhoneEnergyConsumer[];
}

export interface PhoneEnergyOptions {
  curve?: EnergyCurvePoint[] | null;
  yesterday?: EnergyCurvePoint[] | null;
  /** Anteil des Tages 0…1, bis zu dem verglichen wird. */
  nowFraction?: number;
  /** Zahl der Lastquellen: mehrere Steckdosen sind „gemessene Geräte", keine Hauslast. */
  loadSourceCount?: number;
}

/* Kleine Leistungen in Watt: „200 W" liest sich, „0,2 kW" nicht. */
export function fmtPower(kw: number): PhonePower {
  if (Math.abs(kw) < 1) {
    return { value: Math.round(kw * 1000).toLocaleString(intlLocale()), unit: 'W' };
  }
  return { value: fmtKw(kw), unit: 'kW' };
}

function projectMetric(metric: EnergyMetric): PhoneEnergyMetric {
  return { label: metric.label, value: fmtKw(metric.value), unit: metric.unit };
}

/* kWh aus Fünf-Minuten-Mitteln bis zu einem Zeitpunkt des Tages. */
export function integrateLoad(curve: readonly EnergyCurvePoint[], untilT: number): number | null {
  let sum = 0;
  let seen = false;
  for (const point of curve) {
    if (point.t >= untilT || point.load === null) continue;
    sum += point.load / 12;
    seen = true;
  }
  return seen ? sum : null;
}

export function compareToYesterday(
  curve: readonly EnergyCurvePoint[] | null | undefined,
  yesterday: readonly EnergyCurvePoint[] | null | undefined,
  nowFraction: number,
): PhoneEnergyComparison | null {
  if (!curve || !yesterday) return null;
  const today = integrateLoad(curve, nowFraction);
  const before = integrateLoad(yesterday, nowFraction);
  if (today === null || before === null) return null;
  return {
    yesterday: fmtKw(before),
    deltaPct: before >= 0.05 ? Math.round(((today - before) / before) * 100) : null,
  };
}

export function projectPhoneEnergy(
  view: EnergyView,
  load: LoadBreakdown,
  panel: EnergyPanelData = energyPanelData(view, 'today', 'flow'),
  options: PhoneEnergyOptions = {},
): PhoneEnergyModel {
  const status = !view.configured
    ? { kind: 'unconfigured' as const, text: m.energy_no_sensors() }
    : view.pv === null && view.load === null
      ? { kind: 'unavailable' as const, text: m.phone_energy_sensors_unavailable() }
      : { kind: 'available' as const, text: '' };

  const sources = options.loadSourceCount ?? load.segments.length;
  const now: PhoneEnergyLine | null = view.load === null ? null : {
    label: sources > 1 ? m.phone_energy_devices_label() : m.phone_energy_now_label(),
    power: fmtPower(view.load),
  };
  const nowLines: PhoneEnergyLine[] = [];
  if (view.hasGeneration && view.pv !== null) nowLines.push({ label: m.energy_solar(), power: fmtPower(view.pv) });
  /* Netz nur, wenn es aus PV und Last folgt — ohne Erzeugung gibt es keine
     Netzaussage, und ein ausgeglichener Fluss ist keine Zeile wert. */
  if (view.grid !== null && view.grid < -0.05) nowLines.push({ label: m.energy_grid_import(), power: fmtPower(-view.grid) });
  else if (view.grid !== null && view.grid > 0.05) nowLines.push({ label: m.energy_feed_in(), power: fmtPower(view.grid) });

  const kpis = panel.kpis.map(projectMetric);

  return {
    status,
    now,
    nowLines,
    lead: kpis[0] ?? null,
    rest: kpis.slice(1),
    hint: panel.hint,
    comparison: compareToYesterday(options.curve, options.yesterday, options.nowFraction ?? 0),
    consumers: load.segments.map((segment) => ({
      key: segment.key,
      label: segment.label,
      power: fmtPower(segment.value),
      share: segment.fraction,
      sharePct: `${Math.round(segment.fraction * 100)} %`,
    })),
  };
}
