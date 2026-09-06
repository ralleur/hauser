/* Kalendermomente (Paket 7): Geburtstage, feste Tage und der erste Schnee.

   Der Server entscheidet, was heute ein Moment ist — die Oberfläche zeigt ihn
   nur und formuliert den Text in ihrer Sprache. Deshalb reist über die API
   kein fertiger Satz, sondern Art, Schlüssel und (wo eindeutig) der Name.

   Quellen sind Home Assistant selbst: die Kalender-REST-Route für die Termine
   des Tages und die Template-Route für die Wetterlage. Beide Antworten sind
   klein; `/api/states` bliebe ungenutzt groß. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MOMENTS_STATE_PATH } from './runtime-env.mjs';
import { jsonResponse } from './shared.mjs';

/* Wie lange eine Antwort wiederverwendet wird. Momente wechseln mit dem Tag,
   nicht mit der Minute; das Panel darf trotzdem oft fragen. */
const MOMENTS_TTL_MS = 15 * 60 * 1000;

/* Feste Tage ohne Kalendereintrag. `easter` wird gerechnet, der Rest steht
   fest. Der Dienst nimmt eine eigene Liste entgegen — der Einhängepunkt für
   eine spätere Konfiguration im Haushalt. */
export const DEFAULT_HOLIDAYS = Object.freeze([
  Object.freeze({ key: 'christmas-eve', month: 12, day: 24 }),
  Object.freeze({ key: 'christmas', month: 12, day: 25 }),
  Object.freeze({ key: 'new-years-eve', month: 12, day: 31 }),
  Object.freeze({ key: 'easter', easter: true }),
]);

/* Welche festen Tage der Haushalt sehen will, steht in der geteilten
   Konfiguration (`hmi:moment-holidays:v1`, JSON-Liste von Schlüsseln). Fehlt
   der Eintrag oder ist er unlesbar, gelten alle — ein neuer Haushalt feiert
   erst einmal alles mit. */
export const MOMENT_HOLIDAYS_CONFIG_KEY = 'hmi:moment-holidays:v1';

const SNOW_CONDITIONS = new Set(['snowy', 'snowy-rainy']);

export function selectedHolidays(raw, holidays = DEFAULT_HOLIDAYS) {
  if (typeof raw !== 'string' || !raw) return holidays;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return holidays; }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) return holidays;
  const wanted = new Set(parsed);
  return holidays.filter((holiday) => wanted.has(holiday.key));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Ortszeit-Tagesschlüssel; Spiegel von `localDayKey` im Client. */
export function momentDayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Winter reicht über den Jahreswechsel: Juli bis Juni ist eine Saison. */
export function momentSeasonKey(date) {
  const year = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}/${year + 1}`;
}

/* Osterformel nach Meeus/Jones/Butcher (gregorianisch). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Welcher feste Tag heute ist — oder `null`. */
export function holidayOn(date, holidays = DEFAULT_HOLIDAYS) {
  for (const holiday of holidays) {
    if (holiday.easter) {
      if (momentDayKey(easterSunday(date.getFullYear())) === momentDayKey(date)) return holiday.key;
      continue;
    }
    if (date.getMonth() + 1 === holiday.month && date.getDate() === holiday.day) return holiday.key;
  }
  return null;
}

/* Ein Geburtstag ist erkannt, wenn der Titel das Wort trägt — in den Sprachen,
   die Hauser spricht. Der Name wird nur übernommen, wenn die Schreibweise ihn
   eindeutig hergibt; sonst zeigt die Oberfläche den Titel, statt zu raten. */
const BIRTHDAY_WORD = /(geburtstag|geburi|birthday|anniversaire|compleanno|urodziny|anivers[áa]rio)/i;
const BIRTHDAY_OF = /(?:geburtstag|birthday|anniversaire|compleanno|urodziny|anivers[áa]rio)\s*(?::|von|of|de|di|d[ei]l+a?)\s+(.+)$/i;
const BIRTHDAY_POSSESSIVE = /([\p{L}\p{M}][\p{L}\p{M}.'’-]*)\s*['’]s\s+(?:birthday|geburtstag)/iu;

export function parseBirthdayTitle(summary) {
  const title = String(summary ?? '').replace(/\s+/g, ' ').trim();
  if (!title || title.length > 120 || !BIRTHDAY_WORD.test(title)) return null;
  const stripped = title.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  const possessive = BIRTHDAY_POSSESSIVE.exec(stripped);
  if (possessive) return { title, name: possessive[1] };
  const of = BIRTHDAY_OF.exec(stripped);
  if (of) {
    const name = of[1].replace(/[.,;:!?]+$/, '').trim();
    if (name && name.length <= 60) return { title, name };
  }
  return { title, name: null };
}

/* Ganztägige Termine liefert Home Assistant als `{ date }`, terminierte als
   `{ dateTime }`. Für den Geburtstag zählt nur, dass er heute liegt. */
function eventStartsOn(event, dayKey) {
  const start = event?.start;
  const value = typeof start === 'string' ? start : (start?.date ?? start?.dateTime ?? null);
  if (typeof value !== 'string' || !value) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value === dayKey;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? false : momentDayKey(parsed) === dayKey;
}

/** Momente aus Terminen, Datum und Wetterlage — ohne Netz und ohne Uhr. */
export function selectMoments({ events = [], now, weatherConditions = [], holidays = DEFAULT_HOLIDAYS, seenSnowSeason = null }) {
  const dayKey = momentDayKey(now);
  const moments = [];

  for (const event of events) {
    if (!eventStartsOn(event, dayKey)) continue;
    const birthday = parseBirthdayTitle(event?.summary ?? event?.title);
    if (!birthday) continue;
    const id = `birthday:${dayKey}:${birthday.name ?? birthday.title}`;
    if (moments.some((known) => known.id === id)) continue;
    moments.push({ id, kind: 'birthday', title: birthday.title, name: birthday.name });
  }

  const holiday = holidayOn(now, holidays);
  if (holiday) moments.push({ id: `holiday:${dayKey}:${holiday}`, kind: 'holiday', holiday });

  const season = momentSeasonKey(now);
  const snowing = weatherConditions.some((condition) => SNOW_CONDITIONS.has(String(condition).toLowerCase()));
  const firstSnow = snowing && seenSnowSeason !== season;
  if (firstSnow) moments.push({ id: `first-snow:${season}`, kind: 'first-snow' });

  return { day: dayKey, moments, snowSeason: firstSnow ? season : seenSnowSeason };
}

export function createMomentsStateStore(path = MOMENTS_STATE_PATH) {
  function read() {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (data?.version === 1 && (data.snowSeason === null || typeof data.snowSeason === 'string')) {
        return { version: 1, snowSeason: data.snowSeason ?? null };
      }
    } catch { /* erster Start oder unlesbar: nichts gesehen */ }
    return { version: 1, snowSeason: null };
  }

  function write(state) {
    const data = { version: 1, snowSeason: state.snowSeason ?? null };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    return data;
  }

  return { read, write };
}

/* ── Home Assistant lesen ──────────────────────────────────────────────── */

async function readCalendarEvents(client, now) {
  const list = await client.rest('GET', '/api/calendars');
  if (list.status !== 200 || !Array.isArray(list.body)) return [];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const events = [];
  for (const entry of list.body) {
    const entityId = typeof entry?.entity_id === 'string' ? entry.entity_id : null;
    if (!entityId || !entityId.startsWith('calendar.')) continue;
    const query = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
    const result = await client.rest('GET', `/api/calendars/${encodeURIComponent(entityId)}?${query}`);
    if (result.status !== 200 || !Array.isArray(result.body)) continue;
    events.push(...result.body);
  }
  return events;
}

/* Die Wetterlage kommt als Template zurück, damit nicht der gesamte
   Zustandsspeicher über die Leitung geht. */
async function readWeatherConditions(client) {
  const result = await client.rest('POST', '/api/template', {
    template: "{{ states.weather | map(attribute='state') | list | tojson }}",
  });
  if (result.status !== 200) return [];
  try {
    const parsed = JSON.parse(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function createMomentsService({
  clientFactory,
  resolveCredentials,
  stateStore = null,
  statePath = MOMENTS_STATE_PATH,
  holidays = DEFAULT_HOLIDAYS,
  readHolidaySetting = () => null,
  now = () => new Date(),
  ttlMs = MOMENTS_TTL_MS,
} = {}) {
  const store = stateStore ?? createMomentsStateStore(statePath);
  let cache = null;

  async function collect(current) {
    const credentials = resolveCredentials();
    if (!credentials) return { events: [], weatherConditions: [], degraded: true };
    const client = clientFactory(credentials);
    try {
      const events = await readCalendarEvents(client, current);
      const weatherConditions = await readWeatherConditions(client);
      return { events, weatherConditions, degraded: false };
    } catch {
      /* Home Assistant antwortet nicht — das ist kein Grund, die Oberfläche
         mit einem Fehler zu behelligen. Heute gibt es dann keinen Moment. */
      return { events: [], weatherConditions: [], degraded: true };
    } finally {
      client.close?.();
    }
  }

  async function read() {
    const current = now();
    const day = momentDayKey(current);
    /* Eine geänderte Auswahl soll sofort wirken, nicht erst nach der TTL. */
    const setting = readHolidaySetting();
    if (cache && cache.day === day && cache.setting === setting
        && current.getTime() - cache.at < ttlMs) return cache.data;

    const { events, weatherConditions, degraded } = await collect(current);
    const persisted = store.read();
    const selected = selectMoments({
      events,
      now: current,
      weatherConditions,
      holidays: selectedHolidays(setting, holidays),
      seenSnowSeason: persisted.snowSeason,
    });
    if (selected.snowSeason !== persisted.snowSeason) {
      try { store.write({ snowSeason: selected.snowSeason }); } catch { /* Erster Schnee bleibt ungemerkt */ }
    }
    const data = {
      ok: true,
      version: 1,
      day: selected.day,
      updatedAt: current.toISOString(),
      degraded,
      moments: selected.moments,
    };
    cache = { day, at: current.getTime(), setting, data };
    return data;
  }

  return { read };
}

function momentsEtag(data) {
  return `"${data.day}:${data.moments.map((moment) => moment.id).join('|')}"`;
}

export async function serveMoments(req, res, service) {
  const pathname = new URL(req.url || '/', 'http://hmi.local').pathname;
  if (pathname !== '/api/moments') {
    jsonResponse(res, 404, { ok: false, code: 'MOMENTS_ROUTE_NOT_FOUND', message: 'Die Momente-Route wurde nicht gefunden.' });
    return;
  }
  if (req.method !== 'GET') {
    jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Die Momente-Route unterstützt nur GET.' }, { allow: 'GET' });
    return;
  }
  let data;
  try { data = await service.read(); } catch {
    jsonResponse(res, 500, { ok: false, code: 'MOMENTS_INTERNAL', message: 'Die Momente konnten nicht ermittelt werden.' });
    return;
  }
  const etag = momentsEtag(data);
  if (req.headers?.['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'cache-control': 'no-cache' });
    res.end();
    return;
  }
  jsonResponse(res, 200, data, { ETag: etag, 'cache-control': 'no-cache' });
}
