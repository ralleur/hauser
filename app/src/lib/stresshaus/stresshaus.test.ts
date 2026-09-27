import { describe, expect, it } from 'vitest';
import { hostileHomeWith, TEMPLATES, type HostileHome } from './hostile-home.ts';
import { applyVariant, grossrundeScenarios, type HouseVariant } from './grossrunde.ts';
import { buildSetupHouseholdSuggestion } from '../config/setup-household.ts';
import { parseHouseholdConfig } from '../config/household-config.ts';
import { haToValue } from '../adapter/ha-entities.ts';
import { catalogItemFromHaState } from '../adapter/capabilities.ts';
import { buildRuntimeRooms, EMPTY_DEVICE_CONFIG, mergeCatalog, setDeviceVisibility } from '../state/device-config.ts';
import { groupAgendaDays, isValidCalendarEvent, projectAmbientWeek, projectCalendarWeeks, type CalendarEvent } from '../state/calendar.ts';
import type { RoomSeed } from '../state/app.svelte.ts';

/* Die schnelle Schicht des Stresshauses: gewürfelte Häuser durch Einrichtung
   und Gerätelogik, in Sekunden und bei jedem `npm run test`. Der Crawler
   (scripts/stresshaus/) prüft dieselben Häuser danach in der echten Oberfläche.

   Geprüft wird, was die Oberfläche als gegeben nimmt: eine Einrichtung, die
   aus jedem Home Assistant einen gültigen Haushalt macht; Optionslisten ohne
   Dubletten (sie werden zu Knöpfen mit dem Wert als Schlüssel); eindeutige
   Kachel-Ids je Raum. */

const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7919);
const NOW = new Date('2026-09-24T10:00:00+02:00');

function snapshotOf(home: HostileHome) {
  return {
    areas: home.areas,
    devices: home.devices,
    entities: home.entities,
    states: home.states.map((s) => ({ entity_id: s.entity_id, attributes: s.attributes })),
  };
}

/* Zahlen, die in der Oberfläche als „NaN" oder „Infinity" landen würden. */
function nonFinite(value: unknown, path = ''): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path || '(Wert)'];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => nonFinite(inner, path ? `${path}.${key}` : key));
}

function listsOf(value: unknown, path = ''): [string, unknown[]][] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return [[path, value]];
  return Object.entries(value).flatMap(([key, inner]) => listsOf(inner, path ? `${path}.${key}` : key));
}

describe('Stresshaus', () => {
  it.each(SEEDS)('Startzahl %i: die Einrichtung macht daraus einen gültigen Haushalt', (seed) => {
    const suggestion = buildSetupHouseholdSuggestion(snapshotOf(hostileHomeWith({ seed }, NOW)));
    const parsed = parseHouseholdConfig(suggestion.config);
    expect(parsed.ok ? [] : parsed.issues.slice(0, 3)).toEqual([]);
  });

  it.each(SEEDS)('Startzahl %i: Optionslisten der Geräte haben keine Dubletten', (seed) => {
    const home = hostileHomeWith({ seed }, NOW);
    const duplicates: string[] = [];
    for (const state of home.states) {
      let value: unknown;
      try {
        value = haToValue(state.entity_id, { state: state.state, attributes: state.attributes } as never);
      } catch (err) {
        duplicates.push(`${state.entity_id}: wirft ${String(err)}`);
        continue;
      }
      for (const [path, list] of listsOf(value)) {
        const keys = list.map((item) => (item && typeof item === 'object' ? JSON.stringify(item) : String(item)));
        if (new Set(keys).size !== keys.length) duplicates.push(`${state.entity_id}.${path}`);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it.each(SEEDS)('Startzahl %i: jede Kachel eines Raums hat ihre eigene Id', (seed) => {
    const home = hostileHomeWith({ seed }, NOW);
    const catalog = mergeCatalog([], home.states
      .map((s) => catalogItemFromHaState(s as never))
      .filter((item): item is NonNullable<typeof item> => item !== null));
    const rooms: RoomSeed[] = [{ id: 'alles', name: 'Alles', presence: false, windowOpen: false, lights: [] } as unknown as RoomSeed];
    let config = EMPTY_DEVICE_CONFIG;
    for (const item of catalog) config = setDeviceVisibility(config, item.entityId, true, 'alles');
    for (const room of buildRuntimeRooms(rooms, catalog, config)) {
      const ids = room.lights.map((light) => light.id);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    }
  });

  /* Großrunde, Einzelmacken: jede Geräteart, jedes Attribut, jeder schlechte
     Wert einzeln — und jeder schlechte Zustand ohne Attribute. */
  const BAD_VALUES: [string, unknown][] = [
    ['null', null], ['fehlt', undefined], ['Text', 'viel'], ['Komma-Zahl', '50,5'], ['riesig', 1e12], ['negativ', -1e9],
    ['Null', 0], ['NaN-Text', 'NaN'], ['leere Liste', []], ['Liste doppelt', ['a', 'a']], ['Objekt', {}], ['Wahrheitswert', true],
  ];
  const BAD_STATES = ['unavailable', 'unknown', '', 'blubb', '50,5'];
  const matrixCases = Object.entries(TEMPLATES).flatMap(([domain, template]) => [
    ...Object.keys(template.attributes).flatMap((key) => BAD_VALUES.map(([label, value]) => {
      const attributes: Record<string, unknown> = { ...structuredClone(template.attributes), friendly_name: 'x' };
      if (value === undefined) delete attributes[key]; else attributes[key] = structuredClone(value);
      return [`${domain}.${key} ${label}`, `${domain}.matrix`, template.state, attributes] as const;
    })),
    ...BAD_STATES.map((state) => [`${domain} Zustand „${state}"`, `${domain}.matrix`, state, {}] as const),
  ]);

  it(`Einzelmacken: ${matrixCases.length} Fälle überstehen Gerätelogik und Katalog ohne Dubletten`, () => {
    const problems: string[] = [];
    for (const [label, entityId, state, attributes] of matrixCases) {
      try {
        const value = haToValue(entityId, { state, attributes } as never);
        catalogItemFromHaState({ entity_id: entityId, state, attributes } as never);
        for (const [path, list] of listsOf(value)) {
          const keys = list.map((item) => (item && typeof item === 'object' ? JSON.stringify(item) : String(item)));
          if (new Set(keys).size !== keys.length) problems.push(`${label}: ${path} doppelt`);
        }
        for (const path of nonFinite(value)) problems.push(`${label}: ${path} ist keine endliche Zahl`);
      } catch (err) {
        problems.push(`${label}: wirft ${String(err)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each<[string, HouseVariant | null]>([['Großrunde', null], ['Großrunde, leeres Haus', 'leer'], ['Großrunde, alles nicht verfügbar', 'unavailable'], ['Großrunde, imperial', 'imperial']])(
    '%s: die Einrichtung macht daraus einen gültigen Haushalt',
    (_, variant) => {
      const home = hostileHomeWith({ seed: 42, scenarios: grossrundeScenarios(NOW) }, NOW);
      if (variant) applyVariant(home, variant);
      const parsed = parseHouseholdConfig(buildSetupHouseholdSuggestion(snapshotOf(home)).config);
      expect(parsed.ok ? [] : parsed.issues.slice(0, 3)).toEqual([]);
      if (!parsed.ok) return;
      /* Die Räume der Einrichtung tragen die Geräte: Reihenfolge und Anzeige
         schlagen je Raum-ID nach. Ein Raum „Constructor" brach hier. */
      const rooms = parsed.value.rooms.map((room) => ({ id: room.id, name: room.name, presence: false, windowOpen: false, lights: [] }) as unknown as RoomSeed);
      const catalog = mergeCatalog([], home.states.map((s) => catalogItemFromHaState(s as never)).filter((item): item is NonNullable<typeof item> => item !== null));
      expect(() => buildRuntimeRooms(rooms, catalog, EMPTY_DEVICE_CONFIG)).not.toThrow();
    },
  );

  it.each(SEEDS)('Startzahl %i: kein Termin bringt Wochenband, Kalender oder Agenda zu Fall', (seed) => {
    const home = hostileHomeWith({ seed }, NOW);
    const events: CalendarEvent[] = Object.values(home.calendarEvents).flat().map((item, index) => ({
      id: `${item.uid ?? 'ohne'}-${index}`, title: item.summary, start: item.start, end: item.end, allDay: !item.start.includes('T'),
      location: null, description: null,
    }));
    const kept = events.filter(isValidCalendarEvent);
    expect(kept.length).toBeLessThan(events.length);
    expect(() => projectAmbientWeek(kept, NOW)).not.toThrow();
    expect(() => projectCalendarWeeks(kept, NOW)).not.toThrow();
    expect(() => groupAgendaDays(kept, NOW)).not.toThrow();
  });

  it('ein hinzugefügtes Thermostat ist das Klima eines Raums ohne Klima, eine Wärmepumpe nicht', () => {
    const home = hostileHomeWith({}, NOW);
    const catalog = mergeCatalog([], home.states
      .map((s) => catalogItemFromHaState(s as never))
      .filter((item): item is NonNullable<typeof item> => item !== null));
    const rooms = [
      { id: 'buro', name: 'Büro', presence: false, windowOpen: false, lights: [] },
      { id: 'wintergarten', name: 'Wintergarten', presence: false, windowOpen: false, lights: [] },
      { id: 'bad', name: 'Bad', presence: false, windowOpen: false, lights: [], climateEntityId: 'climate.bad' },
    ] as unknown as RoomSeed[];
    let config = EMPTY_DEVICE_CONFIG;
    config = setDeviceVisibility(config, 'climate.vtherm_arbeitszimmer', true, 'buro');
    config = setDeviceVisibility(config, 'climate.waermepumpe_heizkreis', true, 'wintergarten');
    config = setDeviceVisibility(config, 'climate.wohnzimmer', true, 'bad');
    const built = new Map(buildRuntimeRooms(rooms, catalog, config).map((room) => [room.id, room]));
    expect(built.get('buro')?.climateEntityId).toBe('climate.vtherm_arbeitszimmer');
    expect(built.get('buro')?.lights.map((d) => d.entityId)).not.toContain('climate.vtherm_arbeitszimmer');
    expect(built.get('wintergarten')?.climateEntityId).toBeUndefined();
    expect(built.get('wintergarten')?.lights.map((d) => d.entityId)).toContain('climate.waermepumpe_heizkreis');
    expect(built.get('bad')?.climateEntityId).toBeUndefined();
    expect(built.get('bad')?.lights.map((d) => d.entityId)).toContain('climate.wohnzimmer');
  });
});
