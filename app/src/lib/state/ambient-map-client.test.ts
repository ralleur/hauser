import { describe, expect, it, vi } from 'vitest';

import {
  AMBIENT_MAP_ADMIN_STATUS_URL,
  AMBIENT_MAP_LOCATION_URL,
  AMBIENT_MAP_REGENERATE_URL,
  AMBIENT_MAP_STATUS_URL,
  createAmbientMapClient,
  parseAmbientMapCoordinate,
  parseAmbientMapStatus,
  type AmbientMapGeolocationLike,
} from './ambient-map-client.ts';

/* Fokussierte Tests des Ambient-Stadtplan-Clients (docs/18 §6, §7.1).
   Kein echtes Netz, keine echte Geolocation, keine echten Timer: `fetch`,
   Geolocation und die Timerfunktionen werden injiziert. */

const ASSET_ID = 'a'.repeat(64);
const ASSET_URL = `/assets/ambient-maps/${ASSET_ID}.svg`;

interface Call { url: string; init?: RequestInit }

/** Lässt alle offenen Microtasks des Clients auslaufen. */
function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function readyStatus(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    state: 'ready',
    radiusMetres: 2_000,
    asset: { url: ASSET_URL, etag: `"${ASSET_ID}"`, byteLength: 94_915 },
    ...extra,
  };
}

/** Sammelt Aufrufe und beantwortet sie aus einer Warteschlange von Antworten. */
function stubFetch(responses: Array<Response | (() => Promise<Response>)>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unerwarteter Aufruf: ${url}`);
    return typeof next === 'function' ? await next() : next;
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

/** Manuell gesteuerte Timer — kein `setTimeout`, keine Wartezeit im Test. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    pending,
    scheduleTimer: (run: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, run);
      return handle;
    },
    cancelTimer: (handle: unknown) => { pending.delete(handle as number); },
    fire(): void {
      const [handle, run] = [...pending.entries()][0] ?? [];
      if (handle === undefined || !run) throw new Error('kein Timer offen');
      pending.delete(handle);
      run();
    },
  };
}

function client(
  responses: Array<Response | (() => Promise<Response>)>,
  overrides: Parameters<typeof createAmbientMapClient>[0] = {},
) {
  const { calls, fetcher } = stubFetch(responses);
  const timers = manualTimers();
  const instance = createAmbientMapClient({
    fetcher,
    geolocation: null,
    secureContext: () => true,
    scheduleTimer: timers.scheduleTimer,
    cancelTimer: timers.cancelTimer,
    ...overrides,
  });
  return { calls, timers, ...instance };
}

describe('parseAmbientMapStatus', () => {
  it('übernimmt eine gültige Antwort vollständig', () => {
    expect(parseAmbientMapStatus(readyStatus({ source: 'manual', label: ' Saarburg ' }))).toEqual({
      state: 'ready',
      errorCode: null,
      radiusMetres: 2_000,
      assetUrl: ASSET_URL,
      source: 'manual',
      label: 'Saarburg',
    });
  });

  it('verwirft Asset-URLs außerhalb des festen Hauser-Formats', () => {
    for (const url of [
      '/assets/ambient-maps/../secret.svg',
      `/assets/ambient-maps/${ASSET_ID.toUpperCase()}.svg`,
      `https://fremd.example/assets/ambient-maps/${ASSET_ID}.svg`,
      `/assets/room-images/${ASSET_ID}.svg`,
      `/assets/ambient-maps/${'a'.repeat(63)}.svg`,
    ]) {
      const parsed = parseAmbientMapStatus(readyStatus({ asset: { url } }));
      expect(parsed?.assetUrl).toBeNull();
      /* Ohne gültiges Asset sind Radius und Quelle bedeutungslos. */
      expect(parsed?.radiusMetres).toBeNull();
    }
  });

  it('verwirft unbekannte Zustände und Nicht-Objekte', () => {
    expect(parseAmbientMapStatus({ state: 'weird' })).toBeNull();
    expect(parseAmbientMapStatus(null)).toBeNull();
    expect(parseAmbientMapStatus([{ state: 'ready' }])).toBeNull();
  });
});

describe('parseAmbientMapCoordinate', () => {
  it('akzeptiert Punkt und Komma als Dezimaltrenner', () => {
    expect(parseAmbientMapCoordinate(' 49.6069 ')).toBe(49.6069);
    expect(parseAmbientMapCoordinate('6,5508')).toBe(6.5508);
    expect(parseAmbientMapCoordinate('-90')).toBe(-90);
  });

  it('lehnt alles ab, was keine reine Dezimalzahl ist', () => {
    for (const value of ['', '  ', 'abc', '49.6069N', '1e3', '49..1', '49,60,69']) {
      expect(parseAmbientMapCoordinate(value)).toBeNull();
    }
  });
});

describe('Statusabruf', () => {
  it('liest den öffentlichen Status und übernimmt ihn', async () => {
    const c = client([jsonResponse(200, readyStatus())]);
    await c.refresh();
    expect(c.calls[0].url).toBe(AMBIENT_MAP_STATUS_URL);
    expect(c.state.state).toBe('ready');
    expect(c.state.assetUrl).toBe(ASSET_URL);
    expect(c.state.radiusMetres).toBe(2_000);
    expect(c.state.loaded).toBe(true);
  });

  it('nutzt für die Einstellungen den Adminstatus mit Quelle und Label', async () => {
    const c = client([jsonResponse(200, readyStatus({ source: 'home_assistant', label: 'Saarburg' }))]);
    await c.refresh({ admin: true });
    expect(c.calls[0].url).toBe(AMBIENT_MAP_ADMIN_STATUS_URL);
    expect(c.state.source).toBe('home_assistant');
    expect(c.state.label).toBe('Saarburg');
  });

  it('fällt ohne Adminsitzung auf den sanitisierten öffentlichen Status zurück', async () => {
    const c = client([jsonResponse(401, {}), jsonResponse(200, readyStatus())]);
    await c.refresh({ admin: true });
    expect(c.calls.map((call) => call.url)).toEqual([AMBIENT_MAP_ADMIN_STATUS_URL, AMBIENT_MAP_STATUS_URL]);
    expect(c.state.state).toBe('ready');
    expect(c.state.source).toBeNull();
  });

  it('lässt ein geladenes Asset bei einem fehlgeschlagenen Abruf aktiv', async () => {
    const c = client([
      jsonResponse(200, readyStatus()),
      () => Promise.reject(new Error('offline')),
    ]);
    await c.refresh();
    await c.refresh();
    expect(c.state.assetUrl).toBe(ASSET_URL);
    expect(c.state.state).toBe('ready');
    expect(c.state.problem).toBe('status_unavailable');
  });

  it('lässt ein Asset auch bei state "error" aktiv (Serververtrag §6.1)', async () => {
    const c = client([jsonResponse(200, readyStatus({ state: 'error' }))]);
    await c.refresh();
    expect(c.state.state).toBe('error');
    expect(c.state.assetUrl).toBe(ASSET_URL);
  });
});

describe('Race-Schutz', () => {
  it('eine veraltete Statusantwort überschreibt den neueren Stand nicht', async () => {
    let releaseSlow: (() => void) | null = null;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const c = client([
      async () => { await slow; return jsonResponse(200, readyStatus({ radiusMetres: 800 })); },
      jsonResponse(200, readyStatus({ radiusMetres: 5_000 })),
    ]);

    const first = c.refresh();
    await c.refresh();
    expect(c.state.radiusMetres).toBe(5_000);

    releaseSlow!();
    await first;
    /* Die zuerst gestartete, später eingetroffene Antwort wird verworfen. */
    expect(c.state.radiusMetres).toBe(5_000);
  });

  it('eine Mutation entwertet eine noch laufende Statusabfrage', async () => {
    let releaseSlow: (() => void) | null = null;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const c = client([
      async () => { await slow; return jsonResponse(200, readyStatus()); },
      jsonResponse(202, { state: 'queued' }),
    ]);

    const pendingStatus = c.refresh();
    await c.useHomeAssistant();
    expect(c.state.state).toBe('queued');

    releaseSlow!();
    await pendingStatus;
    expect(c.state.state).toBe('queued');
    expect(c.state.assetUrl).toBeNull();
  });

  /* Dritte Richtung (S4-Auflage): der Ambient-Screen ist ab S5 ein zweiter
     `refresh`-Auslöser, eine Mutation kann also während ihres `await` veralten.
     Sie darf den neueren Stand nicht überschreiben — und muss `busy`
     zurücknehmen, sonst bliebe die Sektion bis zum Reload gesperrt. */
  it('eine veraltete Mutationsantwort überschreibt den neueren Stand nicht und gibt busy frei', async () => {
    let releaseSlow: (() => void) | null = null;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const c = client([
      async () => { await slow; return jsonResponse(202, { state: 'queued' }); },
      jsonResponse(200, readyStatus({ radiusMetres: 5_000 })),
    ]);

    const pendingMutation = c.useHomeAssistant();
    expect(c.state.busy).toBe(true);

    await c.refresh();
    expect(c.state.state).toBe('ready');
    expect(c.state.radiusMetres).toBe(5_000);

    releaseSlow!();
    await pendingMutation;
    /* Der neuere Serverstand bleibt stehen … */
    expect(c.state.state).toBe('ready');
    expect(c.state.radiusMetres).toBe(5_000);
    expect(c.state.assetUrl).toBe(ASSET_URL);
    expect(c.state.problem).toBeNull();
    /* … und die Sektion ist wieder bedienbar. */
    expect(c.state.busy).toBe(false);
    expect(c.timers.pending.size).toBe(0);
  });

  it('gibt busy auch frei, wenn eine fehlgeschlagene Mutation veraltet', async () => {
    let releaseSlow: (() => void) | null = null;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const c = client([
      async () => { await slow; return jsonResponse(500, {}); },
      jsonResponse(200, readyStatus()),
    ]);

    const pendingMutation = c.regenerate();
    await c.refresh();

    releaseSlow!();
    await pendingMutation;
    expect(c.state.busy).toBe(false);
    /* Der Fehler der veralteten Mutation wird nicht mehr angezeigt. */
    expect(c.state.problem).toBeNull();
    expect(c.state.state).toBe('ready');
  });
});

describe('Mutationen', () => {
  it('kehrt nach 202 sofort zurück und wartet nicht auf den Job', async () => {
    const c = client([jsonResponse(202, { state: 'queued' })]);
    await c.useHomeAssistant();
    expect(c.calls[0].url).toBe(AMBIENT_MAP_LOCATION_URL);
    expect(c.calls[0].init?.method).toBe('POST');
    expect(c.calls[0].init?.body).toBe(JSON.stringify({ source: 'home_assistant' }));
    expect(c.state.state).toBe('queued');
    expect(c.state.busy).toBe(false);
    expect(c.state.problem).toBeNull();
  });

  it('meldet 503 ausdrücklich als fehlenden Home-Assistant-Zugang', async () => {
    const c = client([jsonResponse(503, { code: 'HOME_ASSISTANT_UNAVAILABLE' })]);
    await c.useHomeAssistant();
    expect(c.state.problem).toBe('home_assistant_unavailable');
    expect(c.state.state).toBe('empty');
  });

  /* Der Server nutzt 503 für zwei verschiedene Dinge; nur der Code im Body
     trennt „kein HA-Zugang" von „Kartenspeicher nicht verfügbar". */
  it('trennt den nicht verfügbaren Kartenspeicher vom fehlenden HA-Zugang', async () => {
    const c = client([jsonResponse(503, { ok: false, code: 'AMBIENT_MAP_UNAVAILABLE' })]);
    await c.useHomeAssistant();
    expect(c.state.problem).toBe('unavailable');
  });

  it('erkennt den nicht verfügbaren Kartenspeicher auch im Statusabruf', async () => {
    const c = client([jsonResponse(503, { ok: false, code: 'AMBIENT_MAP_UNAVAILABLE' })]);
    await c.refresh();
    expect(c.state.problem).toBe('unavailable');
    expect(c.state.loaded).toBe(false);
  });

  it('unterscheidet fehlende Adminfreigabe von einem allgemeinen Fehler', async () => {
    const denied = client([jsonResponse(401, {})]);
    await denied.useHomeAssistant();
    expect(denied.state.problem).toBe('admin_required');

    const invalid = client([jsonResponse(400, { code: 'INVALID_REQUEST' })]);
    await invalid.useHomeAssistant();
    expect(invalid.state.problem).toBe('request_failed');
  });

  it('sendet manuelle Koordinaten erst nach clientseitiger Prüfung', async () => {
    const c = client([jsonResponse(202, { state: 'queued' })]);
    await c.submitManual('49,6069', '6.5508');
    expect(c.calls[0].init?.body)
      .toBe(JSON.stringify({ source: 'manual', latitude: 49.6069, longitude: 6.5508 }));
  });

  it('löst bei ungültigen manuellen Koordinaten keinen Request aus', async () => {
    const c = client([]);
    await c.submitManual('91', '6.5508');
    await c.submitManual('49.6069', 'Saarburg');
    expect(c.calls).toHaveLength(0);
    expect(c.state.problem).toBe('invalid_coordinates');
  });

  it('regenerate sendet exakt den leeren Body, den der Server verlangt', async () => {
    const c = client([jsonResponse(202, { state: 'queued' })]);
    await c.regenerate();
    expect(c.calls[0].url).toBe(AMBIENT_MAP_REGENERATE_URL);
    expect(c.calls[0].init?.body).toBe('{}');
  });
});

describe('Jobpolling', () => {
  it('pollt nur während queued/running und hört bei ready auf', async () => {
    const c = client([
      jsonResponse(202, { state: 'queued' }),
      jsonResponse(200, { version: 1, state: 'running' }),
      jsonResponse(200, readyStatus()),
    ]);
    await c.useHomeAssistant();
    expect(c.state.polling).toBe(true);
    expect(c.timers.pending.size).toBe(1);

    c.timers.fire();
    await flush();
    expect(c.state.state).toBe('running');
    expect(c.timers.pending.size).toBe(1);

    c.timers.fire();
    await flush();
    expect(c.state.state).toBe('ready');
    expect(c.state.polling).toBe(false);
    expect(c.timers.pending.size).toBe(0);
  });

  it('hält höchstens einen Timer offen und respektiert die Obergrenze', async () => {
    const c = client(
      [jsonResponse(202, { state: 'queued' }), ...Array.from({ length: 3 }, () => jsonResponse(200, { version: 1, state: 'running' }))],
      { pollMaxAttempts: 2 },
    );
    await c.useHomeAssistant();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(c.timers.pending.size).toBe(1);
      c.timers.fire();
      await flush();
    }
    /* Nach der Obergrenze wird nicht weiter gepollt — der Serverauftrag läuft
       trotzdem weiter und wird beim nächsten Statusabruf eingeholt. */
    expect(c.timers.pending.size).toBe(0);
    expect(c.state.polling).toBe(false);
    expect(c.state.state).toBe('running');
  });

  it('stop() beendet das Polling', async () => {
    const c = client([jsonResponse(202, { state: 'queued' })]);
    await c.useHomeAssistant();
    expect(c.timers.pending.size).toBe(1);
    c.stop();
    expect(c.timers.pending.size).toBe(0);
    expect(c.state.polling).toBe(false);
  });

  it('eine neue Mutation setzt das Pollbudget zurück', async () => {
    const c = client(
      [
        jsonResponse(202, { state: 'queued' }),
        jsonResponse(200, { version: 1, state: 'running' }),
        jsonResponse(202, { state: 'queued' }),
      ],
      { pollMaxAttempts: 5 },
    );
    await c.useHomeAssistant();
    c.timers.fire();
    await flush();
    expect(c.pollAttemptsLeft()).toBe(4);

    await c.regenerate();
    expect(c.pollAttemptsLeft()).toBe(5);
  });
});

describe('Browser-Ortung', () => {
  function geolocation(behaviour: (
    success: (position: { coords: { latitude: number; longitude: number } }) => void,
    error: (reason: unknown) => void,
  ) => void) {
    const options: unknown[] = [];
    const impl: AmbientMapGeolocationLike = {
      getCurrentPosition(success, error, opts) {
        options.push(opts);
        behaviour(success, error ?? (() => {}));
      },
    };
    return { impl, options };
  }

  it('fragt erst auf Aufruf, ohne hohe Genauigkeit, und sendet danach', async () => {
    const geo = geolocation((success) => success({ coords: { latitude: 49.6069, longitude: 6.5508 } }));
    const c = client([jsonResponse(202, { state: 'queued' })], { geolocation: geo.impl });

    expect(geo.options).toHaveLength(0);
    await c.locateDevice();

    expect(geo.options).toEqual([{ enableHighAccuracy: false, timeout: 15_000, maximumAge: 15_000 }]);
    expect(c.calls[0].init?.body)
      .toBe(JSON.stringify({ source: 'browser', latitude: 49.6069, longitude: 6.5508 }));
    expect(c.state.locating).toBe(false);
  });

  it('Ablehnung, Ausfall und Timeout lösen keine Mutation aus', async () => {
    for (const [code, problem] of [[1, 'geolocation_denied'], [2, 'geolocation_unavailable'], [3, 'geolocation_timeout']] as const) {
      const geo = geolocation((_success, error) => error({ code }));
      const c = client([], { geolocation: geo.impl });
      await c.locateDevice();
      expect(c.calls).toHaveLength(0);
      expect(c.state.problem).toBe(problem);
      expect(c.state.assetUrl).toBeNull();
      expect(c.state.locating).toBe(false);
    }
  });

  it('unsicherer Kontext fragt die Ortung gar nicht erst an', async () => {
    const geo = geolocation((success) => success({ coords: { latitude: 1, longitude: 2 } }));
    const c = client([], { geolocation: geo.impl, secureContext: () => false });
    await c.locateDevice();
    expect(geo.options).toHaveLength(0);
    expect(c.calls).toHaveLength(0);
    expect(c.state.problem).toBe('geolocation_insecure');
  });

  it('ohne Geolocation-Adapter bleibt es beim Hinweis', async () => {
    const c = client([]);
    await c.locateDevice();
    expect(c.calls).toHaveLength(0);
    expect(c.state.problem).toBe('geolocation_unavailable');
  });

  it('eine ungültige Position wird nicht gesendet', async () => {
    const geo = geolocation((success) => success({ coords: { latitude: 200, longitude: 6.5 } }));
    const c = client([], { geolocation: geo.impl });
    await c.locateDevice();
    expect(c.calls).toHaveLength(0);
    expect(c.state.problem).toBe('invalid_coordinates');
  });

  it('lässt ein vorhandenes Asset bei abgelehnter Ortung unverändert', async () => {
    const geo = geolocation((_success, error) => error({ code: 1 }));
    const c = client([jsonResponse(200, readyStatus())], { geolocation: geo.impl });
    await c.refresh();
    await c.locateDevice();
    expect(c.state.assetUrl).toBe(ASSET_URL);
    expect(c.state.state).toBe('ready');
  });
});

describe('onChange', () => {
  it('meldet jede Zustandsänderung an den reaktiven Spiegel', async () => {
    let changes = 0;
    const c = client([jsonResponse(200, readyStatus())], { onChange: () => { changes += 1; } });
    await c.refresh();
    expect(changes).toBeGreaterThan(0);
  });
});

/* B-27/AMBIENT-MAP: Ortssuche. Nominatim ist ein von Freiwilligen betriebener
   Dienst mit einer harten Grenze von einer Anfrage pro Sekunde — die Entprellung
   ist deshalb kein Komfort, sondern Vertragserfuellung. */
describe('Ortssuche', () => {
  function harness(fetchImpl: typeof fetch) {
    const timers: Array<{ run: () => void; delay: number }> = [];
    const client = createAmbientMapClient({
      fetcher: fetchImpl,
      geolocation: null,
      scheduleTimer: (run, delay) => { timers.push({ run, delay }); return timers.length; },
      cancelTimer: (handle) => { timers[(handle as number) - 1] = { run: () => {}, delay: 0 }; },
      searchDebounceMs: 600,
    });
    return { client, timers, flush: () => { const t = timers.at(-1); t?.run(); } };
  }

  const okResponse = (results: unknown) => new Response(JSON.stringify({ results }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

  it('sucht erst nach der Entprellung und nie unter drei Zeichen', async () => {
    const fetchImpl = vi.fn(async () => okResponse([]));
    const { client, timers } = harness(fetchImpl as unknown as typeof fetch);

    client.search('Do');
    expect(timers).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();

    client.search('Dortmund');
    expect(timers).toHaveLength(1);
    expect(timers[0].delay).toBe(600);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('übernimmt nur wohlgeformte Treffer und verwirft den Rest', async () => {
    const fetchImpl = vi.fn(async () => okResponse([
      { label: 'Dortmund, NRW, Deutschland', latitude: 51.5142, longitude: 7.4653 },
      { label: 'kaputt', latitude: 999, longitude: 0 },
      { label: '', latitude: 50, longitude: 7 },
      { latitude: 50, longitude: 7 },
    ]));
    const { client, flush } = harness(fetchImpl as unknown as typeof fetch);

    client.search('Dortmund');
    flush();
    await vi.waitFor(() => expect(client.state.searchResults).toHaveLength(1));
    expect(client.state.searchResults[0]).toEqual({
      label: 'Dortmund, NRW, Deutschland', latitude: 51.5142, longitude: 7.4653,
    });
    expect(client.state.searching).toBe(false);
  });

  /* Eine langsame Antwort darf eine neuere Trefferliste nicht ueberschreiben —
     sonst zeigt die Liste Orte zu einem Begriff, der laengst weitergetippt ist. */
  it('verwirft eine überholte Antwort', async () => {
    let releaseFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    const fetchImpl = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(okResponse([{ label: 'Marseille, France', latitude: 43.2965, longitude: 5.3698 }]));
    const { client, timers } = harness(fetchImpl as unknown as typeof fetch);

    client.search('Dortmund');
    timers[0].run();
    client.search('Marseille');
    timers.at(-1)!.run();
    await vi.waitFor(() => expect(client.state.searchResults).toHaveLength(1));
    releaseFirst(okResponse([{ label: 'Dortmund', latitude: 51.5, longitude: 7.4 }]));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(client.state.searchResults[0].label).toBe('Marseille, France');
  });

  it('meldet die Ratengrenze des Dienstes eigenständig', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ code: 'GEOCODE_RATE_LIMITED' }), { status: 429 }));
    const { client, flush } = harness(fetchImpl as unknown as typeof fetch);

    client.search('Dortmund');
    flush();

    await vi.waitFor(() => expect(client.state.problem).toBe('search_rate_limited'));
    expect(client.state.searchResults).toEqual([]);
  });

  it('räumt die Liste, sobald die Eingabe zu kurz wird', async () => {
    const fetchImpl = vi.fn(async () => okResponse([{ label: 'Dortmund', latitude: 51.5, longitude: 7.4 }]));
    const { client, flush } = harness(fetchImpl as unknown as typeof fetch);

    client.search('Dortmund');
    flush();
    await vi.waitFor(() => expect(client.state.searchResults).toHaveLength(1));

    client.search('Do');
    expect(client.state.searchResults).toEqual([]);
    expect(client.state.searching).toBe(false);
  });
});
