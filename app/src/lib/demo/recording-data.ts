// SPDX-License-Identifier: AGPL-3.0-only
import type { CalendarEvent, CalendarSource } from '../state/calendar.ts';
import type { CommuteStatus, MapPoint } from '../state/commute.ts';
import { RECORDING_HOME_COORDS } from './recording-mode.ts';
import { demoText } from './demo-locale.ts';

export const RECORDING_PEOPLE = [
  { id: 'mia', label: 'Mia', color: 'gruen' },
  { id: 'leo', label: 'Leo', color: 'gelb' },
  { id: 'emma', label: 'Emma', color: 'rosa' },
  { id: 'beide', label: null, color: 'gelbgruen' },
];
export const RECORDING_HOME = { get label() { return demoText('Neumarkt 1, 50667 Köln', 'Neumarkt 1, 50667 Cologne'); }, ...RECORDING_HOME_COORDS }; // i18n-ignore: bilingual demo data
export const RECORDING_WORK = { label: 'Demo Studio, Alter Posthof 1, 52062 Aachen', latitude: 50.7725, longitude: 6.0857 };

export function recordingCalendars(): CalendarSource[] {
  return RECORDING_PEOPLE.filter(person => person.label).map(person => ({ entityId: `calendar.${person.id}`, name: person.label! }));
}

export function recordingEvents(entityId: string, now = new Date()): CalendarEvent[] {
  const person = RECORDING_PEOPLE.find(person => `calendar.${person.id}` === entityId);
  if (!person?.label) return [];
  const at = (day: number, hour: number) => {
    const date = new Date(now); date.setDate(date.getDate() + day); date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const titles: Record<string, string[]> = {
    mia: ['Mia · Yoga', demoText('Mia · Projektbesprechung', 'Mia · Project meeting'), demoText('Mia · Kaffee mit Freunden', 'Mia · Coffee with friends')],
    leo: [demoText('Leo · Fahrradtour', 'Leo · Bike ride'), demoText('Leo · Teamfrühstück', 'Leo · Team breakfast'), demoText('Leo · Kochabend', 'Leo · Cooking night')], // i18n-ignore: bilingual demo data
    emma: [demoText('Emma · Schwimmkurs', 'Emma · Swim class'), demoText('Emma · Musikstunde', 'Emma · Music lesson'), demoText('Emma · Spieleabend', 'Emma · Games night')],
  };
  return Array.from({ length: 6 }, (_, week) => titles[person.id].map((title, index) => ({
    id: `demo-${person.id}-${week}-${index}`, title,
    start: at(week * 7 + index, 10 + index * 3), end: at(week * 7 + index, 11 + index * 3),
    allDay: false, location: index === 1 && person.id !== 'emma' ? RECORDING_WORK.label : demoText('Köln', 'Cologne'), description: null, // i18n-ignore: bilingual demo data
  }))).flat();
}

/** Synthetic road geometry and traffic; no route service or personal location. */
export function recordingCommute(now = new Date()): CommuteStatus {
  const line: MapPoint[] = [[920, 110], [890, 160], [820, 210], [735, 240], [650, 310], [555, 340], [470, 420], [380, 450], [280, 520], [190, 600], [120, 640]];
  return {
    config: { entryId: 'demo-koeln-aachen', days: [1, 2, 3, 4, 5], from: '06:00', until: '09:00', arrival: '08:30', showRain: true, places: { start: RECORDING_HOME, destination: RECORDING_WORK } },
    route: {
      name: demoText('Köln → Aachen · Demo Studio', 'Cologne → Aachen · Demo Studio'), durationMinutes: 58, delayMinutes: 6, updatedAt: now.toISOString(), // i18n-ignore: bilingual demo data
      line, roads: [line, [[800, 70], [820, 210], [900, 380]], [[220, 350], [380, 450], [430, 680]]],
      sections: [{ points: line.slice(4, 7), severe: false, category: 'slow' }],
      reports: [{ title: demoText('Zähfließender Verkehr · A4', 'Slow traffic · A4'), category: 'slow', delay: 6, point: line[5] }], rainAt: null, // i18n-ignore: bilingual demo data
    },
  };
}
