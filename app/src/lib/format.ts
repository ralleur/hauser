import { intlLocale } from './state/locale.svelte.ts';
/* Formatierungs-Helfer (portiert aus prototype/scripts/main.js) —
   alle Datenwerte de-DE, Anzeige mit tnum (.num, ADR-011) */

export function fmtTemp(v: number): string {
  return v.toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/* kW-Werte: gleiche 1-Dezimal-Formatierung wie Temperaturen */
export const fmtKw = fmtTemp;

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* Laufzeit-Label fürs Media Detail: „2 h 08 min" bzw. „52 min" */
export function fmtRuntime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/* Resume-Label (docs/07 Screen 7: „Weiterschauen 0:42" = h:mm bei Filmen) */
export function fmtResume(sec: number, dur: number): string {
  if (dur >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  return fmtTime(sec);
}

/* Player-Zeitanzeige: h:mm:ss sobald das Item Stunden hat, sonst m:ss */
export function fmtClock(sec: number, withHours: boolean): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (withHours || h)
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
