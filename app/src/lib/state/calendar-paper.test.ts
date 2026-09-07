import { describe, expect, it } from 'vitest';
import { calendarPaperColorId, calendarPaperColors } from './calendar-paper.ts';
import { DEFAULT_REMINDER_PERSONS } from './reminder-persons.ts';

const sources = [
  { entityId: 'calendar.launchtime', name: 'LaunchTime' },
  { entityId: 'calendar.geschaft', name: 'Geschäft' },
  { entityId: 'calendar.privat', name: 'Privat' },
  { entityId: 'calendar.kalender', name: 'Kalender' },
  { entityId: 'calendar.familie', name: 'Familie' },
];

describe('calendar paper colours (R17: five calendars, five papers)', () => {
  it('gives every source its own paper and keeps the residents’ papers for them', () => {
    const colors = calendarPaperColors(sources, DEFAULT_REMINDER_PERSONS);
    const ids = [...colors.values()];
    expect(new Set(ids).size).toBe(sources.length);
    const reserved = new Set(DEFAULT_REMINDER_PERSONS.map((person) => person.color));
    for (const id of ids) expect(reserved.has(id)).toBe(false);
  });

  it('is stable regardless of the order the sources arrive in', () => {
    const forward = calendarPaperColors(sources, DEFAULT_REMINDER_PERSONS);
    const backward = calendarPaperColors([...sources].reverse(), DEFAULT_REMINDER_PERSONS);
    expect([...backward.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it('lets a resident’s calendar wear the resident’s paper', () => {
    const colors = calendarPaperColors([{ entityId: 'calendar.sam', name: 'Sam' }], DEFAULT_REMINDER_PERSONS);
    expect(colors.get('calendar.sam')).toBe('gelb');
    expect(calendarPaperColorId('Sam', DEFAULT_REMINDER_PERSONS)).toBe('gelb');
  });
});
