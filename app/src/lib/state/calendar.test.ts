import { describe, expect, it } from 'vitest';
import {
  CALENDAR_FUTURE_WEEKS,
  CALENDAR_PAST_WEEKS,
  calendarEventsMessage,
  calendarWindow,
  formatAgendaTime,
  groupAgendaDays,
  projectAmbientToday,
  projectAmbientWeek,
  projectCalendarWeeks,
  selectCalendars,
  selectFamilyCalendar,
  type CalendarEvent,
  type CalendarSource,
} from './calendar.ts';

const NOW = new Date('2026-07-12T12:00:00+02:00');

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    title: 'Familientermin',
    start: '2026-07-12T14:00:00+02:00',
    end: '2026-07-12T15:00:00+02:00',
    allDay: false,
    location: null,
    description: null,
    ...overrides,
  };
}

describe('calendar source discovery', () => {
  it('wählt exakt den HA-Kalender Familie, unabhängig von Großschreibung', () => {
    const sources: CalendarSource[] = [
      { entityId: 'calendar.arbeit', name: 'Arbeit' },
      { entityId: 'calendar.familie', name: 'FAMILIE' },
    ];
    expect(selectFamilyCalendar(sources)?.entityId).toBe('calendar.familie');
  });

  it('rät bei fehlendem Familie-Kalender keine Entität', () => {
    expect(selectFamilyCalendar([{ entityId: 'calendar.privat', name: 'Privat' }])).toBeNull();
  });
});

describe('calendar selection (Einstellungen)', () => {
  const sources: CalendarSource[] = [
    { entityId: 'calendar.arbeit', name: 'Arbeit' },
    { entityId: 'calendar.familie', name: 'Familie' },
    { entityId: 'calendar.geburtstage', name: 'Geburtstage' },
  ];

  it('null = Automatik: nur der Familie-Kalender', () => {
    expect(selectCalendars(sources, null).map((s) => s.entityId)).toEqual(['calendar.familie']);
  });

  it('Automatik ohne Familie-Kalender wählt nichts', () => {
    expect(selectCalendars([{ entityId: 'calendar.privat', name: 'Privat' }], null)).toEqual([]);
  });

  it('explizite Auswahl filtert in Quellen-Reihenfolge', () => {
    const picked = selectCalendars(sources, ['calendar.geburtstage', 'calendar.arbeit']);
    expect(picked.map((s) => s.entityId)).toEqual(['calendar.arbeit', 'calendar.geburtstage']);
  });

  it('verschwundene Kalender fallen still aus der Auswahl', () => {
    expect(selectCalendars(sources, ['calendar.geloescht'])).toEqual([]);
  });

  it('leere explizite Auswahl bleibt leer (kein Rückfall auf Automatik)', () => {
    expect(selectCalendars(sources, [])).toEqual([]);
  });
});

describe('calendar projection', () => {
  it('nutzt den rückgabefähigen HA-Service statt des entfernten calendar/get_events-Kommandos', () => {
    const start = new Date('2026-07-12T00:00:00+02:00');
    const end = new Date('2026-07-19T00:00:00+02:00');
    expect(calendarEventsMessage('calendar.familie', start, end)).toEqual({
      type: 'call_service',
      domain: 'calendar',
      service: 'get_events',
      target: { entity_id: 'calendar.familie' },
      service_data: {
        start_date_time: start.toISOString(),
        end_date_time: end.toISOString(),
      },
      return_response: true,
    });
  });

  it('spannt das Scroll-Fenster über ganze Wochen ab dem Montag der aktuellen Woche', () => {
    const { start, end } = calendarWindow(NOW);
    // NOW = So, 12.07.2026 → Montag der Woche ist der 06.07., minus PAST_WEEKS.
    expect(start.getDay()).toBe(1); // Montag
    expect(start.toISOString()).toBe('2026-05-10T22:00:00.000Z'); // Mo, 11.05. lokal
    // gerundet, da eine DST-Umstellung im Fenster die ms-Spanne um 1 h verschiebt
    const weeks = (end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000);
    expect(Math.round(weeks)).toBe(CALENDAR_PAST_WEEKS + 1 + CALENDAR_FUTURE_WEEKS);
    expect(end.getDay()).toBe(1); // wieder ein Montag
    expect(start.getTime()).toBeLessThan(NOW.getTime());
  });

  it('sortiert und gruppiert Termine nach lokalem Tag', () => {
    const groups = groupAgendaDays([
      event({ id: 'later', start: '2026-07-13T09:00:00+02:00' }),
      event({ id: 'first', start: '2026-07-12T08:00:00+02:00' }),
    ], NOW);
    expect(groups.map((group) => [group.key, group.events[0].id])).toEqual([
      ['2026-07-12', 'first'],
      ['2026-07-13', 'later'],
    ]);
    expect(groups[0].today).toBe(true);
  });

  it('formatiert ganztägige und zeitgebundene Termine ehrlich', () => {
    expect(formatAgendaTime(event({ allDay: true }))).toBe('Ganztägig');
    expect(formatAgendaTime(event())).toBe('14:00–15:00');
  });

});

describe('ambient today line', () => {
  it('lässt Vergangenes weg und markiert den laufenden Termin als „Jetzt"', () => {
    const projected = projectAmbientToday([
      event({ id: 'done', start: '2026-07-12T08:00:00+02:00', end: '2026-07-12T09:00:00+02:00' }),
      event({ id: 'running', start: '2026-07-12T11:00:00+02:00', end: '2026-07-12T13:00:00+02:00' }),
      event({ id: 'later', start: '2026-07-12T16:00:00+02:00' }),
      event({ id: 'tomorrow', start: '2026-07-13T08:00:00+02:00', end: '2026-07-13T09:00:00+02:00' }),
    ], NOW);
    expect(projected.items.map((item) => item.id)).toEqual(['running', 'later']);
    expect(projected.items[0].now).toBe(true);
    expect(projected.items[1]).toMatchObject({ now: false, time: '16:00' });
  });

  it('kappt bei mehr als drei Terminen und nennt die Restzahl', () => {
    const projected = projectAmbientToday([
      event({ id: 'a', start: '2026-07-12T13:00:00+02:00', end: '2026-07-12T14:00:00+02:00' }),
      event({ id: 'b', start: '2026-07-12T15:00:00+02:00', end: '2026-07-12T16:00:00+02:00' }),
      event({ id: 'c', start: '2026-07-12T17:00:00+02:00', end: '2026-07-12T18:00:00+02:00' }),
      event({ id: 'd', start: '2026-07-12T19:00:00+02:00', end: '2026-07-12T20:00:00+02:00' }),
    ], NOW);
    expect(projected.items).toHaveLength(3);
    expect(projected.more).toBe(1);
  });

  it('zählt laufende mehrtägige Ganztages-Termine zu heute, ohne Uhrzeit', () => {
    const projected = projectAmbientToday([
      event({
        id: 'urlaub', title: 'Urlaub', allDay: true,
        start: '2026-07-10T00:00:00+02:00', end: '2026-07-15T00:00:00+02:00',
      }),
    ], NOW);
    expect(projected.items).toHaveLength(1);
    expect(projected.items[0]).toMatchObject({ time: null, now: true });
  });
});

describe('ambient week strip', () => {
  it('spannt sieben Spalten ab heute auf — der aktuelle Tag liegt ganz links', () => {
    const week = projectAmbientWeek([
      event({ id: 'today', start: '2026-07-12T16:00:00+02:00', end: '2026-07-12T17:00:00+02:00' }),
    ], NOW);
    expect(week).toHaveLength(7);
    expect(week[0]).toMatchObject({ key: '2026-07-12', weekday: 'So', dayOfMonth: 12 });
    expect(week[6]).toMatchObject({ key: '2026-07-18', weekday: 'Sa', dayOfMonth: 18 });
    expect(week[0].events.map((item) => item.id)).toEqual(['today']);
    expect(week.slice(1).every((day) => day.events.length === 0)).toBe(true);
  });

  it('betont den nächsten Termin der Woche nur, wenn heute nichts läuft oder ansteht', () => {
    const withToday = projectAmbientWeek([
      event({ id: 'today', start: '2026-07-12T16:00:00+02:00', end: '2026-07-12T17:00:00+02:00' }),
      event({ id: 'tuesday', start: '2026-07-14T09:00:00+02:00', end: '2026-07-14T10:00:00+02:00' }),
    ], NOW);
    expect(withToday[2].events[0].emphasis).toBeNull();

    const withoutToday = projectAmbientWeek([
      event({ id: 'tuesday', start: '2026-07-14T09:00:00+02:00', end: '2026-07-14T10:00:00+02:00' }),
      event({ id: 'friday', start: '2026-07-17T09:00:00+02:00', end: '2026-07-17T10:00:00+02:00' }),
    ], NOW);
    expect(withoutToday[2].events[0].emphasis).toBe('next');
    expect(withoutToday[5].events[0].emphasis).toBeNull();
  });

  it('kappt bei mehr als zwei Terminen pro Tag und nennt die Restzahl', () => {
    const week = projectAmbientWeek([
      event({ id: 'a', start: '2026-07-13T09:00:00+02:00', end: '2026-07-13T10:00:00+02:00' }),
      event({ id: 'b', start: '2026-07-13T12:00:00+02:00', end: '2026-07-13T13:00:00+02:00' }),
      event({ id: 'c', start: '2026-07-13T18:00:00+02:00', end: '2026-07-13T19:00:00+02:00' }),
    ], NOW);
    expect(week[1].events.map((item) => item.id)).toEqual(['a', 'b']);
    expect(week[1].more).toBe(1);
  });
});

describe('calendar month grid', () => {
  it('reiht Wochen ab Montag auf; die aktuelle Woche liegt am erwarteten Index', () => {
    const weeks = projectCalendarWeeks([], NOW);
    expect(weeks).toHaveLength(CALENDAR_PAST_WEEKS + 1 + CALENDAR_FUTURE_WEEKS);
    expect(weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(weeks.every((week) => new Date(`${week.days[0].key}T00:00`).getDay() === 1)).toBe(true);

    const current = weeks[CALENDAR_PAST_WEEKS];
    expect(current.isCurrent).toBe(true);
    expect(current.days[6]).toMatchObject({ key: '2026-07-12', isToday: true }); // heute = Sonntag
    expect(weeks.filter((week) => week.isCurrent)).toHaveLength(1);
  });

  it('legt Termine auf ihren lokalen Tag und benennt den Monat nach dem Donnerstag', () => {
    const weeks = projectCalendarWeeks([
      event({ id: 'mo', title: 'Montagstermin', start: '2026-07-06T09:00:00+02:00', end: '2026-07-06T10:00:00+02:00' }),
    ], NOW);
    const current = weeks[CALENDAR_PAST_WEEKS];
    expect(current.monthLabel).toBe('Juli 2026');
    expect(current.days[0]).toMatchObject({ key: '2026-07-06', dayOfMonth: 6 });
    expect(current.days[0].events.map((item) => item.id)).toEqual(['mo']);
    expect(current.days[0].events[0].time).toBe('09:00');
  });

  it('markiert am Monatsersten das Monatskürzel und kappt volle Tage mit Restzahl', () => {
    const hh = (h: number) => String(h).padStart(2, '0');
    const overflow = Array.from({ length: 5 }, (_, index) => event({
      id: `x${index}`,
      start: `2026-08-01T${hh(index + 8)}:00:00+02:00`,
      end: `2026-08-01T${hh(index + 9)}:00:00+02:00`,
    }));
    const weeks = projectCalendarWeeks(overflow, NOW);
    const firstOfAugust = weeks.flatMap((week) => week.days).find((day) => day.key === '2026-08-01');
    expect(firstOfAugust?.monthShort).toBe('Aug');
    expect(firstOfAugust?.events).toHaveLength(3);
    expect(firstOfAugust?.more).toBe(2);
  });
});

describe('calendar multi-day bars', () => {
  // NOW = So, 12.07.2026 → aktuelle Woche Mo 06.07. (Spalte 0) … So 12.07. (Spalte 6)
  it('zieht mehrtägige Termine als Balken und hält sie aus den Tagesterminen heraus', () => {
    const current = projectCalendarWeeks([
      event({ id: 'urlaub', title: 'Urlaub', allDay: true,
        start: '2026-07-07T00:00:00+02:00', end: '2026-07-10T00:00:00+02:00' }), // Di–Do (Ende exklusiv)
    ], NOW)[CALENDAR_PAST_WEEKS];
    expect(current.bars).toHaveLength(1);
    expect(current.bars[0]).toMatchObject({
      id: 'urlaub', startCol: 1, span: 3, lane: 0, continuesLeft: false, continuesRight: false,
    });
    expect(current.laneCount).toBe(1);
    expect(current.days.flatMap((day) => day.events)).toHaveLength(0);
  });

  it('bricht an der Wochengrenze um und markiert die Fortsetzung', () => {
    const weeks = projectCalendarWeeks([
      event({ id: 'reise', title: 'Reise', allDay: true,
        start: '2026-07-10T00:00:00+02:00', end: '2026-07-15T00:00:00+02:00' }), // Fr 10. – Di 14.
    ], NOW);
    const thisWeek = weeks[CALENDAR_PAST_WEEKS].bars;
    const nextWeek = weeks[CALENDAR_PAST_WEEKS + 1].bars;
    expect(thisWeek[0]).toMatchObject({ startCol: 4, span: 3, continuesLeft: false, continuesRight: true });
    expect(nextWeek[0]).toMatchObject({ startCol: 0, span: 2, continuesLeft: true, continuesRight: false });
  });

  it('stapelt überlappende Balken in getrennte Lanes', () => {
    const current = projectCalendarWeeks([
      event({ id: 'a', title: 'A', allDay: true, start: '2026-07-06T00:00:00+02:00', end: '2026-07-09T00:00:00+02:00' }), // Mo–Mi
      event({ id: 'b', title: 'B', allDay: true, start: '2026-07-07T00:00:00+02:00', end: '2026-07-10T00:00:00+02:00' }), // Di–Do (überlappt A)
    ], NOW)[CALENDAR_PAST_WEEKS];
    expect(current.laneCount).toBe(2);
    expect(current.bars.find((bar) => bar.id === 'a')?.lane).toBe(0);
    expect(current.bars.find((bar) => bar.id === 'b')?.lane).toBe(1);
  });

  it('behandelt eintägige Ganztagestermine weiter als Tagestermin, nicht als Balken', () => {
    const current = projectCalendarWeeks([
      event({ id: 'kita', title: 'Kita zu', allDay: true,
        start: '2026-07-07T00:00:00+02:00', end: '2026-07-08T00:00:00+02:00' }), // genau ein Tag
    ], NOW)[CALENDAR_PAST_WEEKS];
    expect(current.bars).toHaveLength(0);
    expect(current.days[1].events.map((item) => item.id)).toEqual(['kita']); // Di, Spalte 1
  });
});
