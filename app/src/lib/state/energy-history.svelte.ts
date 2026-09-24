/* ── Wahre Kurven (R21, docs/23) ──
   Der Tagesverlauf und die Summen für Woche, Monat und Gesamt kommen aus der
   Langzeitstatistik von Home Assistant, nicht aus einer festen Liste. Ohne
   Statistik gibt es keine Linie und keine Zahl — lieber nichts als erfunden.
   Der Simulator ersetzt beides durch Formen aus seinen Reglern, erkennbar
   gewollt: eine Glocke für die Erzeugung, ein Plateau für die Last. */
import { runtime } from '../adapter/runtime.svelte.ts';
import type { StatisticsBucket, StatisticsResult } from '../adapter/types.ts';
import { ENERGY_SENSORS, energyRefIds, type EnergySensorRef, type LoadSource } from './app.svelte.ts';
import { simulation } from './simulation.svelte.ts';
import { registerRevalidation } from '../data/revalidation.ts';
import type { EnergyPeriod } from './energy-periods.ts';

export interface EnergyCurvePoint {
  /** Anteil des Tages 0…1 (Beginn der Fünf-Minuten-Scheibe). */
  t: number;
  load: number | null;
  prod: number | null;
}

export interface EnergyPeriodTotals {
  produced: number | null;
  consumed: number | null;
  fedIn: number | null;
  drawn: number | null;
}

type HistoryPeriod = Exclude<EnergyPeriod, 'today'>;

const REFRESH_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;

export const energyHistory = $state({
  curve: null as EnergyCurvePoint[] | null,
  /* Gestern in derselben Auflösung: der Vergleich „bis zur gleichen Uhrzeit"
     am Telefon braucht beide Tage aus derselben Quelle. */
  yesterday: null as EnergyCurvePoint[] | null,
  periods: { week: null, month: null, total: null } as Record<HistoryPeriod, EnergyPeriodTotals | null>,
  /* Heute aus den Dashboard-Zählern (Tagesbilanz), wenn Hauser selbst keine
     Tageszähler kennt. */
  today: null as EnergyPeriodTotals | null,
  updatedAt: 0,
  loading: false,
  initialized: false,
});

/* ── Zeitfenster ── */
export function periodWindow(period: HistoryPeriod, now = new Date()): { start: Date; end: Date } {
  if (period === 'week') {
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const start = new Date(monday);
    start.setDate(monday.getDate() - 7);
    return { start, end: monday };
  }
  if (period === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: first };
  }
  return { start: new Date(2000, 0, 1), end: now };
}

/* ── Einheiten ── */
function unitOf(entityId: string): string | null {
  const value = runtime.merged(entityId) as { unit?: string | null } | undefined;
  return value?.unit ?? null;
}
function toKw(entityId: string, value: number): number {
  return unitOf(entityId) === 'W' ? value / 1000 : value;
}

function ids(ref: EnergySensorRef | readonly LoadSource[]): string[] {
  return energyRefIds(ref);
}

/* ── Zähler aus dem Energie-Dashboard ──
   Die Einrichtung trägt keine kWh-Zähler ein: „Gesamt" blieb deshalb in jedem
   Haus leer, Woche und Monat waren aus der Leistung hochgerechnet. Home
   Assistant kennt die Zähler aber aus seinem Energie-Dashboard — Netzbezug,
   Einspeisung, Solar, Akku. Ein in Hauser eingetragener Zähler geht vor. */
export interface DashboardCounters {
  produced: string[];
  drawn: string[];
  fedIn: string[];
  /** Akku gibt ab (`stat_energy_from`) bzw. nimmt auf (`stat_energy_to`). */
  batteryOut: string[];
  batteryIn: string[];
}

export function countersFromEnergyPrefs(prefs: unknown): DashboardCounters {
  const found = { produced: new Set<string>(), drawn: new Set<string>(), fedIn: new Set<string>(), batteryOut: new Set<string>(), batteryIn: new Set<string>() };
  const add = (set: Set<string>, value: unknown) => {
    if (typeof value === 'string' && value.trim()) set.add(value.trim());
  };
  const list = (value: unknown): Record<string, unknown>[] =>
    (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  for (const source of list((prefs as { energy_sources?: unknown } | null)?.energy_sources)) {
    if (source.type === 'grid') {
      for (const flow of list(source.flow_from)) add(found.drawn, flow.stat_energy_from);
      for (const flow of list(source.flow_to)) add(found.fedIn, flow.stat_energy_to);
      add(found.drawn, source.stat_energy_from);
      add(found.fedIn, source.stat_energy_to);
    } else if (source.type === 'solar') {
      add(found.produced, source.stat_energy_from);
    } else if (source.type === 'battery') {
      add(found.batteryOut, source.stat_energy_from);
      add(found.batteryIn, source.stat_energy_to);
    }
  }
  return {
    produced: [...found.produced], drawn: [...found.drawn], fedIn: [...found.fedIn],
    batteryOut: [...found.batteryOut], batteryIn: [...found.batteryIn],
  };
}

/* ── Tagesverlauf aus Fünf-Minuten-Mitteln ── */
export function curveFromBuckets(
  buckets: Record<string, StatisticsBucket[]>,
  loadIds: readonly string[],
  prodIds: readonly string[],
  dayStart: number,
  kw: (id: string, value: number) => number,
): EnergyCurvePoint[] {
  const points = new Map<number, EnergyCurvePoint>();
  const add = (id: string, field: 'load' | 'prod') => {
    for (const bucket of buckets[id] ?? []) {
      if (bucket.mean === null || bucket.mean === undefined) continue;
      const t = Math.round(((bucket.start - dayStart) / DAY_MS) * 1000) / 1000;
      if (t < 0 || t > 1) continue;
      const point = points.get(t) ?? { t, load: null, prod: null };
      point[field] = (point[field] ?? 0) + kw(id, bucket.mean);
      points.set(t, point);
    }
  };
  for (const id of loadIds) add(id, 'load');
  for (const id of prodIds) add(id, 'prod');
  return [...points.values()].sort((a, b) => a.t - b.t);
}

/* ── Summen eines Zeitraums ──
   Zähler (kWh) zählen ihre Tageszuwächse; ohne Zähler wird die Leistung
   über die Stundenmittel integriert (kW · h). */
function sumChanges(buckets: StatisticsBucket[] | undefined): number | null {
  if (!buckets?.length) return null;
  let sum = 0; let seen = false;
  for (const bucket of buckets) {
    if (bucket.change === null || bucket.change === undefined) continue;
    sum += bucket.change; seen = true;
  }
  return seen ? Math.round(sum * 10) / 10 : null;
}
function integrateMeans(buckets: Record<string, StatisticsBucket[]>, sensorIds: readonly string[]): number | null {
  let sum = 0; let seen = false;
  for (const id of sensorIds) {
    for (const bucket of buckets[id] ?? []) {
      if (bucket.mean === null || bucket.mean === undefined) continue;
      sum += toKw(id, bucket.mean) * ((bucket.end - bucket.start) / 3_600_000); seen = true;
    }
  }
  return seen ? Math.round(sum * 10) / 10 : null;
}

async function loadPeriod(period: HistoryPeriod, dashboard: DashboardCounters): Promise<EnergyPeriodTotals | null> {
  const { start, end } = periodWindow(period);
  const own = (ref: EnergySensorRef, fallback: string[]) => (ids(ref).length ? ids(ref) : fallback);
  const counters = {
    produced: own(ENERGY_SENSORS.producedToday, dashboard.produced),
    consumed: ids(ENERGY_SENSORS.consumedToday),
    fedIn: own(ENERGY_SENSORS.fedInToday, dashboard.fedIn),
    drawn: own(ENERGY_SENSORS.drawnToday, dashboard.drawn),
    batteryOut: dashboard.batteryOut,
    batteryIn: dashboard.batteryIn,
  };
  const counterIds = [...new Set(Object.values(counters).flat())];
  const powerIds = { load: ids(ENERGY_SENSORS.load), prod: ids(ENERGY_SENSORS.pv) };
  /* Verbrauch zählt ein eigener Zähler — oder die Bilanz wie im Dashboard. */
  const consumptionCounted = counters.consumed.length > 0 || counters.drawn.length > 0;
  const [changes, means] = await Promise.all([
    counterIds.length
      ? runtime.getStatistics({ statisticIds: counterIds, start, end, period: 'day', types: ['change'], units: { energy: 'kWh' } })
      : Promise.resolve<StatisticsResult>({}),
    /* Gesamt über Stundenmittel wäre eine Anfrage über Jahre: nur Zähler. */
    period !== 'total' && (!consumptionCounted || !counters.produced.length)
      ? runtime.getStatistics({ statisticIds: [...powerIds.load, ...powerIds.prod], start, end, period: 'hour', types: ['mean'] })
      : Promise.resolve<StatisticsResult>({}),
  ]);
  const counterTotal = (key: keyof typeof counters): number | null => {
    const values = counters[key].map((id) => sumChanges(changes[id])).filter((value): value is number => value !== null);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  };
  const produced = counterTotal('produced');
  const fedIn = counterTotal('fedIn');
  const drawn = counterTotal('drawn');
  const totals: EnergyPeriodTotals = {
    produced: produced ?? (powerIds.prod.length ? integrateMeans(means, powerIds.prod) : null),
    consumed: counterTotal('consumed') ?? balance(counters, { produced, fedIn, drawn, batteryOut: counterTotal('batteryOut'), batteryIn: counterTotal('batteryIn') })
      ?? (powerIds.load.length ? integrateMeans(means, powerIds.load) : null),
    fedIn,
    drawn,
  };
  return Object.values(totals).some((value) => value !== null) ? totals : null;
}

/* Hausverbrauch wie im Energie-Dashboard: Bezug + Solar + Akku-Abgabe
   − Einspeisung − Akku-Aufnahme. Fehlt ein Wert, dessen Zähler es gibt, bleibt
   die Bilanz offen, statt zu klein zu werden. */
export function balance(
  counters: { drawn: string[]; produced: string[]; fedIn: string[]; batteryOut: string[]; batteryIn: string[] },
  sums: { drawn: number | null; produced: number | null; fedIn: number | null; batteryOut: number | null; batteryIn: number | null },
): number | null {
  if (sums.drawn === null) return null;
  let total = 0;
  for (const [key, sign] of [['drawn', 1], ['produced', 1], ['batteryOut', 1], ['fedIn', -1], ['batteryIn', -1]] as const) {
    if (!counters[key].length) continue;
    const value = sums[key];
    if (value === null) return null;
    total += sign * value;
  }
  return Math.round(Math.max(0, total) * 10) / 10;
}

/* Heute seit Mitternacht in Fünf-Minuten-Scheiben, damit der Stand nicht eine
   Stunde hinterherläuft. Nur Zähler des Dashboards — eingetragene Tageszähler
   liest die Energie-Seite ohnehin live, und „Verbraucht" bleibt leer, weil
   ihn dort kein Zähler misst. */
async function loadToday(dashboard: DashboardCounters): Promise<EnergyPeriodTotals | null> {
  const counters = { produced: dashboard.produced, fedIn: dashboard.fedIn, drawn: dashboard.drawn };
  const statisticIds = [...new Set(Object.values(counters).flat())];
  if (!statisticIds.length) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const changes = await runtime.getStatistics({ statisticIds, start, period: '5minute', types: ['change'], units: { energy: 'kWh' } });
  const total = (list: string[]): number | null => {
    const values = list.map((id) => sumChanges(changes[id])).filter((value): value is number => value !== null);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  };
  const totals = { produced: total(counters.produced), consumed: null, fedIn: total(counters.fedIn), drawn: total(counters.drawn) };
  return Object.values(totals).some((value) => value !== null) ? totals : null;
}

/** Tageswerte für die Bilanz: eingetragene Tageszähler live, sonst die Dashboard-Zähler seit Mitternacht. */
export function energyTodayInput(today: { produced: number | null; consumed: number | null; fedIn: number | null; drawn: number | null }) {
  const counted = energyHistory.today;
  return {
    produced: today.produced ?? counted?.produced ?? null,
    consumed: today.consumed,
    fedIn: today.fedIn ?? counted?.fedIn ?? null,
    drawn: today.drawn ?? counted?.drawn ?? null,
  };
}

async function loadCurve(dayOffset = 0): Promise<EnergyCurvePoint[] | null> {
  const loadIds = ids(ENERGY_SENSORS.load);
  const prodIds = ids(ENERGY_SENSORS.pv);
  if (!loadIds.length && !prodIds.length) return null;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  dayStart.setDate(dayStart.getDate() + dayOffset);
  const end = dayOffset < 0 ? new Date(dayStart.getTime() + DAY_MS) : undefined;
  const buckets = await runtime.getStatistics({
    statisticIds: [...loadIds, ...prodIds], start: dayStart, ...(end ? { end } : {}), period: '5minute', types: ['mean'],
  });
  const curve = curveFromBuckets(buckets, loadIds, prodIds, dayStart.getTime(), toKw);
  return curve.length ? curve : null;
}

let inflight: Promise<void> | null = null;
export function refreshEnergyHistory(): Promise<void> {
  if (inflight) return inflight;
  energyHistory.loading = true;
  inflight = (async () => {
    try {
      const dashboard = countersFromEnergyPrefs(await runtime.getEnergyPrefs().catch(() => null));
      const [curve, yesterday, week, month, total, today] = await Promise.all([
        loadCurve(), loadCurve(-1), loadPeriod('week', dashboard), loadPeriod('month', dashboard), loadPeriod('total', dashboard),
        loadToday(dashboard).catch(() => null),
      ]);
      energyHistory.today = today;
      energyHistory.curve = curve;
      energyHistory.yesterday = yesterday;
      energyHistory.periods = { week, month, total };
      energyHistory.updatedAt = Date.now();
    } catch { /* Ohne Antwort bleibt der letzte Stand — oder nichts. */ }
    finally { energyHistory.loading = false; inflight = null; }
  })();
  return inflight;
}

export function initEnergyHistory(): void {
  if (energyHistory.initialized) return;
  energyHistory.initialized = true;
  void refreshEnergyHistory();
  setInterval(() => void refreshEnergyHistory(), REFRESH_MS);
  registerRevalidation({
    name: 'energy-history',
    isStale: () => Date.now() - energyHistory.updatedAt >= REFRESH_MS,
    revalidate: refreshEnergyHistory,
  });
}

/* ── Simulator (R20/R21): Formen aus den Reglern, keine Messung ── */
function simulatedCurve(pv: number | null, load: number): EnergyCurvePoint[] {
  return Array.from({ length: 288 }, (_, i) => {
    const t = i / 288;
    const hour = t * 24;
    const bell = Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI)) ** 1.6;
    const plateau = 0.45 + 0.55 * Math.max(0, Math.sin(((hour - 5) / 16) * Math.PI)) + (hour > 18 && hour < 22.5 ? 0.35 : 0);
    return { t, load: Math.round(load * plateau * 100) / 100, prod: pv === null ? null : Math.round(pv * bell * 100) / 100 };
  });
}

/** Kurve des Tages: simuliert, wenn der Simulator Werte hält, sonst gemessen. */
export function energyCurve(): EnergyCurvePoint[] | null {
  const sim = simulation.energy;
  if (sim) return sim.configured ? simulatedCurve(sim.generation ? sim.pv : null, sim.load) : null;
  return energyHistory.curve;
}

/** Kurve von gestern, nur gemessen: der Simulator kennt keinen Vortag. */
export function energyYesterdayCurve(): EnergyCurvePoint[] | null {
  return simulation.energy ? null : energyHistory.yesterday;
}

/** Summen eines Zeitraums: simuliert oder aus der Statistik. */
export function energyPeriodTotals(period: HistoryPeriod): EnergyPeriodTotals | null {
  const sim = simulation.energy;
  if (sim) {
    if (!sim.configured) return null;
    const days = period === 'week' ? 7 : period === 'month' ? 30 : 400;
    const pv = sim.generation ? sim.pv : null;
    const r = (value: number) => Math.round(value * 10) / 10;
    return {
      produced: pv === null ? null : r(pv * 5.2 * days),
      consumed: r(sim.load * 6.1 * days),
      fedIn: pv === null ? null : r(Math.max(0, pv - sim.load) * 3.4 * days),
      drawn: r(Math.max(0, sim.load - (pv ?? 0)) * 4.7 * days),
    };
  }
  return energyHistory.periods[period];
}
