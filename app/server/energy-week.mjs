/* ── Energiestatistik der Vorwoche (Paket 11) ──

   Einmal nachts holt der Server die Tagessummen der konfigurierten
   Energie-Sensoren aus dem Langzeitspeicher von Home Assistant und legt sie
   als fertige Datei ab. Der Energie-Screen muss dafür morgens nichts mehr
   rechnen; fehlt die Datei, bleibt alles wie vorher.

   Bewusst über die offizielle REST-Statistik (`/api/history/period` liefert
   Rohwerte, `recorder/statistics_during_period` ist WebSocket): benutzt wird
   `/api/history/period` mit `minimal_response`, weil der Server hier ohnehin
   nur über REST spricht. Ohne HA-Zugang oder ohne Auswahl passiert nichts. */

import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { previousWeekRange } from './precompute.mjs';

/** Sensor-Ids aus der Energie-Sektion der Haushaltskonfiguration. */
export function energySensorIds(document) {
  const energy = document?.energy;
  if (!energy) return [];
  const ids = [
    ...(Array.isArray(energy.sensors?.productionPower) ? energy.sensors.productionPower : []),
    ...(Array.isArray(energy.sensors?.consumptionPower) ? energy.sensors.consumptionPower : []),
    ...Object.values(energy.kpis ?? {}),
  ];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.includes('.')))];
}

/* Aus der Rohhistorie wird pro Sensor und Tag der letzte numerische Wert —
   Zählerstände sind kumulativ, für die Wochenkurve zählt der Tagesabschluss. */
export function summarizeHistory(history, range) {
  const days = new Map();
  for (const series of Array.isArray(history) ? history : []) {
    for (const point of Array.isArray(series) ? series : []) {
      const entityId = point?.entity_id;
      const at = Date.parse(point?.last_changed ?? point?.last_updated ?? '');
      const value = Number(point?.state);
      if (!entityId || !Number.isFinite(at) || !Number.isFinite(value)) continue;
      if (at < range.start || at >= range.end) continue;
      const day = new Date(at);
      day.setHours(0, 0, 0, 0);
      const key = `${day.toISOString().slice(0, 10)}|${entityId}`;
      const existing = days.get(key);
      if (!existing || at >= existing.at) days.set(key, { at, value });
    }
  }
  return [...days.entries()]
    .map(([key, entry]) => {
      const [date, entityId] = key.split('|');
      return { date, entityId, value: entry.value };
    })
    .sort((a, b) => (a.date === b.date ? a.entityId.localeCompare(b.entityId) : a.date.localeCompare(b.date)));
}

/**
 * Holt die Vorwoche und schreibt sie als Datei.
 * @returns {Promise<{status: string, entries?: number, sensors?: number}>}
 */
export async function precomputeEnergyWeek({
  access = null,
  document = null,
  targetPath = null,
  fetchImpl = fetch,
  now = () => new Date(),
  haRestUrl,
} = {}) {
  if (!access || !targetPath || !haRestUrl) return { status: 'skipped', reason: 'no-access' };
  const sensors = energySensorIds(document);
  if (sensors.length === 0) return { status: 'skipped', reason: 'no-sensors' };

  const range = previousWeekRange(now());
  const url = haRestUrl(access.baseUrl, `api/history/period/${new Date(range.start).toISOString()}`);
  url.searchParams.set('filter_entity_id', sensors.join(','));
  url.searchParams.set('end_time', new Date(range.end).toISOString());
  url.searchParams.set('minimal_response', 'true');

  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${access.token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return { status: 'failed', reason: `http-${response.status}` };
  const entries = summarizeHistory(await response.json(), range);

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify({
    v: 1,
    from: new Date(range.start).toISOString(),
    to: new Date(range.end).toISOString(),
    sensors,
    entries,
  }), 'utf8');
  return { status: 'written', entries: entries.length, sensors: sensors.length };
}
