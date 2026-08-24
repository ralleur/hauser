import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdtempSync, rmSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import neutralApartment from '../../config/examples/neutral-apartment.json';
// @ts-expect-error native .mjs runtime contract
import { createHotelCalendarClient, createHotelModeStayService, createHotelModeStore } from '../../server.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Wednesday 2026-07-15, 12:00 UTC — inside the fixture stay below. */
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TIMED_EVENT = {
  uid: 'stay-a',
  summary: 'Familie Sommer',
  description: 'Willkommen im Apartment!',
  start: { dateTime: '2026-07-14T15:00:00+02:00' },
  end: { dateTime: '2026-07-18T11:00:00+02:00' },
};

function policyFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...neutralApartment.hotelMode,
    enabled: true,
    kioskAcknowledged: true,
    ...overrides,
  };
}

function fixture({
  events = [TIMED_EVENT] as unknown[],
  policy = policyFixture(),
  credentials = { 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'fixture-token' } as Record<string, string>,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-stay-'));
  roots.push(root);
  const store = createHotelModeStore(join(root, 'hotel-mode.json'));
  const state = { now: NOW, events, result: null as null | { ok: false; code: string }, fetches: 0 };
  const service = createHotelModeStayService({
    store,
    configStore: { read: () => credentials },
    now: () => state.now,
    policyReader: () => policy,
    calendarClientFactory: () => ({
      events: async () => {
        state.fetches += 1;
        return state.result ?? { ok: true, events: normalize(state.events) };
      },
    }),
  });
  return { service, state, store };
}

/** Mirrors what the real client hands the service after its own normalization. */
function normalize(events: readonly unknown[]) {
  return events.map((raw, index) => {
    const event = raw as Record<string, any>;
    const boundary = (value: any): string => {
      if (typeof value === 'string') return value;
      if (typeof value?.dateTime === 'string') return value.dateTime;
      return typeof value?.date === 'string' ? value.date : '';
    };
    return {
      uid: typeof event.uid === 'string' ? event.uid : `generated-${index}`,
      summary: event.summary ?? null,
      description: event.description ?? null,
      start: boundary(event.start),
      end: boundary(event.end),
    };
  });
}

describe('Hotel-Mode-Aufenthalte aus dem Kalender', () => {
  it('ist vor dem Check-in neutral, während des Aufenthalts aktiv und ab dem Check-out wieder neutral', async () => {
    const { service, state } = fixture();

    state.now = Date.UTC(2026, 6, 14, 12, 0, 0);
    expect((await service.resolve()).status).toBe('inactive');

    state.now = NOW;
    const active = await service.resolve();
    expect(active.status).toBe('active');
    expect(active.stay.checkIn).toBe(Date.parse('2026-07-14T15:00:00+02:00'));
    expect(active.stay.checkOut).toBe(Date.parse('2026-07-18T11:00:00+02:00'));

    state.now = Date.parse('2026-07-18T11:00:00+02:00');
    expect((await service.resolve()).status).toBe('inactive');
  });

  it('legt Ganztagsereignisse auf die konfigurierten Standardzeiten der eingestellten Zeitzone', async () => {
    const { service } = fixture({
      events: [{ uid: 'all-day', summary: 'Gast', start: { date: '2026-07-14' }, end: { date: '2026-07-18' } }],
    });

    const state = await service.resolve();
    expect(state.status).toBe('active');
    expect(state.stay.allDay).toBe(true);
    // 15:00 respectively 11:00 local time in Europe/Berlin, not UTC.
    expect(state.stay.checkIn).toBe(Date.parse('2026-07-14T15:00:00+02:00'));
    expect(state.stay.checkOut).toBe(Date.parse('2026-07-18T11:00:00+02:00'));
  });

  it('hält überlappende Aufenthalte fail-closed und zeigt den Grund nur dem Admin', async () => {
    const { service } = fixture({
      events: [
        TIMED_EVENT,
        { uid: 'stay-b', summary: 'Doppelbuchung', start: { dateTime: '2026-07-15T10:00:00+02:00' }, end: { dateTime: '2026-07-20T11:00:00+02:00' } },
      ],
    });

    const state = await service.resolve();
    expect(state.status).toBe('inactive');
    expect(service.publicStatus(state))
      .toEqual({ enabled: true, status: 'inactive', checkoutEnabled: true, stay: null });
    expect(service.adminStatus(state).issues.map((issue: { code: string }) => issue.code)).toEqual(['OVERLAP']);
  });

  it('verwirft ungültige Ereignisse fail-closed statt sie zu raten', async () => {
    const { service } = fixture({
      events: [{ uid: 'broken', summary: 'Kaputt', start: { date: '2026-07-14' }, end: { dateTime: '2026-07-18T11:00:00+02:00' } }],
    });

    const state = await service.resolve();
    expect(state.status).toBe('inactive');
    expect(service.adminStatus(state).issues[0].code).toBe('MIXED_DATE_KINDS');
  });

  it('liefert Gästen keinen Namen und keinen nächsten Aufenthalt, dem Admin dagegen beides', async () => {
    const { service, state } = fixture();
    state.now = Date.UTC(2026, 6, 10, 12, 0, 0);

    const resolved = await service.resolve();
    const guest = service.publicStatus(resolved);
    expect(guest).toEqual({ enabled: true, status: 'inactive', checkoutEnabled: true, stay: null });
    expect(JSON.stringify(guest)).not.toContain('Familie Sommer');

    const admin = service.adminStatus(resolved);
    expect(admin.nextStay.guestName).toBe('Familie Sommer');
    expect(admin.nextStay.checkIn).toBe(Date.parse('2026-07-14T15:00:00+02:00'));

    state.now = NOW;
    const activeGuest = service.publicStatus(await service.resolve());
    expect(activeGuest.status).toBe('active');
    expect(activeGuest.stay.welcomeMessage).toBe('Willkommen im Apartment!');
    expect(activeGuest.stay).not.toHaveProperty('guestName');
  });
});

describe('Hotel-Mode-Kalendercache', () => {
  it('hält einen laufenden Aufenthalt ohne Home Assistant nur bis zum bekannten Check-out', async () => {
    const { service, state } = fixture();
    expect((await service.resolve()).status).toBe('active');
    expect(state.fetches).toBe(1);

    state.result = { ok: false, code: 'HOTEL_CALENDAR_UNREACHABLE' };
    state.now = NOW + 6 * HOUR;
    const degraded = await service.resolve();
    expect(degraded.status).toBe('active');
    expect(degraded.source).toBe('cache');
    expect(service.adminStatus(degraded).calendar.error).toBe('HOTEL_CALENDAR_UNREACHABLE');

    state.now = Date.parse('2026-07-18T11:00:00+02:00');
    expect((await service.resolve()).status).toBe('inactive');
  });

  it('öffnet aus dem Cache keinen neuen Aufenthalt', async () => {
    const { service, state } = fixture({
      events: [{ uid: 'later', summary: 'Später', start: { dateTime: '2026-07-16T15:00:00+02:00' }, end: { dateTime: '2026-07-20T11:00:00+02:00' } }],
    });
    expect((await service.resolve()).status).toBe('inactive');

    state.result = { ok: false, code: 'HOTEL_CALENDAR_UNREACHABLE' };
    state.now = Date.parse('2026-07-17T12:00:00+02:00');
    const stale = await service.resolve();
    expect(stale.status).toBe('inactive');
    expect(stale.source).toBe('cache');
  });

  it('verwirft den Cache bei einem widersprüchlichen Kalender, statt ihn weiter zu verwenden', async () => {
    const { service, state, store } = fixture();
    expect((await service.resolve()).status).toBe('active');
    expect(store.read().calendarCache).not.toBeNull();

    state.events = [
      TIMED_EVENT,
      { uid: 'stay-b', start: { dateTime: '2026-07-15T10:00:00+02:00' }, end: { dateTime: '2026-07-20T11:00:00+02:00' } },
    ];
    state.now = NOW + 30 * 60 * 1000;
    expect((await service.resolve()).status).toBe('inactive');
    expect(store.read().calendarCache).toBeNull();

    state.result = { ok: false, code: 'HOTEL_CALENDAR_UNREACHABLE' };
    expect((await service.resolve()).status).toBe('inactive');
  });

  it('fragt Home Assistant nicht bei jedem Statusaufruf erneut ab', async () => {
    const { service, state } = fixture();
    await service.resolve();
    state.now = NOW + 60 * 1000;
    await service.resolve();
    expect(state.fetches).toBe(1);
  });
});

describe('Hotel-Mode-Override', () => {
  it('aktiviert einen Aufenthalt außerhalb des Kalenders und läuft automatisch ab', async () => {
    const { service, state } = fixture({ events: [] });
    expect((await service.resolve()).status).toBe('inactive');

    const created = service.setOverride({ endsAt: NOW + 2 * DAY });
    expect(created.ok).toBe(true);

    const active = await service.resolve();
    expect(active.status).toBe('active');
    expect(active.source).toBe('override');
    expect(service.publicStatus(active).stay).toEqual({
      id: created.override.id,
      checkIn: NOW,
      checkOut: NOW + 2 * DAY,
      welcomeMessage: null,
    });

    state.now = NOW + 2 * DAY;
    expect((await service.resolve()).status).toBe('inactive');
  });

  it('wird erst ab seinem Start wirksam und übersteht einen kaputten Kalender', async () => {
    const { service, state } = fixture({ events: [] });
    service.setOverride({ startsAt: NOW + DAY, endsAt: NOW + 3 * DAY });
    expect((await service.resolve()).status).toBe('inactive');

    state.result = { ok: false, code: 'HOTEL_CALENDAR_UNREACHABLE' };
    state.now = NOW + DAY;
    expect((await service.resolve()).status).toBe('active');
  });

  it('lehnt unbrauchbare Fenster ab und lässt sich gezielt zurücknehmen', async () => {
    const { service } = fixture({ events: [] });
    expect(service.setOverride({ endsAt: NOW - 1 }).code).toBe('HOTEL_OVERRIDE_INVALID');
    expect(service.setOverride({ startsAt: NOW, endsAt: NOW }).code).toBe('HOTEL_OVERRIDE_INVALID');
    expect(service.setOverride({ endsAt: NOW + 20 * DAY }).code).toBe('HOTEL_OVERRIDE_INVALID');
    expect(service.setOverride({ startsAt: NOW + 60 * DAY, endsAt: NOW + 61 * DAY }).code).toBe('HOTEL_OVERRIDE_INVALID');

    expect(service.setOverride({ endsAt: NOW + DAY }).ok).toBe(true);
    expect((await service.resolve()).status).toBe('active');
    service.clearOverride();
    expect((await service.resolve()).status).toBe('inactive');
  });
});

describe('Hotel-Mode-Statusgrenzen', () => {
  it('meldet den Modus als deaktiviert, ohne Home Assistant zu fragen', async () => {
    const { service, state } = fixture({ policy: policyFixture({ enabled: false }) });
    const resolved = await service.resolve();
    expect(service.publicStatus(resolved))
      .toEqual({ enabled: false, status: 'inactive', checkoutEnabled: false, stay: null });
    expect(state.fetches).toBe(0);
  });

  it('bleibt ohne Serverzugangsdaten neutral und nennt dem Admin den Grund', async () => {
    const { service } = fixture({ credentials: {} });
    const resolved = await service.resolve();
    expect(resolved.status).toBe('inactive');
    expect(service.adminStatus(resolved).calendar.error).toBe('HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');
  });

  it('neutralisiert einen ausgecheckten Aufenthalt auch ohne neuen Kalenderabruf', async () => {
    const { service, store } = fixture();
    const active = await service.resolve();
    expect(active.status).toBe('active');

    store.update(() => ({ checkout: { stayId: active.stay.uid, checkedOutAt: NOW } }));
    const after = await service.resolve();
    expect(after.status).toBe('inactive');
    expect(after.source).toBe('checkout');
  });
});

describe('Hotel-Mode-Kalenderclient', () => {
  it('liest den konfigurierten Kalender mit Serverzugangsdaten und Zeitfenster', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const client = createHotelCalendarClient({
      baseUrl: 'http://ha.fixture',
      token: 'fixture-token',
      fetchImpl: async (url: URL, init: { headers: Record<string, string> }) => {
        calls.push({ url: url.toString(), headers: init.headers });
        return new Response(JSON.stringify([TIMED_EVENT]), { status: 200 });
      },
    });

    const result = await client.events('calendar.apartment_stays', NOW, NOW + DAY);
    expect(result.ok).toBe(true);
    expect(result.events[0].summary).toBe('Familie Sommer');
    expect(result.events[0].uid).toMatch(/^[0-9a-f]{32}$/);
    expect(calls[0].url).toBe(
      `http://ha.fixture/api/calendars/calendar.apartment_stays?start=${encodeURIComponent(new Date(NOW).toISOString())}&end=${encodeURIComponent(new Date(NOW + DAY).toISOString())}`,
    );
    expect(calls[0].headers.authorization).toBe('Bearer fixture-token');
  });

  it('meldet Fehlerantworten als Code statt sie als leeren Kalender zu behandeln', async () => {
    const respond = (status: number, body = '[]') => createHotelCalendarClient({
      baseUrl: 'http://ha.fixture',
      token: 'fixture-token',
      fetchImpl: async () => new Response(body, { status }),
    }).events('calendar.apartment_stays', NOW, NOW + DAY);

    expect((await respond(401)).code).toBe('HOTEL_CALENDAR_AUTH_FAILED');
    expect((await respond(404)).code).toBe('HOTEL_CALENDAR_NOT_FOUND');
    expect((await respond(500)).code).toBe('HOTEL_CALENDAR_HTTP_ERROR');
    expect((await respond(200, '{}')).code).toBe('HOTEL_CALENDAR_INVALID_RESPONSE');

    const unreachable = await createHotelCalendarClient({
      baseUrl: 'http://ha.fixture',
      token: 'fixture-token',
      fetchImpl: async () => { throw new Error('offline'); },
    }).events('calendar.apartment_stays', NOW, NOW + DAY);
    expect(unreachable.code).toBe('HOTEL_CALENDAR_UNREACHABLE');
  });
});
