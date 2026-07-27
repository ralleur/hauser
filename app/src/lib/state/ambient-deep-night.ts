export const DEEP_NIGHT_START_HOUR = 22;
export const DEEP_NIGHT_END_HOUR = 6;

/** Lokale Panel-Zeit: 22:00–05:59 ist die augenschonende Tiefnacht. */
export function isDeepNightHour(hour: number): boolean {
  return hour >= DEEP_NIGHT_START_HOUR || hour < DEEP_NIGHT_END_HOUR;
}