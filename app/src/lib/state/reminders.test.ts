import { describe, expect, it } from 'vitest';
import {
  openReminders,
  postitDueLabel,
  projectPostits,
  reminderListMessage,
  reminderOverdue,
  reminderRowsByPerson,
  selectReminderLists,
  type Reminder,
  type ReminderSource,
} from './reminders.ts';

const NOW = new Date('2026-07-13T12:00:00+02:00');

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r-1',
    title: 'Milch kaufen',
    due: null,
    completed: false,
    description: null,
    ...overrides,
  };
}

describe('reminderListMessage', () => {
  it('baut den todo/item/list-WS-Befehl für die Liste', () => {
    expect(reminderListMessage('todo.einkaufsliste')).toEqual({
      type: 'todo/item/list',
      entity_id: 'todo.einkaufsliste',
    });
  });
});

describe('selectReminderLists', () => {
  const sources: ReminderSource[] = [
    { entityId: 'todo.einkaufsliste', name: 'Einkaufsliste' },
    { entityId: 'todo.haushalt', name: 'Haushalt' },
  ];

  it('zeigt ohne gespeicherte Auswahl (null) keine Liste — Opt-in', () => {
    expect(selectReminderLists(sources, null)).toEqual([]);
  });

  it('leere Auswahl bleibt leer', () => {
    expect(selectReminderLists(sources, [])).toEqual([]);
  });

  it('filtert auf die gewählten, existierenden Listen', () => {
    const result = selectReminderLists(sources, ['todo.haushalt', 'todo.weg']);
    expect(result.map((s) => s.entityId)).toEqual(['todo.haushalt']);
  });
});

describe('openReminders', () => {
  it('lässt erledigte Einträge weg', () => {
    const items = [reminder({ id: 'a' }), reminder({ id: 'b', completed: true })];
    expect(openReminders(items).map((r) => r.id)).toEqual(['a']);
  });

  it('sortiert nach Fälligkeit, ohne Termin ans Ende, gleichauf alphabetisch', () => {
    const items = [
      reminder({ id: 'ohne', title: 'Zebra', due: null }),
      reminder({ id: 'spät', title: 'Anton', due: '2026-07-20T10:00:00+02:00' }),
      reminder({ id: 'früh', title: 'Berta', due: '2026-07-14T10:00:00+02:00' }),
      reminder({ id: 'ohne2', title: 'Anna', due: null }),
    ];
    expect(openReminders(items).map((r) => r.id)).toEqual(['früh', 'spät', 'ohne2', 'ohne']);
  });
});

describe('reminderOverdue', () => {
  it('ohne Fälligkeit nie überfällig', () => {
    expect(reminderOverdue(reminder({ due: null }), NOW)).toBe(false);
  });

  it('vergangener Zeitpunkt ist überfällig', () => {
    expect(reminderOverdue(reminder({ due: '2026-07-13T08:00:00+02:00' }), NOW)).toBe(true);
  });

  it('künftiger Zeitpunkt ist nicht überfällig', () => {
    expect(reminderOverdue(reminder({ due: '2026-07-13T18:00:00+02:00' }), NOW)).toBe(false);
  });

  it('reines Datum gilt bis zum Tagesende als nicht überfällig', () => {
    expect(reminderOverdue(reminder({ due: '2026-07-13' }), NOW)).toBe(false);
    expect(reminderOverdue(reminder({ due: '2026-07-12' }), NOW)).toBe(true);
  });
});

describe('postitDueLabel', () => {
  it('ohne Termin kein Label', () => {
    expect(postitDueLabel(reminder({ due: null }), NOW)).toBe(null);
  });

  it('Überfälliges schlägt jede andere Angabe', () => {
    expect(postitDueLabel(reminder({ due: '2026-07-13T08:00:00+02:00' }), NOW)).toBe('Überfällig');
  });

  it('heute mit Uhrzeit zeigt die Zeit, morgen „Morgen"', () => {
    expect(postitDueLabel(reminder({ due: '2026-07-13T18:00:00+02:00' }), NOW)).toBe('18:00');
    expect(postitDueLabel(reminder({ due: '2026-07-14T09:00:00+02:00' }), NOW)).toBe('Morgen');
  });

  it('reines heutiges Datum zeigt „Heute", fernes ein kurzes Datum', () => {
    expect(postitDueLabel(reminder({ due: '2026-07-13' }), NOW)).toBe('Heute');
    expect(postitDueLabel(reminder({ due: '2026-08-01' }), NOW)).toBe('1 Aug');
  });
});

describe('projectPostits', () => {
  it('zeigt zentral geplante Erinnerungen erst ab ihrem Datum auf dem Lockscreen', () => {
    const items = [
      reminder({ id: 'hmi:family-reminders:future', due: '2026-07-14' }),
      reminder({ id: 'hmi:family-reminders:today', due: '2026-07-13' }),
      reminder({ id: 'todo.apple:future', due: '2026-07-14' }),
    ];
    expect(projectPostits(items, NOW).items.map((item) => item.id)).toEqual([
      'hmi:family-reminders:today', 'todo.apple:future',
    ]);
  });

  it('deckelt auf max und zählt den Rest als more', () => {
    const items = Array.from({ length: 6 }, (_, i) => reminder({ id: `r-${i}`, title: `Sache ${i}` }));
    const result = projectPostits(items, NOW, 4);
    expect(result.items).toHaveLength(4);
    expect(result.more).toBe(2);
  });

  it('lässt erledigte weg und markiert Überfälliges', () => {
    const items = [
      reminder({ id: 'done', completed: true }),
      reminder({ id: 'over', due: '2026-07-10T08:00:00+02:00' }),
    ];
    const result = projectPostits(items, NOW);
    expect(result.items.map((p) => p.id)).toEqual(['over']);
    expect(result.items[0].overdue).toBe(true);
  });
});

describe('reminderRowsByPerson', () => {
  it('gruppiert nach Person und trennt offen/erledigt', () => {
    const rows = reminderRowsByPerson([
      reminder({ id: '1', title: 'Sam - a' }),
      reminder({ id: '2', title: 'Alex - b', completed: true }),
      reminder({ id: '3', title: 'ohne Präfix' }),
    ]);
    expect(rows.sam.open.map((r) => r.id)).toEqual(['1']);
    expect(rows.alex.done.map((r) => r.id)).toEqual(['2']);
    expect(rows.beide.open.map((r) => r.id)).toEqual(['3']);
  });

  it('sortiert offene nach Alter (älteste zuerst), ohne created ans Ende', () => {
    const rows = reminderRowsByPerson([
      reminder({ id: 'neu', title: 'Sam - neu', created: '2026-07-10T08:00:00Z' }),
      reminder({ id: 'alt', title: 'Sam - alt', created: '2026-07-01T08:00:00Z' }),
      reminder({ id: 'ohne', title: 'Sam - ohne Stempel' }),
    ]);
    expect(rows.sam.open.map((r) => r.id)).toEqual(['alt', 'neu', 'ohne']);
  });

  it('sortiert erledigte nach Erledigungszeitpunkt (frisch zuerst) und deckelt', () => {
    const rows = reminderRowsByPerson([
      reminder({ id: 'd1', title: 'Sam - d1', completed: true, edited: '2026-07-01T08:00:00Z' }),
      reminder({ id: 'd2', title: 'Sam - d2', completed: true, edited: '2026-07-14T08:00:00Z' }),
      reminder({ id: 'd3', title: 'Sam - d3', completed: true, edited: '2026-07-07T08:00:00Z' }),
    ], 2);
    expect(rows.sam.done.map((r) => r.id)).toEqual(['d2', 'd3']);
  });
});
