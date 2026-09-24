/* ── Tagesbilanz (wie die iOS-App, EnergyBalance) ──
   Aus den Tageszählern: wie viel des Verbrauchs von der eigenen Sonne kam und
   welche Lücke das Netz gefüllt hat. Eine Zahl nur gemessen oder sauber daraus
   abgeleitet, nie mit Schätzfaktor (R3). Ohne Erzeugungszähler keine Bilanz —
   „nicht eingerichtet" heißt nicht „0 % Sonne". Panel und Telefon lesen
   dieselbe Rechnung. */

/** split: Einspeisung und Bezug gemessen, das volle Bild · net: nur Erzeugt und Verbraucht. */
export type BalanceKind = 'split' | 'net';
export type BalancePart = 'ownUse' | 'fedIn' | 'drawn' | 'produced' | 'consumed';

export interface BalanceSegment {
  part: BalancePart;
  from: number;
  to: number;
}

export interface EnergyBalance {
  kind: BalanceKind;
  produced: number;
  /** split: Hausverbrauch aus der Bilanz (selbst genutzt + bezogen) · net: der gemessene Zähler. */
  consumed: number;
  ownUse: number;
  fedIn: number;
  drawn: number;
  /** Der gemessene Zähler „Verbraucht", wenn er von der Bilanz abweicht — meist zählt er nur die erfassten Geräte. */
  meter: number | null;
}

export interface EnergyTodayInput {
  produced: number | null;
  consumed: number | null;
  fedIn: number | null;
  drawn: number | null;
}

/* `unavailable` kommt schon als null; NaN, ∞ und negative Stände sind kein Tageswert. */
function clean(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function energyBalanceToday(input: EnergyTodayInput): EnergyBalance | null {
  const produced = clean(input.produced);
  if (produced === null) return null;
  const measured = clean(input.consumed);
  const fed = clean(input.fedIn);
  const drawn = clean(input.drawn);
  /* Mehr eingespeist als erzeugt heißt: die Zähler passen nicht zusammen —
     dann nur die Bilanz, nichts geglättet. */
  if (fed !== null && drawn !== null && fed <= produced * 1.02 + 0.1) {
    const own = Math.max(0, produced - fed);
    const house = own + drawn; // wie das Energie-Dashboard, ohne Akku
    const off = measured !== null && Math.round(measured * 10) !== Math.round(house * 10);
    return { kind: 'split', produced, consumed: house, ownUse: own, fedIn: Math.min(fed, produced), drawn, meter: off ? measured : null };
  }
  if (measured === null) return null;
  return { kind: 'net', produced, consumed: measured, ownUse: 0, fedIn: 0, drawn: 0, meter: null };
}

/** Kurz nach Mitternacht ist noch nichts gezählt — dann keine Balken und keine Prozente. */
export function balanceCounted(balance: EnergyBalance): boolean {
  return balance.produced >= 0.1 || balance.consumed >= 0.1;
}

/* Gerundet, aber nie 0 bei etwas und nie 100 bei einem Rest. */
function share(ratio: number, some: boolean, rest: boolean): number {
  let percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  if (rest) percent = Math.min(percent, 99);
  if (some) percent = Math.max(percent, 1);
  return percent;
}

/** Anteil der Sonne am Verbrauch. Bilanziell nur, solange weniger erzeugt als verbraucht wurde — sonst „+x kWh". */
export function balancePercent(balance: EnergyBalance): number | null {
  if (balance.consumed < 0.1 || (balance.kind === 'net' && balance.produced >= balance.consumed)) return null;
  const sun = balance.kind === 'split' ? balance.ownUse : balance.produced;
  /* Ein Bezug unter der Anzeigegrenze zählt nicht als Rest — sonst stünde
     „88 %" neben „Das Netz musste nichts dazugeben". */
  const whole = balance.kind === 'split' ? balance.ownUse + (balance.drawn >= 0.05 ? balance.drawn : 0) : balance.consumed;
  if (whole <= 0) return null;
  return share(sun / whole, sun >= 0.05, balance.kind === 'net' || balance.drawn >= 0.05);
}

/** Anteil des Erzeugten, der im Haus blieb — nur mit gemessener Einspeisung. */
export function balanceSelfUsePercent(balance: EnergyBalance): number | null {
  if (balance.kind !== 'split' || balance.produced < 0.1) return null;
  return share(balance.ownUse / balance.produced, balance.ownUse >= 0.05, balance.fedIn >= 0.05);
}

/** Die Stücke einer Zeile, 0 = Erzeugt, 1 = Verbraucht. Das selbst genutzte Stück steht in beiden am Nullpunkt. */
export function balanceSegments(balance: EnergyBalance, row: 0 | 1): BalanceSegment[] {
  const { ownUse, fedIn, drawn } = balance;
  const all: BalanceSegment[] = balance.kind === 'split'
    ? row === 0
      ? [{ part: 'ownUse', from: 0, to: ownUse }, { part: 'fedIn', from: ownUse, to: ownUse + fedIn }]
      : [{ part: 'ownUse', from: 0, to: ownUse }, { part: 'drawn', from: ownUse, to: ownUse + drawn }]
    : row === 0
      ? [{ part: 'produced', from: 0, to: balance.produced }]
      : [{ part: 'consumed', from: 0, to: balance.consumed }];
  return all.filter((segment) => segment.to - segment.from >= 0.005);
}

/** Achse mit runden Schritten (1-2-5), höchstens fünf Felder. */
export function balanceAxis(value: number): { top: number; step: number; ticks: number[] } {
  const peak = Math.max(value, 0.5);
  const raw = peak / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw - 1e-9) ?? 10 * magnitude;
  const top = Math.max(1, Math.ceil(peak / step - 1e-9)) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top + step / 2; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return { top, step, ticks };
}
