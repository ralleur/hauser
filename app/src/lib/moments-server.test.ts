import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { easterSunday, holidayOn, momentDayKey, momentSeasonKey, parseBirthdayTitle, selectedHolidays, selectMoments } from '../../server/moments.mjs';

function event(summary: string, day: string) {
  return { summary, start: { date: day }, end: { date: day } };
}

describe('Kalendermomente', () => {
  it('rechnet Ostersonntag', () => {
    expect(momentDayKey(easterSunday(2026))).toBe('2026-04-05');
    expect(momentDayKey(easterSunday(2027))).toBe('2027-03-28');
    expect(momentDayKey(easterSunday(2030))).toBe('2030-04-21');
  });

  it('erkennt feste Tage', () => {
    expect(holidayOn(new Date(2026, 11, 24))).toBe('christmas-eve');
    expect(holidayOn(new Date(2026, 11, 25))).toBe('christmas');
    expect(holidayOn(new Date(2026, 11, 31))).toBe('new-years-eve');
    expect(holidayOn(new Date(2026, 3, 5))).toBe('easter');
    expect(holidayOn(new Date(2026, 8, 4))).toBe(null);
  });

  it('folgt der Auswahl aus den Einstellungen und feiert ohne Eintrag alles', () => {
    const abgewaehlt = selectedHolidays(JSON.stringify(['easter']));
    expect(abgewaehlt.map((holiday: { key: string }) => holiday.key)).toEqual(['easter']);
    expect(holidayOn(new Date(2026, 11, 24), abgewaehlt)).toBe(null);
    expect(holidayOn(new Date(2026, 3, 5), abgewaehlt)).toBe('easter');

    for (const raw of [null, '', 'kaputt', '{"nein":1}']) {
      expect(selectedHolidays(raw).length).toBe(4);
    }
    expect(selectedHolidays(JSON.stringify([])).length).toBe(0);
  });

  it('nimmt den Namen nur bei eindeutiger Schreibweise', () => {
    expect(parseBirthdayTitle("Anna's birthday")).toEqual({ title: "Anna's birthday", name: 'Anna' });
    expect(parseBirthdayTitle('Geburtstag von Jonas')).toEqual({ title: 'Geburtstag von Jonas', name: 'Jonas' });
    expect(parseBirthdayTitle('Geburtstag: Mira')).toEqual({ title: 'Geburtstag: Mira', name: 'Mira' });
    /* „Lukas Geburtstag“ bliebe geraten — hier zeigt die Oberfläche den Titel. */
    expect(parseBirthdayTitle('Lukas Geburtstag')).toEqual({ title: 'Lukas Geburtstag', name: null });
    expect(parseBirthdayTitle('Zahnarzt')).toBe(null);
  });

  it('findet den Geburtstag des Tages und übergeht andere Termine', () => {
    const now = new Date(2026, 8, 4, 8, 0);
    const { moments } = selectMoments({
      now,
      events: [
        event('Geburtstag von Jonas', '2026-09-04'),
        event('Geburtstag von Mira', '2026-09-05'),
        event('Zahnarzt', '2026-09-04'),
      ],
    });
    expect(moments).toEqual([
      { id: 'birthday:2026-09-04:Jonas', kind: 'birthday', title: 'Geburtstag von Jonas', name: 'Jonas' },
    ]);
  });

  it('meldet den ersten Schnee einmal pro Saison', () => {
    const december = new Date(2026, 11, 2, 9, 0);
    const first = selectMoments({ now: december, weatherConditions: ['snowy'] });
    expect(first.moments.map((moment: { kind: string }) => moment.kind)).toContain('first-snow');
    expect(first.snowSeason).toBe('2026/2027');

    const again = selectMoments({ now: new Date(2026, 11, 9), weatherConditions: ['snowy'], seenSnowSeason: first.snowSeason });
    expect(again.moments.map((moment: { kind: string }) => moment.kind)).not.toContain('first-snow');

    const nextWinter = selectMoments({ now: new Date(2027, 11, 4), weatherConditions: ['snowy-rainy'], seenSnowSeason: first.snowSeason });
    expect(nextWinter.moments.map((moment: { kind: string }) => moment.kind)).toContain('first-snow');
    expect(momentSeasonKey(new Date(2027, 11, 4))).toBe('2027/2028');
  });
});
