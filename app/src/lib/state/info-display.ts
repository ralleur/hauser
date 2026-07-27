import { intlLocale } from './locale.svelte.ts';
import { m } from '../../paraglide/messages.js';
/* Anzeige-Helfer der info-Kategorie (sensor/binary_sensor): Zahl+Einheit bzw.
   device_class-gerechtes Zustandslabel. Reine Funktionen (Unit-Test), von
   Kachel UND Detail-Overlay geteilt. */

const BINARY_LABELS: Record<string, readonly [on: string, off: string]> = {
  window: [m.state_open(), m.state_closed()],
  door: [m.state_open(), m.state_closed()],
  garage_door: [m.state_open(), m.state_closed()],
  opening: [m.state_open(), m.state_closed()],
  lock: [m.state_unlocked(), m.state_locked()], // HA: on = entriegelt
  motion: [m.state_motion(), m.state_no_motion()],
  occupancy: [m.state_present(), m.state_absent()],
  presence: [m.state_present(), m.state_absent()],
  moisture: [m.state_wet(), m.state_dry()],
  smoke: [m.state_smoke(), m.state_no_smoke()],
  gas: [m.state_gas(), m.state_no_gas()],
  problem: [m.state_problem(), 'OK'],
  battery: [m.state_battery_low(), m.state_battery_ok()],
  connectivity: [m.state_connected(), m.state_disconnected()],
};

export function binaryLabel(deviceClass: string | null | undefined, on: boolean): string {
  const pair = (deviceClass && BINARY_LABELS[deviceClass]) || (['Ein', 'Aus'] as const);
  return on ? pair[0] : pair[1];
}

/* Messwert de-DE mit max. 1 Dezimale (tnum via .num); null = unavailable → „—".
   Die Einheit kommt bevorzugt live (SensorValue.unit), sonst aus dem Katalog. */
export function fmtSensor(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined) return '—';
  const num = value.toLocaleString(intlLocale(), { maximumFractionDigits: 1 });
  return unit ? `${num} ${unit}` : num;
}
