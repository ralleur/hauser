import { localDayKey, type CalendarEvent } from './calendar.ts';
import type { OutdoorReading } from './weather.ts';


export type AmbientCopyStyle = 'calendar' | 'wordplay' | 'weather' | 'daypart';
export type AmbientCopy = {
  lines: readonly [string] | readonly [string, string];
  style: AmbientCopyStyle;
};

type CopyTemplate = readonly [string] | readonly [string, string];
type Daypart = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
const EXTREME_HEAT_C = 32;
const EXTREME_COLD_C = 5;

const weekdayLongFormatter = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });

const WORDPLAY_RULES: readonly {
  pattern: RegExp;
  outdoor: boolean;
  templates: readonly CopyTemplate[];
}[] = [
  {
    pattern: /schwimm|wasserball|freibad|hallenbad/i,
    outdoor: false,
    templates: [
      ['Der Tag hat später noch ein paar Bahnen vor sich.', 'Bis dahin bleibt alles ruhig.'],
      ['Heute läuft alles. Später schwimmt es.'],
      ['Bis später bleiben wir entspannt über Wasser.'],
    ],
  },
  {
    pattern: /ferien|urlaub|feiertag/i,
    outdoor: false,
    templates: [
      ['Der Kalender trägt jetzt kurze Hose.'],
      ['Die Zeit verliert langsam ihre Wochentage.'],
      ['Die organisierte Planlosigkeit beginnt.'],
    ],
  },
  {
    pattern: /kirmes|jahrmarkt|rummel|volksfest/i,
    outdoor: true,
    templates: [
      ['Heute Abend dreht sich alles.'],
      ['Der Tag fährt sich schon einmal warm.'],
      ['Später wird kontrolliert die Orientierung verloren.'],
    ],
  },
  {
    pattern: /bummel|shopping|spazier|flanier/i,
    outdoor: true,
    templates: [
      ['Heute wird zielgerichtet ziellos herumgelaufen.'],
      ['Effizienz wurde vorsorglich informiert.'],
      ['Der Tag hat später noch etwas Leerlauf mit Richtung.'],
    ],
  },
  {
    pattern: /einkauf|supermarkt|drogerie|baumarkt|besorgung|erledigung/i,
    outdoor: false,
    templates: [
      ['Später wird der Alltag fachgerecht eingesammelt.'],
      ['Die Erledigungen haben einen Termin beantragt.'],
      ['Der Tag führt später noch eine kleine Bestandsaufnahme durch.'],
    ],
  },
  {
    pattern: /ausflug|zoo|park|wandern|spielplatz|fahrrad|radtour|garten|grill|camping/i,
    outdoor: true,
    templates: [
      ['Der Tag möchte später offenbar noch vor die Tür.'],
      ['Draußen wurde vorsorglich etwas Zeit reserviert.'],
      ['Der Kalender plant heute mit Frischluft.'],
    ],
  },
  {
    pattern: /kita|schule|elternabend|familie|kinder|geburtstag/i,
    outdoor: false,
    templates: [
      ['Der Familienbetrieb hat später noch einen Programmpunkt.'],
      ['Der Kalender arbeitet heute wieder familiengeführt.'],
      ['Später tagt die zuständige Familienabteilung.'],
    ],
  },
];

const OUTDOOR_PATTERN = /ausflug|zoo|park|wandern|spielplatz|fahrrad|radtour|garten|grill|camping|kirmes|jahrmarkt|rummel|volksfest|bummel|spazier|flanier|freibad/i;

const CALENDAR_TEMPLATES = {
  none: [
    ['Der Kalender hält sich heute auffällig zurück.'],
    ['Wenig Termine. Genau genommen gar keine.'],
    ['Heute passiert wenig. Zumindest offiziell.'],
  ],
  few: [
    ['Der Kalender hat heute einen klaren Auftrag.'],
    ['Die Tagesordnung ist kurz, aber nicht arbeitslos.'],
    ['Der Tag hat seine Punkte auf der Tagesordnung.'],
  ],
  many: [
    ['Der Kalender hat heute Redebedarf.'],
    ['Viel vor. Der Optimismus ist bemerkenswert.'],
    ['Die Termine haben den Tag unter sich aufgeteilt.'],
  ],
  dense: [
    ['Der Kalender arbeitet heute ohne nennenswerte Lücken.'],
    ['Die Termine laufen heute im Takt.'],
    ['Der Kalender hat die Pausen vorsorglich gestrichen.'],
  ],
  soon: [
    ['Der nächste Termin steht schon in der Tür.'],
    ['Der Kalender wird in Kürze konkret.'],
    ['Der nächste Termin duldet keinen langen Anlauf.'],
  ],
  gap: [
    ['Der nächste Termin steht später an.'],
    ['Der Kalender bleibt bis dahin im Bereitschaftsdienst.'],
    ['Der nächste Termin ist später. Der Tag läuft trotzdem.'],
  ],
  done: [
    ['Der Kalender hat für heute Feierabend.'],
    ['Die offiziellen Termine sind für heute erledigt.'],
    ['Der geplante Teil des Tages ist durch.'],
  ],
} as const satisfies Record<string, readonly CopyTemplate[]>;

const DAYPART_TEMPLATES: Record<Daypart, readonly CopyTemplate[]> = {
  morning: [
    ['Der Tag ist frisch. Die Menschen noch nicht.'],
    ['Heute ist noch alles möglich. Leider auch alles andere.'],
    ['Der Morgen nimmt langsam den Betrieb auf.'],
  ],
  midday: [
    ['Die Hälfte ist geschafft. Welche Hälfte, bleibt unklar.'],
    ['Der Vormittag wurde erfolgreich verbraucht.'],
    ['Der Tag macht kurz Inventur.'],
  ],
  afternoon: [
    ['Der Tag ist noch offen. Aber nicht mehr weit.'],
    ['Zu spät für einen Neustart, früh genug für Kaffee.'],
    ['Der Nachmittag sammelt langsam die offenen Punkte ein.'],
  ],
  evening: [
    ['Der Tag räumt langsam seine Sachen zusammen.'],
    ['Heute passiert nur noch, was wirklich sein muss.'],
    ['Der Kalender hat Feierabend. Der Rest folgt hoffentlich.'],
  ],
  night: [
    ['Der Tag ist offiziell nicht mehr zuständig.'],
    ['Der Kalender schläft bereits. Vernünftige Entscheidung.'],
    ['Für heute ist die Tagesordnung geschlossen.'],
  ],
};

export function daypartLabel(now: Date): string {
  const part = daypart(now);
  return `${weekdayLongFormatter.format(now)}${part.suffix}`;
}

function daypart(now: Date): { id: Daypart; suffix: string } {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return { id: 'morning', suffix: 'morgen' };
  if (hour >= 11 && hour < 14) return { id: 'midday', suffix: 'mittag' };
  if (hour >= 14 && hour < 18) return { id: 'afternoon', suffix: 'nachmittag' };
  if (hour >= 18 && hour < 23) return { id: 'evening', suffix: 'abend' };
  return { id: 'night', suffix: 'nacht' };
}

function startOfDay(now: Date): Date {
  const result = new Date(now);
  result.setHours(0, 0, 0, 0);
  return result;
}

function eventsForDay(events: readonly CalendarEvent[], now: Date): CalendarEvent[] {
  const start = startOfDay(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [...events]
    .filter((event) => new Date(event.end) > start && new Date(event.start) < end)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

function eventPhase(event: CalendarEvent, now: Date): 'past' | 'now' | 'upcoming' {
  if (new Date(event.end) <= now) return 'past';
  if (new Date(event.start) <= now) return 'now';
  return 'upcoming';
}

function weatherSignature(weather: OutdoorReading): string {
  const temp = weather.temp === null ? '-' : String(Math.round(weather.temp));
  const delta = weather.tempDelta === null ? '-'
    : weather.tempDelta >= 2 ? 'up' : weather.tempDelta <= -2 ? 'down' : 'steady';
  const wind = weather.windSpeed === null ? '-' : weather.windSpeed >= 30 ? 'windy' : 'calm';
  return `${temp},${weather.condition ?? '-'},${delta},${wind}`;
}

/* Der Schlüssel enthält den Stunden-Slot sowie nur textrelevante Datenklassen.
   Normale UI-Refreshes und kleine Messwertschwankungen würfeln daher nicht neu;
   Terminstatus, Wetterklasse oder die nächste Stunde dürfen variieren. */
export function ambientCopyKey(
  events: readonly CalendarEvent[],
  weather: OutdoorReading,
  now: Date,
): string {
  const state = eventsForDay(events, now).map((event) =>
    `${event.id}@${eventPhase(event, now)}@${event.title.toLocaleLowerCase('de-DE')}`,
  ).join('|');
  return `${localDayKey(now)}@${now.getHours()}@${state}@${weatherSignature(weather)}`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function pick(templates: readonly CopyTemplate[], key: string): CopyTemplate {
  return templates[hash(key) % templates.length];
}

function matchingWordplay(events: readonly CalendarEvent[]): typeof WORDPLAY_RULES[number] | null {
  for (const event of events) {
    const rule = WORDPLAY_RULES.find((candidate) => candidate.pattern.test(event.title));
    if (rule) return rule;
  }
  return null;
}

function hasOutdoorEvent(events: readonly CalendarEvent[]): boolean {
  return events.some((event) => OUTDOOR_PATTERN.test(event.title));
}

function weatherTemplate(
  events: readonly CalendarEvent[],
  weather: OutdoorReading,
  key: string,
): { template: CopyTemplate; combined: boolean } | null {
  const outdoor = hasOutdoorEvent(events);
  const hot = weather.temp !== null && weather.temp >= 28;
  const cold = weather.temp !== null && weather.temp <= 5;
  const rainy = weather.condition === 'rainy';
  const snowy = weather.condition === 'snowy';
  const sunny = weather.condition === 'sunny';
  const windy = weather.windSpeed !== null && weather.windSpeed >= 30;
  const warming = weather.tempDelta !== null && weather.tempDelta >= 2;
  const cooling = weather.tempDelta !== null && weather.tempDelta <= -2;
  const combined = outdoor && (hot || cold || rainy || snowy || sunny || windy);

  if (hot && outdoor) {
    return { template: [`${Math.round(weather.temp as number)} Grad. Heute bitte nur Termine mit Schatten.`], combined };
  }
  if (rainy && outdoor) {
    return { template: ['Der Kalender empfiehlt Bewegung.', 'Der Regen widerspricht.'], combined };
  }
  if (snowy && outdoor) {
    return { template: ['Der Kalender plant draußen.', 'Der Schnee plant zusätzliche Zeit ein.'], combined };
  }
  if (windy && outdoor) {
    return { template: ['Der Außentermin bekommt heute ungefragte Rückenunterstützung.'], combined };
  }
  if (cold && outdoor) {
    return { template: ['Der Kalender plant draußen.', 'Die Temperatur plant Gegenmaßnahmen.'], combined };
  }
  if (sunny && outdoor) {
    return { template: ['Das Wetter hat einen Vorschlag.', 'Der Kalender keinen Einwand.'], combined };
  }
  if (rainy) {
    return { template: pick([
      ['Regen. Der Tag bleibt lieber in der Nähe einer Steckdose.'],
      ['Draußen wird heute konsequent nass gearbeitet.'],
      ['Der Regen übernimmt den Außendienst.'],
    ], `${key}:rain`), combined: false };
  }
  if (snowy) {
    return { template: ['Schnee. Der Tag kalkuliert vorsorglich mit Umwegen.'], combined: false };
  }
  if (hot) {
    return { template: [`${Math.round(weather.temp as number)} Grad. Der Tag läuft heute im Schonprogramm.`], combined: false };
  }
  if (cold) {
    return { template: [`${Math.round(weather.temp as number)} Grad. Der Tag bleibt besser in Griffweite einer Heizung.`], combined: false };
  }
  if (windy) {
    return { template: ['Der Wind sortiert draußen heute selbstständig um.'], combined: false };
  }
  if (warming) {
    return { template: ['Die Temperatur legt heute auffällig schnell zu.'], combined: false };
  }
  if (cooling) {
    return { template: ['Die Temperatur zieht sich heute auffällig schnell zurück.'], combined: false };
  }
  if (sunny) {
    return { template: events.length
      ? ['Draußen Sonne, drinnen Termine.']
      : pick([
        ['Draußen Sonne. Der Kalender hält sich bedeckt.'],
        ['Das Wetter hat einen Vorschlag.', 'Der Kalender ist heute flexibel.'],
      ], `${key}:sun`), combined: false };
  }
  return null;
}

function calendarTemplate(events: readonly CalendarEvent[], now: Date, key: string): CopyTemplate {
  if (events.length === 0) return pick(CALENDAR_TEMPLATES.none, `${key}:none`);

  const phases = events.map((event) => eventPhase(event, now));
  if (phases.every((phase) => phase === 'past')) return pick(CALENDAR_TEMPLATES.done, `${key}:done`);

  const upcoming = events.filter((event) => eventPhase(event, now) === 'upcoming');
  const gaps = upcoming.slice(1).map((event, index) =>
    new Date(event.start).getTime() - new Date(upcoming[index].end).getTime(),
  );
  const dense = upcoming.length >= 3 && gaps.some((gap) => gap <= 45 * 60 * 1000);
  if (dense) return pick(CALENDAR_TEMPLATES.dense, `${key}:dense`);
  if (events.length >= 4) return pick(CALENDAR_TEMPLATES.many, `${key}:many`);

  const next = upcoming[0];
  if (next) {
    const slotStart = new Date(now);
    slotStart.setMinutes(0, 0, 0);
    const wait = new Date(next.start).getTime() - slotStart.getTime();
    if (wait <= 90 * 60 * 1000) return pick(CALENDAR_TEMPLATES.soon, `${key}:soon`);
    if (wait >= 4 * 60 * 60 * 1000) return pick(CALENDAR_TEMPLATES.gap, `${key}:gap`);
  }
  return pick(CALENDAR_TEMPLATES.few, `${key}:few`);
}

export function generateAmbientCopy(
  events: readonly CalendarEvent[],
  weather: OutdoorReading,
  now = new Date(),
): AmbientCopy {
  const today = eventsForDay(events, now);
  const relevant = today.filter((event) => eventPhase(event, now) !== 'past');
  const key = ambientCopyKey(events, weather, now);
  const weatherChoice = weatherTemplate(relevant, weather, key);
  const wordplay = matchingWordplay(relevant);

  /* Auffällige Wetter-/Termin-Kombination vor klarem Wortspiel, danach
     eigenständiges auffälliges Wetter und schließlich Kalenderauslastung. */
  if (weatherChoice?.combined) return { lines: weatherChoice.template, style: 'weather' };
  if (wordplay) {
    return { lines: pick(wordplay.templates, `${key}:wordplay`), style: 'wordplay' };
  }
  if (weatherChoice) return { lines: weatherChoice.template, style: 'weather' };

  const hasWeather = weather.temp !== null || weather.condition !== null
    || weather.windSpeed !== null || weather.tempDelta !== null;
  if (today.length > 0 || hasWeather) {
    return { lines: calendarTemplate(today, now, key), style: 'calendar' };
  }
  return { lines: pick(DAYPART_TEMPLATES[daypart(now).id], `${key}:daypart`), style: 'daypart' };
}

export type EventCategory = 'swimming' | 'holiday' | 'fair' | 'errand' | 'outdoor' | 'family' | 'unknown';
export interface AmbientAnalysis {
  date: string;
  weekday: string;
  time: string;
  dayPeriod: string;
  calendarLoad: 'frei' | 'belegt' | 'belebt' | 'dicht';
  nextEvent: { id: string; title: string; time: string | null; category: EventCategory; running: boolean } | null;
  remainingEvents: number;
  weather: { condition: string | null; temperature: number | null; trend: string | null };
  notableFacts: string[];
  /* Nur für Trigger-/Validierungslogik, nicht als vollständige Agenda gedacht. */
  eventState: string;
}

interface ChatMessage { role: 'system' | 'user'; content: string }

const CATEGORY_RULES: readonly { category: EventCategory; pattern: RegExp; fact: string }[] = [
  { category: 'swimming', pattern: /schwimm|wasserball|freibad|hallenbad/i, fact: 'Schwimmtermin' },
  { category: 'holiday', pattern: /ferien|urlaub|feiertag/i, fact: 'Ferien oder freier Tag' },
  { category: 'fair', pattern: /kirmes|jahrmarkt|rummel|volksfest/i, fact: 'Veranstaltung außer Haus' },
  { category: 'errand', pattern: /einkauf|supermarkt|drogerie|baumarkt|besorgung|erledigung/i, fact: 'Erledigung' },
  { category: 'outdoor', pattern: OUTDOOR_PATTERN, fact: 'Außentermin' },
  { category: 'family', pattern: /kita|schule|elternabend|familie|kinder|geburtstag/i, fact: 'Familientermin' },
];

const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayPeriodNames: Record<Daypart, string> = {
  morning: 'Morgen', midday: 'Mittag', afternoon: 'Nachmittag', evening: 'Abend', night: 'Nacht',
};
const weatherNames: Record<string, string> = {
  sunny: 'sonnig', rainy: 'regnerisch', snowy: 'Schnee', cloudy: 'bewölkt',
};

function categoryFor(title: string): { category: EventCategory; fact: string | null } {
  const match = CATEGORY_RULES.find((rule) => rule.pattern.test(title));
  return match ?? { category: 'unknown', fact: null };
}

export function analyzeAmbientContext(
  events: readonly CalendarEvent[],
  weather: OutdoorReading,
  now = new Date(),
): AmbientAnalysis {
  const today = eventsForDay(events, now);
  const remaining = today.filter((event) => eventPhase(event, now) !== 'past');
  const next = remaining[0] ?? null;
  const gaps = remaining.slice(1).map((event, index) =>
    new Date(event.start).getTime() - new Date(remaining[index].end).getTime(),
  );
  const dense = remaining.length >= 3 && gaps.some((gap) => gap <= 45 * 60 * 1000);
  const calendarLoad = remaining.length === 0 ? 'frei'
    : dense ? 'dicht' : remaining.length >= 4 ? 'belebt' : 'belegt';
  const notableFacts: string[] = [];
  if (remaining.length === 0) notableFacts.push(today.length ? 'alle Termine erledigt' : 'keine Termine');
  else if (remaining.length === 1) notableFacts.push('ein Termin steht an');
  else if (remaining.length === 2) notableFacts.push('zwei Termine stehen an');
  else if (dense) notableFacts.push('Termine dicht aufeinander');
  else notableFacts.push('mehrere Termine');

  const nextCategory = next ? categoryFor(next.title) : { category: 'unknown' as const, fact: null };
  if (nextCategory.fact) notableFacts.push(nextCategory.fact);
  const temperatureRelevant = weather.temp !== null
    && (remaining.length === 0 || weather.temp > EXTREME_HEAT_C || weather.temp <= EXTREME_COLD_C);
  if (weather.temp !== null && weather.temp > EXTREME_HEAT_C) notableFacts.push('extreme Hitze');
  else if (weather.temp !== null && weather.temp <= EXTREME_COLD_C) notableFacts.push('kalter Tag');
  if (weather.condition === 'rainy') notableFacts.push('Regen');
  if (weather.windSpeed !== null && weather.windSpeed >= 30) notableFacts.push('windig');
  if (next && hasOutdoorEvent([next]) && weather.condition) notableFacts.push('Wetter trifft Außentermin');

  const phase = daypart(now);
  return {
    date: localDayKey(now),
    weekday: weekdayLongFormatter.format(now),
    time: timeFormatter.format(now),
    dayPeriod: dayPeriodNames[phase.id],
    calendarLoad,
    nextEvent: next ? {
      id: next.id,
      title: next.title,
      time: next.allDay ? null : timeFormatter.format(new Date(next.start)),
      category: nextCategory.category,
      running: eventPhase(next, now) === 'now',
    } : null,
    remainingEvents: remaining.length,
    weather: {
      condition: weather.condition ? weatherNames[weather.condition] ?? weather.condition : null,
      temperature: temperatureRelevant ? weather.temp : null,
      trend: weather.tempDelta === null ? null
        : weather.tempDelta >= 2 ? 'wärmer' : weather.tempDelta <= -2 ? 'kälter' : 'stabil',
    },
    notableFacts,
    eventState: remaining.map((event) => String(hash(`${event.id}:${event.title}:${eventPhase(event, now)}:${event.start}:${event.end}`))).join('|'),
  };
}

const SYSTEM_PROMPT = `Du formulierst eine kurze Tagesbotschaft für einen privaten Smart-Home-Sperrbildschirm.
Kommentiere den Tag trocken, freundlich und leicht verspielt. Fasse den Kalender nicht einfach zusammen.
Wähle passend, gern gewichtet zufällig: trockener Kalenderkommentar, flaches passendes Wortspiel,
Wetter gegen Tagesplanung oder Kommentar zum Tagesabschnitt.
Regeln: maximal zwei kurze Zeilen, insgesamt möglichst unter 20 Wörtern, keine Begrüßung, keine Emojis,
keine Motivationssprüche, kein Coaching-Ton, keine pathetische Sprache, keine erfundenen Informationen,
keine vollständige Terminaufzählung, Namen nur aus dem Kontext, kein erzwungenes Wortspiel.
Priorisiere konkrete Kalenderbezüge. Erwähne Temperatur nur, wenn sie im Kontext einen Zahlenwert hat;
bei vorhandenen Terminen wird sie nur bei extremer Hitze über 32 Grad oder deutlicher Kälte geliefert.
Nur bei null verbleibenden Terminen darfst du freie Zeit, Ruhe, Leerlauf oder Langeweile suggerieren.
Ab einem Termin ist der Tag belegt; nenne ihn nie ruhig, überschaubar, leer oder entspannt.
Gib ausschließlich den fertigen Text zurück.`;

export function buildAmbientCopyMessages(
  context: AmbientAnalysis,
  recent: readonly string[],
  variationRetry = false,
): ChatMessage[] {
  const publicContext = { ...context, eventState: undefined };
  const variation = variationRetry
    ? '\nVariation-Hinweis: Der erste Entwurf war ungültig oder zu ähnlich. Wähle einen klar anderen Satzanfang und eine andere Pointe.'
    : '';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Kontext: ${JSON.stringify(publicContext)}\nLetzte Botschaften, nicht wiederholen oder erkennbar nachbauen: ${JSON.stringify(recent.slice(-20))}${variation}`,
    },
  ];
}

function normalizedWords(text: string): string[] {
  return text.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

export function sanitizeAmbientLlmCopy(
  raw: string,
  recent: readonly string[],
  context?: AmbientAnalysis,
): [string] | [string, string] | null {
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    .replace(/^["'„“»‚]+|["'“”«‘]+$/g, '').trim();
  const lines = clean.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 2) return null;
  const text = lines.join(' ');
  const words = normalizedWords(text);
  if (words.length < 3 || words.length > 20 || text.length > 160) return null;
  if (/[!]|https?:|\p{Extended_Pictographic}/u.test(text)) return null;
  if (/^(guten\s+(morgen|tag|abend)|hallo|willkommen)\b/i.test(text)) return null;

  const normalized = words.join(' ');
  const start = words.slice(0, 3).join(' ');
  const ending = words.slice(-4).join(' ');
  for (const old of recent.slice(-20)) {
    const oldWords = normalizedWords(old);
    if (normalized === oldWords.join(' ')) return null;
    if (start && start === oldWords.slice(0, 3).join(' ')) return null;
    if (ending && ending === oldWords.slice(-4).join(' ')) return null;
  }
  if (context?.nextEvent?.title) {
    const title = context.nextEvent.title.toLocaleLowerCase('de-DE');
    const count = text.toLocaleLowerCase('de-DE').split(title).length - 1;
    if (count > 1) return null;
  }
  if (context) {
    if (context.remainingEvents > 0
        && /\b(wenig(?:e|en|er)?\s+termine?|überschaubar|viel\s+zeit|freie?\s+zeit|freizeit|ruhig|ruhe|leerlauf|sendepause|langweil\w*|nichts\s+los|entspannt|unentschlossen)\b/i.test(text)) {
      return null;
    }
    const allowedTimes = new Set([context.time, context.nextEvent?.time].filter(Boolean));
    const mentionedTimes = text.match(/\b\d{1,2}[:.]\d{2}\b/g) ?? [];
    for (const mentioned of mentionedTimes) {
      const [hour, minute] = mentioned.replace('.', ':').split(':');
      if (!allowedTimes.has(`${hour.padStart(2, '0')}:${minute}`)) return null;
    }
  }
  return lines.length === 1 ? [lines[0]] : [lines[0], lines[1]];
}

/* Trigger-Fingerprint: exakte Uhrzeit und kleine Temperaturschwankungen bleiben
   draußen. Tagesabschnitt, Terminstatus/-daten, Wetterklasse und sinnvolle
   Temperaturschwellen lösen dagegen eine Neugenerierung aus. */
export function ambientGenerationFingerprint(context: AmbientAnalysis): string {
  const tempBand = context.weather.temperature === null ? 'none'
    : context.weather.temperature > EXTREME_HEAT_C ? 'extreme-hot'
      : context.weather.temperature <= 5 ? 'cold'
        : Math.floor(context.weather.temperature / 5) * 5;
  return JSON.stringify({
    day: context.date,
    period: context.dayPeriod,
    load: context.calendarLoad,
    next: context.nextEvent?.id ?? null,
    running: context.nextEvent?.running ?? false,
    remaining: context.remainingEvents,
    eventState: context.eventState,
    condition: context.weather.condition,
    tempBand,
    trend: context.weather.trend,
  });
}
