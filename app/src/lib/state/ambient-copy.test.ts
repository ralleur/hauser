import { describe, expect, it } from 'vitest';
import {
  ambientCopyKey,
  analyzeAmbientContext,
  buildAmbientCopyMessages,
  daypartLabel,
  generateAmbientCopy,
  sanitizeAmbientLlmCopy,
  type AmbientCopyStyle,
} from './ambient-copy.ts';
import type { CalendarEvent } from './calendar.ts';
import type { OutdoorReading } from './weather.ts';

const MORNING = new Date('2026-07-16T09:00:00+02:00');
const AFTERNOON = new Date('2026-07-16T15:00:00+02:00');
const NO_WEATHER: OutdoorReading = {
  temp: null,
  trend: null,
  tempDelta: null,
  condition: null,
  windSpeed: null,
};

function event(
  title: string,
  start: string,
  end: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: `${title}-${start}`,
    title,
    start,
    end,
    allDay: false,
    location: null,
    description: null,
    ...overrides,
  };
}

function weather(overrides: Partial<OutdoorReading>): OutdoorReading {
  return { ...NO_WEATHER, ...overrides };
}

function expectValidCopy(copy: ReturnType<typeof generateAmbientCopy>): void {
  expect(copy.lines.length).toBeGreaterThanOrEqual(1);
  expect(copy.lines.length).toBeLessThanOrEqual(2);
  for (const line of copy.lines) {
    expect(line.length).toBeGreaterThan(0);
    expect(line).not.toMatch(/[!\p{Extended_Pictographic}]/u);
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(14);
  }
}

describe('ambient day comment', () => {
  it('kommentiert einen terminfreien sonnigen Vormittag über Wetter und Tagesabschnitt', () => {
    const copy = generateAmbientCopy([], weather({ temp: 22, condition: 'sunny' }), MORNING);
    expect(copy.style).toBe('weather');
    expect(copy.lines.join(' ')).toMatch(/Sonne|Wetter|draußen/i);
    expectValidCopy(copy);
  });

  it('nutzt einen späteren Schwimmtermin für ein bewusst flaches Wortspiel', () => {
    const copy = generateAmbientCopy([
      event('Schwimmkurs', '2026-07-16T18:00:00+02:00', '2026-07-16T19:00:00+02:00'),
    ], NO_WEATHER, AFTERNOON);
    expect(copy.style).toBe('wordplay');
    expect(copy.lines.join(' ')).toMatch(/Bahnen|Wasser|schwimm/i);
    expectValidCopy(copy);
  });

  it('erkennt mehrere dicht aufeinanderfolgende Termine als volle Planung', () => {
    const events = [
      event('Stand-up', '2026-07-16T15:30:00+02:00', '2026-07-16T16:00:00+02:00'),
      event('Arzt', '2026-07-16T16:15:00+02:00', '2026-07-16T17:00:00+02:00'),
      event('Review', '2026-07-16T17:15:00+02:00', '2026-07-16T18:00:00+02:00'),
      event('Block D', '2026-07-16T18:10:00+02:00', '2026-07-16T19:00:00+02:00'),
    ];
    const copy = generateAmbientCopy(events, NO_WEATHER, AFTERNOON);
    expect(copy.style).toBe('calendar');
    expect(copy.lines.join(' ')).toMatch(/Kalender|Termine|Lücken|Takt/i);
    expectValidCopy(copy);
  });

  it('kombiniert Hitze mit einem Außentermin, ohne den Termin aufzuzählen', () => {
    const copy = generateAmbientCopy([
      event('Ausflug in den Zoo', '2026-07-16T16:00:00+02:00', '2026-07-16T19:00:00+02:00'),
    ], weather({ temp: 31, condition: 'sunny' }), AFTERNOON);
    expect(copy.style).toBe('weather');
    expect(copy.lines.join(' ')).toMatch(/31|Schatten|Hitze/i);
    expect(copy.lines.join(' ')).not.toContain('Ausflug in den Zoo');
    expectValidCopy(copy);
  });

  it('kommentiert Regen bei freiem Kalender', () => {
    const copy = generateAmbientCopy([], weather({ temp: 14, condition: 'rainy' }), AFTERNOON);
    expect(copy.style).toBe('weather');
    expect(copy.lines.join(' ')).toMatch(/Regen|Steckdose|drinnen/i);
    expectValidCopy(copy);
  });

  it('erkennt, wenn alle heutigen Termine bereits vorbei sind', () => {
    const copy = generateAmbientCopy([
      event('Frühstück', '2026-07-16T08:00:00+02:00', '2026-07-16T09:00:00+02:00'),
      event('Zahnarzt', '2026-07-16T10:00:00+02:00', '2026-07-16T11:00:00+02:00'),
    ], NO_WEATHER, AFTERNOON);
    expect(copy.style).toBe('calendar');
    expect(copy.lines.join(' ')).toMatch(/Feierabend|erledigt|durch/i);
    expectValidCopy(copy);
  });

  it('erkennt Ferienbeginn als Wortspiel', () => {
    const copy = generateAmbientCopy([
      event('Sommerferien', '2026-07-16', '2026-07-17', { allDay: true }),
    ], NO_WEATHER, MORNING);
    expect(copy.style).toBe('wordplay');
    expect(copy.lines.join(' ')).toMatch(/kurze Hose|Wochentage|Planlosigkeit/i);
    expectValidCopy(copy);
  });

  it('erzwingt bei einem unbekannten Termin kein Wortspiel', () => {
    const copy = generateAmbientCopy([
      event('Q3 Abstimmung', '2026-07-16T17:00:00+02:00', '2026-07-16T18:00:00+02:00'),
    ], NO_WEATHER, AFTERNOON);
    expect(copy.style).toBe('calendar');
    expect(copy.lines.join(' ')).not.toContain('Q3 Abstimmung');
    expectValidCopy(copy);
  });

  it('funktioniert ohne Wetterdaten ausschließlich aus Kalender und Tagesabschnitt', () => {
    const copy = generateAmbientCopy([
      event('Kirmes', '2026-07-16T20:00:00+02:00', '2026-07-16T22:00:00+02:00'),
    ], NO_WEATHER, AFTERNOON);
    expect(copy.style).toBe('wordplay');
    expectValidCopy(copy);
  });

  it('fällt ohne Kalender- und Wetterdaten auf einen Tagesabschnittskommentar zurück', () => {
    const copy = generateAmbientCopy([], NO_WEATHER, AFTERNOON);
    expect(copy.style).toBe('daypart');
    expect(copy.lines.join(' ')).toMatch(/Nachmittag|Tag|Kaffee/i);
    expectValidCopy(copy);
  });

  it('stellt alle vier Stilrichtungen bereit', () => {
    const styles = new Set<AmbientCopyStyle>([
      generateAmbientCopy([], NO_WEATHER, AFTERNOON).style,
      generateAmbientCopy([
        event('Schwimmkurs', '2026-07-16T18:00:00+02:00', '2026-07-16T19:00:00+02:00'),
      ], NO_WEATHER, AFTERNOON).style,
      generateAmbientCopy([], weather({ temp: 22, condition: 'sunny' }), MORNING).style,
      generateAmbientCopy([
        event('Q3 Abstimmung', '2026-07-16T17:00:00+02:00', '2026-07-16T18:00:00+02:00'),
      ], NO_WEATHER, AFTERNOON).style,
    ]);
    expect(styles).toEqual(new Set(['daypart', 'wordplay', 'weather', 'calendar']));
  });
});

describe('ambient copy stability and variation', () => {
  it('bleibt innerhalb derselben Stunde bei unveränderten Daten stabil', () => {
    const events = [event('Q3 Abstimmung', '2026-07-16T17:00:00+02:00', '2026-07-16T18:00:00+02:00')];
    const first = generateAmbientCopy(events, NO_WEATHER, new Date('2026-07-16T15:01:00+02:00'));
    const later = generateAmbientCopy(events, NO_WEATHER, new Date('2026-07-16T15:59:00+02:00'));
    expect(later).toEqual(first);
    expect(ambientCopyKey(events, NO_WEATHER, new Date('2026-07-16T15:59:00+02:00')))
      .toBe(ambientCopyKey(events, NO_WEATHER, new Date('2026-07-16T15:01:00+02:00')));
  });

  it('variiert über sinnvolle Zeitfenster statt bei jedem Refresh', () => {
    const texts = [9, 10, 11, 12].map((hour) => generateAmbientCopy(
      [], NO_WEATHER, new Date(`2026-07-16T${String(hour).padStart(2, '0')}:15:00+02:00`),
    ).lines.join(' '));
    expect(new Set(texts).size).toBeGreaterThan(1);
  });

  it('ordnet die Tagesabschnitte korrekt zu', () => {
    expect(daypartLabel(MORNING)).toBe('Donnerstagmorgen');
    expect(daypartLabel(AFTERNOON)).toBe('Donnerstagnachmittag');
    expect(daypartLabel(new Date('2026-07-16T20:00:00+02:00'))).toBe('Donnerstagabend');
  });
});

describe('hybrid ambient analysis and LLM boundary', () => {
  it('priorisiert bei normalen Sommertemperaturen den Kalender statt des Thermometers', () => {
    const context = analyzeAmbientContext([
      event('Frühstück', '2026-07-16T08:00:00+02:00', '2026-07-16T09:00:00+02:00'),
      event('Schwimmkurs Jamie', '2026-07-16T16:00:00+02:00', '2026-07-16T17:00:00+02:00'),
    ], weather({ temp: 28.6, condition: 'sunny', tempDelta: 2.2 }), AFTERNOON);

    expect(context).toMatchObject({
      weekday: 'Donnerstag',
      time: '15:00',
      dayPeriod: 'Nachmittag',
      calendarLoad: 'belegt',
      nextEvent: { title: 'Schwimmkurs Jamie', time: '16:00', category: 'swimming' },
      remainingEvents: 1,
      weather: { condition: 'sonnig', temperature: null, trend: 'wärmer' },
    });
    expect(context.notableFacts).toEqual(expect.arrayContaining([
      'ein Termin steht an', 'Schwimmtermin',
    ]));
    expect(context.notableFacts).not.toContain('extreme Hitze');
    expect(buildAmbientCopyMessages(context, []).at(-1)?.content).not.toContain('28.6');
    expect(JSON.stringify(context)).not.toContain('Frühstück');
  });

  it('suggeriert bei mindestens einem Termin weder Freizeit noch Langeweile', () => {
    const events = [
      event('Schwimmkurs Jamie', '2026-07-16T20:00:00+02:00', '2026-07-16T21:00:00+02:00'),
    ];
    const context = analyzeAmbientContext(events, NO_WEATHER, AFTERNOON);
    const fallback = generateAmbientCopy([
      event('Q3 Abstimmung', '2026-07-16T20:00:00+02:00', '2026-07-16T21:00:00+02:00'),
    ], NO_WEATHER, AFTERNOON).lines.join(' ');

    expect(context.calendarLoad).toBe('belegt');
    expect(context.notableFacts).toContain('ein Termin steht an');
    expect(buildAmbientCopyMessages(context, [])[0].content)
      .toContain('Nur bei null verbleibenden Terminen');
    expect(fallback).not.toMatch(/wenig|überschaubar|Leerlauf|Sendepause|unentschlossen|Ruhe/i);
    expect(sanitizeAmbientLlmCopy(
      'Termine bleiben überschaubar. Der Nachmittag hat viel Zeit.', [], context,
    )).toBeNull();
  });

  it('liefert Temperatur ohne Kalender oder bei extremer Hitze über 32 Grad', () => {
    const free = analyzeAmbientContext([], weather({ temp: 28.9, condition: 'sunny' }), AFTERNOON);
    expect(free.weather.temperature).toBe(28.9);

    const hot = analyzeAmbientContext([
      event('Schwimmkurs Jamie', '2026-07-16T16:00:00+02:00', '2026-07-16T17:00:00+02:00'),
    ], weather({ temp: 32.1, condition: 'sunny' }), AFTERNOON);
    expect(hot.weather.temperature).toBe(32.1);
    expect(hot.notableFacts).toContain('extreme Hitze');
  });

  it('gibt unbekannten Terminen keine erfundene Kategorie', () => {
    const context = analyzeAmbientContext([
      event('Q3 Abstimmung', '2026-07-16T17:00:00+02:00', '2026-07-16T18:00:00+02:00'),
    ], NO_WEATHER, AFTERNOON);
    expect(context.nextEvent?.category).toBe('unknown');
  });

  it('erkennt einen wiederkehrenden Schwimmtermin auch an verschiedenen Tagen', () => {
    const days = [16, 17].map((day) => analyzeAmbientContext([
      event('Schwimmkurs Jamie', `2026-07-${day}T16:00:00+02:00`, `2026-07-${day}T17:00:00+02:00`),
    ], NO_WEATHER, new Date(`2026-07-${day}T15:00:00+02:00`)));
    expect(days.map((context) => context.nextEvent?.category)).toEqual(['swimming', 'swimming']);
    expect(days[0].date).not.toBe(days[1].date);
  });

  it('übergibt Kontext und letzte Botschaften, aber keine Terminliste', () => {
    const context = analyzeAmbientContext([], NO_WEATHER, AFTERNOON);
    const messages = buildAmbientCopyMessages(context, [
      'Der Kalender hält sich heute zurück.',
      'Der Nachmittag verwaltet den Restbestand.',
    ]);
    expect(messages.at(-1)?.content).toContain('"calendarLoad":"frei"');
    expect(messages.at(-1)?.content).toContain('Der Kalender hält sich heute zurück.');
    expect(messages[0].content).toContain('maximal zwei kurze Zeilen');
  });

  it('verwirft Wiederholungen, ähnliche Anfänge, Emojis und Überlänge', () => {
    const history = ['Der Kalender hält sich heute auffällig zurück.'];
    expect(sanitizeAmbientLlmCopy(history[0], history)).toBeNull();
    expect(sanitizeAmbientLlmCopy('Der Kalender hält sich weiterhin bedeckt.', history)).toBeNull();
    expect(sanitizeAmbientLlmCopy('Heute wird alles gut 🎉', [])).toBeNull();
    expect(sanitizeAmbientLlmCopy(Array.from({ length: 21 }, () => 'Wort').join(' '), [])).toBeNull();
    const timed = analyzeAmbientContext([
      event('Schwimmkurs', '2026-07-16T17:00:00+02:00', '2026-07-16T18:00:00+02:00'),
    ], NO_WEATHER, AFTERNOON);
    expect(sanitizeAmbientLlmCopy('Um 19:30 wird später geschwommen.', [], timed)).toBeNull();
    expect(sanitizeAmbientLlmCopy('Um 17:00 wird später geschwommen.', [], timed)).not.toBeNull();
    expect(sanitizeAmbientLlmCopy('Wenig Termine. Fast schon verdächtig.', history))
      .toEqual(['Wenig Termine. Fast schon verdächtig.']);
  });
});
