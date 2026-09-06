/* Der Satz zum Moment. Der Server liefert nur Art und Namen — formuliert wird
   hier, damit jede Sprache ihre eigene Wendung bekommt. */
import { m } from '../../paraglide/messages.js';
import type { DayMoment } from '../api/types.ts';
import type { MomentHolidayKey } from './moment-holidays.ts';

/** Name des festen Tages für die Einstellungen. */
export function momentHolidayLabel(key: MomentHolidayKey): string {
  switch (key) {
    case 'christmas-eve': return m.moment_label_christmas_eve();
    case 'christmas': return m.moment_label_christmas();
    case 'new-years-eve': return m.moment_label_new_years_eve();
    case 'easter': return m.moment_label_easter();
  }
}

export function momentLine(moment: DayMoment | null): string | null {
  if (!moment) return null;
  switch (moment.kind) {
    case 'first-snow':
      return m.moment_first_snow();
    case 'holiday':
      switch (moment.holiday) {
        case 'christmas-eve': return m.moment_christmas_eve();
        case 'christmas': return m.moment_christmas();
        case 'new-years-eve': return m.moment_new_years_eve();
        case 'easter': return m.moment_easter();
        default: return null;
      }
    case 'birthday':
      return moment.name
        ? m.moment_birthday_named({ name: moment.name })
        : m.moment_birthday_title({ title: moment.title ?? '' });
    default:
      return null;
  }
}
