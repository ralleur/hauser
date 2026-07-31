// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import phoneCalendar from '../components/phone/PhoneCalendar.svelte?raw';
import phoneShell from '../shells/PhoneAppShell.svelte?raw';

import type { CalendarEvent } from './calendar.ts';
import { projectPhoneAgenda } from './phone-calendar.ts';

const phoneShellCss = readFileSync(new URL('../../styles/phone-shell.css', import.meta.url), 'utf8');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

const NOW = new Date('2026-07-12T12:00:00+02:00');

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    title: 'Familientermin',
    start: '2026-07-12T14:00:00+02:00',
    end: '2026-07-12T15:00:00+02:00',
    allDay: false,
    location: null,
    description: null,
    ...overrides,
  };
}

function installMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return storage;
}

afterEach(() => {
  vi.doUnmock('../adapter/runtime.svelte.ts');
  vi.resetModules();
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('phone calendar agenda projection', () => {
  it('drops ended events while keeping running and upcoming events chronological', () => {
    const days = projectPhoneAgenda([
      event({ id: 'tomorrow', start: '2026-07-13T09:00:00+02:00', end: '2026-07-13T10:00:00+02:00' }),
      event({ id: 'done', start: '2026-07-12T08:00:00+02:00', end: '2026-07-12T09:00:00+02:00' }),
      event({ id: 'later', start: '2026-07-12T16:00:00+02:00', end: '2026-07-12T17:00:00+02:00' }),
      event({ id: 'running', start: '2026-07-12T11:00:00+02:00', end: '2026-07-12T13:00:00+02:00' }),
    ], NOW);

    expect(days.map((day) => day.key)).toEqual(['2026-07-12', '2026-07-13']);
    expect(days[0]).toMatchObject({ today: true });
    expect(days[0].events.map((item) => item.id)).toEqual(['running', 'later']);
    expect(days[0].events[0]).toMatchObject({ running: true, time: '11:00–13:00' });
    expect(days[1].events.map((item) => item.id)).toEqual(['tomorrow']);
  });

  it('projects a running multi-day event that began in the past onto today', () => {
    const [today] = projectPhoneAgenda([
      event({
        id: 'reise', title: 'Reise', allDay: true,
        start: '2026-07-10T00:00:00+02:00', end: '2026-07-15T00:00:00+02:00',
      }),
    ], NOW);

    expect(today).toMatchObject({ key: '2026-07-12', today: true });
    expect(today.events[0]).toMatchObject({
      id: 'reise', running: true, multiDay: true, time: 'Ganztägig',
    });
    expect(today.events[0].span).toContain('10. Juli');
    expect(today.events[0].span).toContain('14. Juli');
  });

  it('formats all-day, timed multi-day and optional location without exposing descriptions', () => {
    const days = projectPhoneAgenda([
      event({ id: 'all-day', title: 'Kita zu', allDay: true, start: '2026-07-13T00:00:00+02:00', end: '2026-07-14T00:00:00+02:00' }),
      event({
        id: 'conference', title: 'Konferenz', location: 'Berlin', description: 'Privater Langtext',
        start: '2026-07-14T18:00:00+02:00', end: '2026-07-16T10:00:00+02:00',
      }),
    ], NOW);
    const projected = days.flatMap((day) => day.events);

    expect(projected[0]).toMatchObject({ time: 'Ganztägig', multiDay: false, location: null });
    expect(projected[1]).toMatchObject({ time: '18:00–10:00', multiDay: true, location: 'Berlin' });
    expect(projected[1].span).toContain('14. Juli');
    expect(projected[1].span).toContain('16. Juli');
    expect(projected[1]).not.toHaveProperty('description');
  });

  it('tolerates an unloaded store and invalid or zero-length entries', () => {
    expect(projectPhoneAgenda([], NOW)).toEqual([]);
    expect(projectPhoneAgenda([
      event({ id: 'invalid', start: 'not-a-date' }),
      event({ id: 'zero', start: '2026-07-12T13:00:00+02:00', end: '2026-07-12T13:00:00+02:00' }),
    ], NOW)).toEqual([]);
  });

  it('keeps repeated source IDs DOM-key-safe without changing their domain IDs', () => {
    const repeated = [
      event({ id: 'calendar.familie:series-uid', start: '2026-07-12T14:00:00+02:00', end: '2026-07-12T15:00:00+02:00' }),
      event({ id: 'calendar.familie:series-uid', start: '2026-07-12T16:00:00+02:00', end: '2026-07-12T17:00:00+02:00' }),
    ];
    const projected = projectPhoneAgenda(repeated, NOW)[0].events;
    const projectedAgain = projectPhoneAgenda(repeated, NOW)[0].events;

    expect(projected.map((item) => item.id)).toEqual(['calendar.familie:series-uid', 'calendar.familie:series-uid']);
    expect(new Set(projected.map((item) => item.renderKey)).size).toBe(2);
    expect(projected.map((item) => item.renderKey)).toEqual(projectedAgain.map((item) => item.renderKey));
    expect(phoneCalendar).toMatch(/#each day\.events as event \(event\.renderKey\)/);
  });
});

describe('calendar refresh last-known boundary', () => {
  it('preserves last-known state and cache when an offline source read returns empty', async () => {
    const cachedSource = { entityId: 'calendar.familie', name: 'Familie' };
    const cachedEvent = event({ id: 'calendar.familie:cached' });
    const cached = JSON.stringify({ sources: [cachedSource], events: [cachedEvent], updatedAt: 123 });
    const storage = installMemoryStorage({ 'hmi:calendar-familie-cache': cached });
    vi.doMock('../adapter/runtime.svelte.ts', () => ({
      runtime: {
        connectionStatus: 'disconnected',
        listCalendarSources: vi.fn().mockResolvedValue([]),
        getCalendarEvents: vi.fn(),
      },
    }));
    const { familyCalendar, refreshFamilyCalendar } = await import('./calendar.svelte.ts');
    familyCalendar.sources = [cachedSource];
    familyCalendar.events = [cachedEvent];
    familyCalendar.updatedAt = 123;

    await refreshFamilyCalendar();

    expect(familyCalendar.sources).toEqual([cachedSource]);
    expect(familyCalendar.events).toEqual([cachedEvent]);
    expect(familyCalendar.updatedAt).toBe(123);
    expect(familyCalendar.error).toBe('Kalender konnte offline nicht aktualisiert werden.');
    expect(storage.getItem('hmi:calendar-familie-cache')).toBe(cached);
  });

  it('replaces an offline last-known state and cache on a later connected refresh', async () => {
    const cachedSource = { entityId: 'calendar.familie', name: 'Familie alt' };
    const cachedEvent = event({ id: 'calendar.familie:cached', title: 'Alter Termin' });
    const cached = JSON.stringify({ sources: [cachedSource], events: [cachedEvent], updatedAt: 123 });
    const storage = installMemoryStorage({ 'hmi:calendar-familie-cache': cached });
    const freshSource = { entityId: 'calendar.familie', name: 'Familie' };
    const freshEvent = event({ id: 'fresh', title: 'Neuer Termin' });
    const runtimeMock = {
      connectionStatus: 'reconnecting',
      listCalendarSources: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([freshSource]),
      getCalendarEvents: vi.fn().mockResolvedValue([freshEvent]),
    };
    vi.doMock('../adapter/runtime.svelte.ts', () => ({ runtime: runtimeMock }));
    const { familyCalendar, refreshFamilyCalendar } = await import('./calendar.svelte.ts');
    familyCalendar.sources = [cachedSource];
    familyCalendar.events = [cachedEvent];
    familyCalendar.updatedAt = 123;

    await refreshFamilyCalendar();

    expect(familyCalendar.error).toBe('Kalender konnte offline nicht aktualisiert werden.');
    expect(storage.getItem('hmi:calendar-familie-cache')).toBe(cached);
    expect(runtimeMock.getCalendarEvents).not.toHaveBeenCalled();

    runtimeMock.connectionStatus = 'connected';
    await refreshFamilyCalendar();

    expect(familyCalendar.sources).toEqual([freshSource]);
    expect(familyCalendar.events).toEqual([{ ...freshEvent, id: 'calendar.familie:fresh', color: null }]);
    expect(familyCalendar.updatedAt).toBeGreaterThan(123);
    expect(familyCalendar.error).toBeNull();
    expect(runtimeMock.listCalendarSources).toHaveBeenCalledTimes(2);
    expect(runtimeMock.getCalendarEvents).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('hmi:calendar-familie-cache') ?? 'null')).toEqual({
      sources: familyCalendar.sources,
      events: familyCalendar.events,
      updatedAt: familyCalendar.updatedAt,
    });
  });

  it('still clears last-known data for an intentional empty selection while connected', async () => {
    const cachedSource = { entityId: 'calendar.familie', name: 'Familie' };
    const cachedEvent = event({ id: 'calendar.familie:cached' });
    const storage = installMemoryStorage({
      'hmi:calendar-selected': '[]',
      'hmi:calendar-familie-cache': JSON.stringify({ sources: [cachedSource], events: [cachedEvent], updatedAt: 123 }),
    });
    vi.doMock('../adapter/runtime.svelte.ts', () => ({
      runtime: {
        connectionStatus: 'connected',
        listCalendarSources: vi.fn().mockResolvedValue([cachedSource]),
        getCalendarEvents: vi.fn(),
      },
    }));
    const { familyCalendar, refreshFamilyCalendar } = await import('./calendar.svelte.ts');
    familyCalendar.sources = [cachedSource];
    familyCalendar.events = [cachedEvent];
    familyCalendar.updatedAt = 123;

    await refreshFamilyCalendar();

    expect(familyCalendar.sources).toEqual([]);
    expect(familyCalendar.events).toEqual([]);
    expect(familyCalendar.error).toBeNull();
    expect(storage.getItem('hmi:calendar-familie-cache')).toBeNull();
  });
});

describe('phone calendar shell and accessibility boundaries', () => {
  it('keeps the large standalone shell while anchoring fixed layers inside stable safe areas', () => {
    expect(phoneShellCss).toMatch(/--phone-viewport-height:\s*100dvh/);
    expect(phoneShellCss).not.toMatch(/100dvh \+ env\(safe-area-inset-top/);
    expect(phoneShellCss).toMatch(/data-standalone='true'[\s\S]*--phone-viewport-height:\s*100lvh/);
    expect(phoneShellCss).toMatch(/data-standalone='true'[\s\S]*--phone-safe-top:\s*max\(env\(safe-area-inset-top, 0px\), var\(--space-8\)\)/);
    expect(phoneShellCss).toMatch(/data-standalone='true'[\s\S]*\.room-sheet\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%/);
    expect(phoneShellCss).toMatch(/\.phone-content-frame\s*\{[^}]*height:\s*100%/s);
    expect(phoneShellCss).toMatch(/\.phone-calendar\s*\{[^}]*height:\s*100%/s);
    expect(phoneShellCss).toMatch(/\.phone-bottom-nav\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*0;/s);
    expect(phoneShellCss).toMatch(/\.phone-shell\.has-connection-banner[\s\S]*padding-top:\s*calc\(var\(--phone-conn-banner-height\) \+ var\(--space-4\)\)/);
    expect(phoneShellCss).toMatch(/\.room-sheet-scrim\s*\{[^}]*top:\s*var\(--phone-safe-top\);[^}]*right:\s*var\(--phone-safe-right\);[^}]*bottom:\s*var\(--phone-safe-bottom\);[^}]*left:\s*var\(--phone-safe-left\);[^}]*padding:\s*0;/);
    expect(phoneShellCss).toMatch(/\.room-sheet-scroll\s*\{[^}]*overflow-anchor:\s*none/);
    expect(phoneShellCss).toMatch(/@media \(orientation: landscape\)[\s\S]*\.room-sheet\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%/);
    expect(phoneShellCss).not.toMatch(/@media \(orientation: landscape\)[\s\S]*\.room-sheet\s*\{[^}]*height:\s*var\(--phone-viewport-height\)/);
    expect(phoneShellCss).toMatch(/display-mode: standalone\) and \(orientation: landscape\)[\s\S]*--phone-safe-right:\s*max\([^;]*var\(--space-8\)\)[\s\S]*--phone-safe-left:\s*max\([^;]*var\(--space-8\)\)/);
    expect(phoneShell).toContain('class:has-connection-banner={conn.banner !== null}');
  });

  it('mounts the agenda only for the canonical calendar target and preserves fallback targets', () => {
    expect(phoneShell).toContain("calendar: () => import('../components/phone/PhoneCalendar.svelte')");
    expect(phoneShell).toMatch(/target\.area === 'calendar'[\s\S]*return 'calendar'/);
    expect(phoneShell).toMatch(/activePhoneScreenId[\s\S]*<PhoneScreenComponent/);
    expect(phoneShell).not.toMatch(/^\s*import PhoneCalendar/m);
    expect(phoneShell).toMatch(/<PhoneHomeFeed/);
    expect(phoneShell).toMatch(/m\.phone_view_preparing\(\)/);
  });

  it('uses the shared store and refresh seam with loading, error and empty states', () => {
    expect(phoneCalendar).toMatch(/familyCalendar/);
    expect(phoneCalendar).toMatch(/refreshFamilyCalendar\(\)/);
    expect(phoneCalendar).toMatch(/disabled=\{familyCalendar\.loading\}/);
    expect(phoneCalendar).toContain('Kalender aktualisieren');
    expect(phoneCalendar).toContain('Letzte bekannte Termine');
    expect(phoneCalendar).toContain('Keine kommenden Termine');
    expect(phoneCalendar).toContain('Noch nicht aktualisiert');
  });

  it('provides one main, one h1, day sections and event lists with non-color-only running state', () => {
    expect((phoneCalendar.match(/<main\b/g) ?? [])).toHaveLength(1);
    expect((phoneCalendar.match(/<h1\b/g) ?? [])).toHaveLength(1);
    expect(phoneCalendar).toMatch(/<section[^>]*aria-labelledby=/);
    expect(phoneCalendar).toMatch(/<ul\b/);
    expect(phoneCalendar).toMatch(/<li\b/);
    expect(phoneCalendar).toContain('Läuft jetzt');
    expect(phoneCalendar).not.toContain('description');
  });

  it('keeps panel, hero, HLS and icon-catalog code out of the phone calendar path', () => {
    for (const source of [phoneShell, phoneCalendar]) {
      for (const forbidden of ['CalendarScreen', 'PanelAppShell', 'RoomHero', 'hls.js', 'IconPicker', 'icon-recents']) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
