// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overwriteGetLocale, type Locale } from '../../paraglide/runtime.js';
import { FakeBackend } from '../adapter/fake-backend.ts';
import { demoResponse, demoTodoSeed, translateDemoReminderTitles } from './demo-mode.ts';
import { demoSeeds } from './recording-mode.ts';
import { recordingCommute, recordingEvents } from './recording-data.ts';

vi.mock('./recording-mode.ts', async (original) => ({ ...await original<typeof import('./recording-mode.ts')>(), RECORDING_DEMO: true, IS_DEMO: true }));

afterEach(() => overwriteGetLocale(() => 'de'));

describe('demo content language', () => {
  it.each(['de', 'en', 'fr', 'it', 'pt', 'pl', 'nl', 'es'] as Locale[])(
    'uses German only for German and English otherwise (%s)', async (locale) => {
      overwriteGetLocale(() => locale);
      const german = locale === 'de';
      const events = recordingEvents('calendar.leo');
      expect(events[1].title).toBe(german ? 'Leo · Teamfrühstück' : 'Leo · Team breakfast');
      expect(recordingCommute().route!.reports[0].title).toBe(german ? 'Zähfließender Verkehr · A4' : 'Slow traffic · A4');
      expect(recordingCommute().config.places!.start.label).toContain(german ? 'Köln' : 'Cologne');
      const reminders = await demoResponse('/api/reminders', 'GET')!.json();
      expect(reminders.items.find((item: { id: string }) => item.id === 'demo-4').title)
        .toBe(german ? 'Mia - Pflanzen umtopfen' : 'Mia - Repot the plants');
      const household = await demoResponse('/api/household-config', 'GET')!.json();
      expect(household.rooms.find((room: { id: string }) => room.id === 'wohnzimmer').name)
        .toBe(german ? 'Wohnzimmer' : 'Living room');
    },
  );

  it('translates existing shopping entries on a language switch while keeping IDs, checks and added text', async () => {
    overwriteGetLocale(() => 'de');
    demoSeeds.todo = demoTodoSeed;
    const backend = new FakeBackend(new Map(), 0, [], demoTodoSeed());
    expect((await backend.getReminders('todo.walmart'))[0].title).toBe('Hafermilch');
    await backend.updateTodoItem('todo.walmart', 'demo-a1', true);
    await backend.addTodoItem('todo.walmart', 'Meine eigene Notiz');
    for (const locale of ['en', 'fr', 'de'] as Locale[]) {
      overwriteGetLocale(() => locale);
      const items = await backend.getReminders('todo.walmart');
      expect(items[0]).toMatchObject({ id: 'demo-a1', completed: true, title: locale === 'de' ? 'Hafermilch' : 'Oat milk' });
      expect(items.at(-1)!.title).toBe('Meine eigene Notiz');
    }
  });

  it('keeps completed reminders and custom text when translating existing tasks', () => {
    const items = [
      { id: 'hmi:family-reminders:demo-4', title: 'Mia - Pflanzen umtopfen', completed: true },
      { id: 'own-task', title: 'Meine eigene Aufgabe', completed: false },
    ];
    overwriteGetLocale(() => 'fr');
    const english = translateDemoReminderTitles(items);
    expect(english[0]).toEqual({ ...items[0], title: 'Mia - Repot the plants' });
    expect(english[1]).toEqual(items[1]);
    overwriteGetLocale(() => 'de');
    expect(translateDemoReminderTitles(english)).toEqual(items);
  });

  it('keeps a deleted reminder out of subsequent demo reads', async () => {
    expect(demoResponse('/api/reminders/demo-6', 'DELETE')!.ok).toBe(true);
    const reminders = await demoResponse('/api/reminders', 'GET')!.json();
    expect(reminders.items).not.toContainEqual(expect.objectContaining({ id: 'demo-6' }));
    expect(reminders.items).toContainEqual(expect.objectContaining({ id: 'demo-4' }));
  });
});
