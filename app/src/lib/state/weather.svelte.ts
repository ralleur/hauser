import { openMeteoUrl, parseOutdoor, classifyTrend, type TempTrend, type OutdoorReading } from './weather.ts';

/* State-/Fetch-Teil der Ambient-Klimazeile. Außentemperatur ist best-effort und
   nie blockierend — bei Offline/Timeout bleibt der letzte Wert stehen. Der
   Innen-Trend wird aus der Live-Raumtemperatur über ein Zeitfenster abgeleitet,
   weil HA selbst keinen Trend liefert. */

const REQUEST_TIMEOUT_MS = 10_000;

export const outdoor = $state<OutdoorReading>({
  temp: null,
  trend: null,
  tempDelta: null,
  condition: null,
  windSpeed: null,
});

let inflight = false;

export async function refreshWeather(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const res = await fetch(openMeteoUrl(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return;
    const reading = parseOutdoor(await res.json());
    // Nur übernehmen, wenn eine Temperatur da ist; sonst letzten Wert halten.
    if (reading.temp !== null) {
      outdoor.temp = reading.temp;
      outdoor.trend = reading.trend;
      outdoor.tempDelta = reading.tempDelta;
      outdoor.condition = reading.condition;
      outdoor.windSpeed = reading.windSpeed;
    }
  } catch { /* offline / Timeout: letzter Wert bleibt stehen */ }
  finally { inflight = false; }
}

/* ── Innen-Trend über gesampelte Live-Raumtemperatur ──────────────────────────
   Vergleich der aktuellen Messung mit dem ältesten Sample im 30-min-Fenster,
   Totband 0,2 °C. Der Verlauf wird in localStorage gehalten, damit der Pfeil
   einen Reload übersteht und nicht bei „gleich" neu anlaufen muss. */
const INDOOR_WINDOW_MS = 30 * 60 * 1000;
const INDOOR_DEADBAND = 0.2;
const INDOOR_STORE_KEY = 'hmi:indoor-temp-samples';
type Sample = { t: number; v: number };

export const indoor = $state<{ trend: TempTrend | null }>({ trend: null });

let indoorSamples: Sample[] = loadIndoorSamples();
recomputeIndoorTrend(); // aus dem wiederhergestellten Verlauf sofort einen Pfeil zeigen

export function recordIndoorTemp(value: number | null, now = Date.now()): void {
  if (typeof value !== 'number') return;
  const last = indoorSamples[indoorSamples.length - 1];
  if (!last || last.v !== value) indoorSamples.push({ t: now, v: value });
  pruneSamples(now);
  indoor.trend = classifyTrend(indoorSamples[0]?.v, value, INDOOR_DEADBAND);
  saveIndoorSamples();
}

/* Fenster beschneiden, aber ein Sample vor der Grenze als Vergleichswert halten. */
function pruneSamples(now: number): void {
  const cutoff = now - INDOOR_WINDOW_MS;
  while (indoorSamples.length > 2 && indoorSamples[1].t < cutoff) indoorSamples.shift();
}

function recomputeIndoorTrend(): void {
  const newest = indoorSamples[indoorSamples.length - 1];
  indoor.trend = classifyTrend(indoorSamples[0]?.v, newest?.v, INDOOR_DEADBAND);
}

/* Selbstständig (referenziert NICHT die Modul-Bindung indoorSamples): der Loader
   läuft im Initializer von `let indoorSamples = …`, wo die Bindung noch in der
   TDZ liegt. Veralteten Verlauf beim Start gleich zurechtstutzen. */
function loadIndoorSamples(): Sample[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(INDOOR_STORE_KEY) ?? 'null');
    if (!Array.isArray(raw)) return [];
    const samples = raw.filter(
      (s): s is Sample => !!s && typeof s.t === 'number' && typeof s.v === 'number');
    const cutoff = Date.now() - INDOOR_WINDOW_MS;
    while (samples.length > 2 && samples[1].t < cutoff) samples.shift();
    return samples;
  } catch { return []; }
}

function saveIndoorSamples(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(INDOOR_STORE_KEY, JSON.stringify(indoorSamples)); }
  catch { /* Storage voll/blockiert: Persistenz ist best-effort */ }
}
