/* Welche festen Tage als Moment gelten. Die Auswahl gehört dem Haushalt, nicht
   dem Gerät — sie liegt deshalb in der geteilten Konfiguration, wo der Server
   sie mitliest. Ohne Eintrag gelten alle Tage. */
import { sharedStorage } from './shared-config.ts';

export const MOMENT_HOLIDAY_KEYS = ['christmas-eve', 'christmas', 'new-years-eve', 'easter'] as const;
export type MomentHolidayKey = (typeof MOMENT_HOLIDAY_KEYS)[number];

const SELECTION_KEY = 'hmi:moment-holidays:v1';

export function selectedMomentHolidays(): MomentHolidayKey[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null') as unknown;
    if (!Array.isArray(parsed)) return [...MOMENT_HOLIDAY_KEYS];
    return MOMENT_HOLIDAY_KEYS.filter((key) => parsed.includes(key));
  } catch { return [...MOMENT_HOLIDAY_KEYS]; }
}

export function setSelectedMomentHolidays(keys: readonly MomentHolidayKey[]): void {
  try { sharedStorage.setItem(SELECTION_KEY, JSON.stringify(keys)); } catch { /* best-effort */ }
}
