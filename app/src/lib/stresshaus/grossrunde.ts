/* Die Großrunde des Stresshauses (Owner-Wunsch 2026-09-24): alles, was an
   Testfällen einfällt, in einem Lauf. Zusätzlich zu den festen Fällen in
   hostile-home.ts:

   - Matrix: jede Geräteart mit jeder Macke — ein Raum je Domain, darin je
     Macke ein Gerät (alles null, alles fehlt, Werte als Text, Null, negativ,
     riesig, Listen doppelt und voller Unsinn, riesige Listen, nicht verfügbar,
     alle Funktionen ohne passende Attribute, feindliche Namen).
   - Haushalt: vierzig weitere Räume, Raumnamen, die wie Routen oder
     JavaScript-Schlüssel heißen, Personen mit kaputten Koordinaten,
     Mediaplayer in jedem Zustand, Klima in jeder Betriebsart, Energie mit
     negativer Leistung und zurückgesetzten Zählern, dreihundert Termine und
     dreihundert Einkaufsposten, Termine über Mitternacht, Sommerzeit und
     Jahreswechsel.
   - Varianten ganzer Häuser: leer, alles nicht verfügbar, imperial.

   Nur löschbare TypeScript-Syntax (Node lädt die Datei ohne Build). */

import {
  TEMPLATES,
  type HostileCalendarEvent,
  type HostileHome,
  type HostileScenario,
  type HostileTodoItem,
} from './hostile-home.ts';

type Entity = NonNullable<HostileScenario['entities']>[number];
type Shape = { state: string; attributes: Record<string, unknown> };

const HOSTILE_NAME = '<b>Fett</b> — مصباح — 🔥 — ' + 'lang '.repeat(30);

function mapNumbers(value: unknown, fn: (n: number) => unknown): unknown {
  if (typeof value === 'number') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapNumbers(v, fn));
  return value;
}

function mapAttributes(shape: Shape, fn: (key: string, value: unknown) => unknown): Shape {
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(shape.attributes)) attributes[key] = fn(key, value);
  return { state: shape.state, attributes };
}

/** Macken, die ein ganzes Gerät auf einmal treffen — eine Kachel je Macke. */
export const PATHOLOGIES: Record<string, (shape: Shape) => Shape> = {
  'alles null': (s) => mapAttributes(s, () => null),
  'alles fehlt': (s) => ({ state: s.state, attributes: {} }),
  'Werte als Text': (s) => mapAttributes(s, (_, v) => mapNumbers(v, (n) => String(n).replace('.', ','))),
  'falsche Typen': (s) => mapAttributes(s, (_, v) => (typeof v === 'number' ? 'viel' : typeof v === 'string' ? 42 : Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? 'ja' : [v])),
  'alles Null': (s) => mapAttributes(s, (_, v) => mapNumbers(v, () => 0)),
  'negativ': (s) => mapAttributes(s, (_, v) => mapNumbers(v, (n) => -Math.abs(n) - 1)),
  'riesig': (s) => mapAttributes(s, (_, v) => mapNumbers(v, (n) => n * 1e9 + 1)),
  'Listen doppelt und Unsinn': (s) => mapAttributes(s, (_, v) => (Array.isArray(v) ? [...v, ...v, null, '', ' ', 7, {}, v[0]] : v)),
  'Listen riesig': (s) => mapAttributes(s, (_, v) => (Array.isArray(v) && typeof v[0] === 'string' ? Array.from({ length: 200 }, (_, i) => `Option ${i + 1}`) : v)),
  'nicht verfügbar': () => ({ state: 'unavailable', attributes: { restored: true } }),
  'unbekannt ohne Attribute': () => ({ state: 'unknown', attributes: {} }),
  'Zustand Unsinn': (s) => ({ state: 'blubb', attributes: s.attributes }),
  'alle Funktionen, keine Attribute': () => ({ state: 'on', attributes: { supported_features: 2 ** 31 - 1 } }),
};

function matrix(): HostileScenario {
  const areas: HostileScenario['areas'] = [];
  const entities: Entity[] = [];
  for (const [domain, template] of Object.entries(TEMPLATES)) {
    const area = `matrix_${domain}`;
    areas.push({ area_id: area, name: `Matrix ${domain}` });
    Object.entries(PATHOLOGIES).forEach(([name, pathology], index) => {
      const shaped = pathology(structuredClone(template));
      entities.push({
        entity_id: `${domain}.matrix_${index + 1}`,
        state: shaped.state,
        attributes: { ...shaped.attributes, friendly_name: index === 0 ? HOSTILE_NAME : `${domain}: ${name}` },
        area_id: area,
      });
    });
  }
  return { name: 'Matrix: jede Geräteart mit jeder Macke', warum: 'Jede Kachel und jedes Gerätedetail muss jede Form von Daten überstehen.', areas, entities };
}

function manyRooms(): HostileScenario {
  const areas = Array.from({ length: 40 }, (_, i) => ({ area_id: `raum_${String(i + 1).padStart(2, '0')}`, name: `Raum ${i + 1}` }));
  areas.push(
    { area_id: 'constructor', name: 'Constructor' },
    { area_id: '__proto__', name: '__proto__' },
    { area_id: 'home', name: 'Home' },
    { area_id: 'system', name: 'System' },
    { area_id: 'room', name: 'Room' },
    { area_id: 'hasownproperty', name: 'hasOwnProperty' },
  );
  const entities: Entity[] = areas.map((area, i) => ({
    entity_id: `light.viele_raeume_${i + 1}`, state: i % 2 ? 'on' : 'off',
    attributes: { friendly_name: `Licht ${area.name}`, brightness: 100, color_mode: 'brightness', supported_color_modes: ['brightness'] },
    area_id: area.area_id,
  }));
  return { name: 'Vierzig Räume und Namen wie Routen', warum: 'Raumauswahl blättert; Raum-IDs wie home, system, constructor oder __proto__ treffen Routen und Objektschlüssel.', areas, entities };
}

function people(): HostileScenario {
  const coords: [unknown, unknown][] = [[52.5, 13.4], [0, 0], ['52,5', '13,4'], [null, null], [91, 181], [-90, -180], ['', ''], [1e9, -1e9]];
  const entities: Entity[] = Array.from({ length: 20 }, (_, i) => ({
    entity_id: `person.leute_${i + 1}`,
    state: ['home', 'not_home', 'unknown', 'unavailable', 'Arbeit', 'Schule 🏫'][i % 6],
    attributes: {
      friendly_name: i % 5 === 0 ? 'Alex' : i % 7 === 0 ? '' : `Person ${i + 1}`,
      latitude: coords[i % coords.length][0], longitude: coords[i % coords.length][1], gps_accuracy: i * 1000,
      entity_picture: i % 3 === 0 ? 'https://nicht-erreichbar.invalid/bild.jpg' : i % 3 === 1 ? '/api/image/serve/kaputt/512x512' : null,
      user_id: i % 4 === 0 ? null : `user_${i}`,
    },
    noRegistry: true,
  }));
  return { name: 'Zwanzig Personen mit kaputten Orten', warum: 'Anwesenheit, Bewohnerauswahl und Stadtkarte mit Namensdubletten, ohne Bild und mit unmöglichen Koordinaten.', entities };
}

function media(): HostileScenario {
  const states = ['playing', 'paused', 'idle', 'off', 'on', 'standby', 'buffering', 'unavailable', 'unknown'];
  const entities: Entity[] = states.map((state, i) => ({
    entity_id: `media_player.zustand_${state}`, state,
    attributes: {
      friendly_name: `Player ${state}`, supported_features: i % 2 ? 152_463 : 0,
      media_title: i % 3 === 0 ? 'x'.repeat(500) : i % 3 === 1 ? '' : null,
      media_artist: i % 2 ? 'Künstler' : null, media_duration: i % 4 === 0 ? 0 : 300, media_position: i % 4 === 0 ? 900 : 12,
      media_position_updated_at: i % 2 ? 'gestern' : new Date(0).toISOString(),
      entity_picture: i % 2 ? '/api/media_player_proxy/weg' : 'https://nicht-erreichbar.invalid/cover.png',
      volume_level: [0, 1, 0.5, -1, 2, null][i % 6], is_volume_muted: i % 2 === 0,
      source_list: i % 2 ? ['A', 'A', 'B'] : null, source: 'C', group_members: i % 3 === 0 ? [`media_player.zustand_${state}`, 'media_player.gibt_es_nicht'] : undefined,
      media_content_type: ['music', 'video', 'tvshow', 'movie', 'playlist', 'unbekannt'][i % 6],
    },
    area_id: 'wohnzimmer',
  }));
  return { name: 'Mediaplayer in jedem Zustand', warum: 'Medien-Bildschirm, Kacheln und Detail mit jedem Wiedergabezustand, Position hinter dem Ende, Lautstärke außerhalb 0–1.', entities };
}

function climate(): HostileScenario {
  const modes = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];
  const entities: Entity[] = modes.map((mode, i) => ({
    entity_id: `climate.betriebsart_${mode}`, state: mode,
    attributes: {
      friendly_name: `Klima ${mode}`, hvac_modes: modes, hvac_action: ['heating', 'cooling', 'idle', 'off', 'drying', 'fan', 'preheating'][i],
      temperature: mode === 'heat_cool' ? null : 21, target_temp_low: mode === 'heat_cool' ? 23 : null, target_temp_high: mode === 'heat_cool' ? 19 : null,
      current_temperature: [21.5, null, -40, 99, '20,5', 0, 21][i], current_humidity: [45, 120, -5, null, 50, 50, 50][i],
      min_temp: i === 3 ? 30 : 7, max_temp: i === 3 ? 10 : 35, target_temp_step: [0.5, 0, 1, 0.1, null, 5, 0.01][i],
      preset_modes: ['none', 'eco', 'away', 'boost', 'comfort', 'home', 'sleep', 'activity'], preset_mode: 'boost',
      fan_modes: ['auto', 'low', 'medium', 'high', 'on', 'off', 'middle', 'focus', 'diffuse'], fan_mode: 'diffuse',
      supported_features: 511,
    },
    area_id: 'schlafzimmer',
  }));
  return { name: 'Klima in jeder Betriebsart', warum: 'Heizen, Kühlen, beides mit vertauschtem Bereich, Schrittweite null, Mindest- über Höchsttemperatur.', entities };
}

function energy(): HostileScenario {
  const entities: Entity[] = [
    { entity_id: 'sensor.pv_leistung', state: '-350', attributes: { friendly_name: 'PV (Einspeisung negativ)', unit_of_measurement: 'W', device_class: 'power', state_class: 'measurement' }, area_id: 'keller' },
    { entity_id: 'sensor.netz_leistung_kw', state: '3,2', attributes: { friendly_name: 'Netz in kW mit Komma', unit_of_measurement: 'kW', device_class: 'power', state_class: 'measurement' }, area_id: 'keller' },
    { entity_id: 'sensor.speicher_leistung_mw', state: '0.004', attributes: { friendly_name: 'Speicher in MW', unit_of_measurement: 'MW', device_class: 'power' }, area_id: 'keller' },
    { entity_id: 'sensor.leistung_ohne_einheit', state: '120', attributes: { friendly_name: 'Leistung ohne Einheit', device_class: 'power' }, area_id: 'keller' },
    { entity_id: 'sensor.zaehler_zurueckgesetzt', state: '0.01', attributes: { friendly_name: 'Zähler nach Reset', unit_of_measurement: 'kWh', device_class: 'energy', state_class: 'total_increasing', last_reset: new Date().toISOString() }, area_id: 'keller' },
    { entity_id: 'sensor.zaehler_wh', state: '1234567', attributes: { friendly_name: 'Zähler in Wh', unit_of_measurement: 'Wh', device_class: 'energy', state_class: 'total' }, area_id: 'keller' },
    { entity_id: 'sensor.leistung_unavailable', state: 'unavailable', attributes: { friendly_name: 'Leistung weg', unit_of_measurement: 'W', device_class: 'power' }, area_id: 'keller' },
    ...Array.from({ length: 40 }, (_, i): Entity => ({
      entity_id: `sensor.verbraucher_${i + 1}`, state: String([12, 0, 3500, -5, 99999][i % 5]),
      attributes: { friendly_name: i % 6 === 0 ? HOSTILE_NAME : `Verbraucher ${i + 1}`, unit_of_measurement: 'W', device_class: 'power', state_class: 'measurement' },
      area_id: i % 3 === 0 ? 'kuche' : null,
    })),
  ];
  return { name: 'Energie mit allem, was schiefgehen kann', warum: 'Negative Erzeugung, kW/MW/ohne Einheit, Komma-Zahlen, Zählerreset, vierzig Verbraucher mit einem Namen voller HTML.', entities };
}

function calendarFlood(now: Date): Record<string, HostileCalendarEvent[]> {
  const day = (offset: number, hour: number, minute = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };
  const events: HostileCalendarEvent[] = [];
  for (let i = 0; i < 300; i++) {
    const offset = (i % 9) - 1;
    const hour = i % 24;
    events.push({ start: day(offset, hour, (i * 13) % 60), end: day(offset, hour, ((i * 13) % 60) + 30), summary: `Termin ${i + 1}`, uid: `flut-${i}` });
  }
  events.push(
    { start: day(0, 12), end: day(0, 12), summary: 'Null Minuten', uid: 'null-minuten' },
    { start: day(0, 23, 59), end: day(1, 0, 1), summary: 'Über Mitternacht', uid: 'mitternacht' },
    { start: '2026-10-25T01:30:00+02:00', end: '2026-10-25T03:30:00+01:00', summary: 'Sommerzeitende', uid: 'dst' },
    { start: '2026-12-31T23:00:00+01:00', end: '2027-01-01T01:00:00+01:00', summary: 'Jahreswechsel', uid: 'silvester' },
    { start: day(-20, 0).slice(0, 10), end: day(20, 0).slice(0, 10), summary: 'Vierzig Tage ganztags', uid: 'lang' },
    { start: day(0, 9) + 'Z-kaputt', end: day(0, 10), summary: 'Kaputter Beginn', uid: 'kaputt' },
    { start: day(1, 10).replace('Z', '+14:00'), end: day(1, 11).replace('Z', '-12:00'), summary: 'Zeitzonen am Rand', uid: 'zonen' },
  );
  return { 'calendar.familie': events };
}

function todoFlood(): Record<string, HostileTodoItem[]> {
  return {
    'todo.einkaufsliste': Array.from({ length: 300 }, (_, i): HostileTodoItem => ({
      uid: i % 50 === 0 ? 'doppelt' : `posten-${i}`,
      summary: i % 40 === 0 ? 'x'.repeat(2000) : i % 33 === 0 ? '' : `Posten ${i + 1}`,
      status: i % 3 === 0 ? 'completed' : 'needs_action',
      ...(i % 7 === 0 ? { due: ['2026-02-30', '2026-09-24', 'bald', '2026-09-24T10:00:00Z'][i % 4] } : {}),
      ...(i % 11 === 0 ? { description: '**Markdown** <script>x</script>\n'.repeat(20) } : {}),
    })),
  };
}

/** Alles, was die Großrunde zusätzlich ins Stresshaus legt. */
export function grossrundeScenarios(now: Date = new Date()): HostileScenario[] {
  return [
    matrix(),
    manyRooms(),
    people(),
    media(),
    climate(),
    energy(),
    { name: 'Dreihundert Termine und Grenzfälle der Zeit', warum: 'Wochenband, Agenda und Ruhebild mit Flut, Nullminuten, Mitternacht, Sommerzeit, Jahreswechsel, kaputtem Beginn.', calendarEvents: calendarFlood(now), entities: [] },
    { name: 'Dreihundert Einkaufsposten', warum: 'Liste mit Dubletten, 2000 Zeichen, leeren Posten, unmöglichen Fälligkeiten.', todoItems: todoFlood(), entities: [] },
  ];
}

export type HouseVariant = 'leer' | 'unavailable' | 'imperial';

/** Ganze Häuser anders: leer, alles nicht verfügbar, imperial. */
export function applyVariant(home: HostileHome, variant: HouseVariant): HostileHome {
  if (variant === 'leer') {
    home.areas = [];
    home.devices = [];
    home.states = home.states.filter((s) => s.entity_id === 'sun.sun' || s.entity_id === 'zone.home');
    home.entities = [];
    home.calendarEvents = {};
    home.todoItems = {};
  } else if (variant === 'unavailable') {
    for (const s of home.states) {
      if (s.entity_id === 'sun.sun' || s.entity_id === 'zone.home') continue;
      s.state = 'unavailable';
      s.attributes = { friendly_name: s.attributes.friendly_name, restored: true };
    }
  } else if (variant === 'imperial') {
    home.config = { ...home.config, unit_system: { length: 'mi', accumulated_precipitation: 'in', mass: 'lb', pressure: 'psi', temperature: '°F', volume: 'gal', wind_speed: 'mph' }, currency: 'USD', country: 'US', language: 'en', time_zone: 'America/St_Johns' };
    for (const s of home.states) {
      if (s.attributes.unit_of_measurement === '°C') {
        s.attributes.unit_of_measurement = '°F';
        const n = Number(s.state);
        if (Number.isFinite(n)) s.state = String(Math.round((n * 9 / 5 + 32) * 10) / 10);
      }
      for (const key of ['temperature', 'current_temperature', 'min_temp', 'max_temp', 'target_temp_low', 'target_temp_high']) {
        const v = s.attributes[key];
        if (typeof v === 'number') s.attributes[key] = Math.round(v * 9 / 5 + 32);
      }
    }
  }
  return home;
}
