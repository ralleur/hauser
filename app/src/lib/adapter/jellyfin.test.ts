import { describe, it, expect, vi } from 'vitest';
import { JellyfinClient, JellyfinAuthError } from './jellyfin.ts';

/* ── Mock-fetch: nimmt eine Antwort-Fabrik, protokolliert Aufrufe ── */
type Call = { url: string; init?: RequestInit };

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as unknown as Response;
}

function mockFetch(responder: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responder(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const BASE = 'http://jf.test:8096';

function authedClient(responder: (url: string, init?: RequestInit) => Response) {
  const { fn, calls } = mockFetch(responder);
  const client = new JellyfinClient({
    baseUrl: BASE,
    fetchImpl: fn,
    deviceId: 'dev-fixed',
    token: 'tok-123',
    userId: 'user-9',
  });
  return { client, calls };
}

describe('Auth-Header', () => {
  it('enthält Client/Device/DeviceId/Version, aber ohne Token vor dem Login', () => {
    const c = new JellyfinClient({ baseUrl: BASE, deviceId: 'dev-fixed', token: null, userId: null });
    const h = c.authHeader();
    expect(h).toContain('Client="SmartHomeHMI"');
    expect(h).toContain('Device="WallTablet"');
    expect(h).toContain('DeviceId="dev-fixed"');
    expect(h).toContain('Version=');
    expect(h).not.toContain('Token=');
  });

  it('trägt den Token nach dem Login', () => {
    const c = new JellyfinClient({ baseUrl: BASE, deviceId: 'dev-fixed', token: 'tok-123', userId: 'user-9' });
    expect(c.authHeader()).toContain('Token="tok-123"');
  });

  it('deviceId ist stabil über die Instanz', () => {
    const c = new JellyfinClient({ baseUrl: BASE, deviceId: 'dev-fixed' });
    expect(c.deviceId).toBe('dev-fixed');
  });
});

describe('authenticateByName', () => {
  it('persistiert AccessToken + User.Id und öffnet die Session', async () => {
    const { fn, calls } = mockFetch(() =>
      jsonResponse({ AccessToken: 'new-token', User: { Id: 'u-42', Name: 'sam' } }),
    );
    const c = new JellyfinClient({ baseUrl: BASE, fetchImpl: fn, deviceId: 'dev', token: null, userId: null });
    expect(c.hasSession()).toBe(false);

    const s = await c.authenticateByName('sam', 'geheim');
    expect(s.User.Id).toBe('u-42');
    expect(c.hasSession()).toBe(true);
    expect(c.userId).toBe('u-42');
    expect(c.authHeader()).toContain('Token="new-token"');

    // POST an den richtigen Endpunkt mit Auth-Header + JSON-Body
    expect(calls[0].url).toBe(`${BASE}/Users/AuthenticateByName`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ Username: 'sam', Pw: 'geheim' });
  });

  it('401 → JellyfinAuthError, keine Session', async () => {
    const { fn } = mockFetch(() => jsonResponse({}, 401));
    const c = new JellyfinClient({ baseUrl: BASE, fetchImpl: fn, deviceId: 'dev', token: null, userId: null });
    await expect(c.authenticateByName('x', 'y')).rejects.toBeInstanceOf(JellyfinAuthError);
    expect(c.hasSession()).toBe(false);
  });

  it('kann eine Setup-Anmeldung prüfen, ohne die Session vor der Aktivierung zu persistieren', async () => {
    const centralWrites = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}));
    const { fn } = mockFetch(() =>
      jsonResponse({ AccessToken: 'setup-token', User: { Id: 'setup-user', Name: 'setup' } }),
    );
    const c = new JellyfinClient({ baseUrl: BASE, fetchImpl: fn, deviceId: 'dev', token: null, userId: null });

    const session = await c.authenticateByName('setup', 'secret', { persist: false });

    expect(session).toMatchObject({ AccessToken: 'setup-token', User: { Id: 'setup-user' } });
    expect(c.hasSession()).toBe(true);
    expect(centralWrites).not.toHaveBeenCalled();
    centralWrites.mockRestore();
  });
});

describe('Browse-Endpunkte', () => {
  it('views: entpackt {Items}', async () => {
    const { client, calls } = authedClient(() => jsonResponse({ Items: [{ Id: 'v1' }, { Id: 'v2' }] }));
    const views = await client.views();
    expect(views.map((v) => v.Id)).toEqual(['v1', 'v2']);
    expect(calls[0].url).toBe(`${BASE}/Users/user-9/Views`);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toContain('Token="tok-123"');
  });

  it('resume: Limit + MediaTypes=Video', async () => {
    const { client, calls } = authedClient(() => jsonResponse({ Items: [{ Id: 'r1' }] }));
    const items = await client.resume(5);
    expect(items).toHaveLength(1);
    expect(calls[0].url).toContain('/Users/user-9/Items/Resume?');
    expect(calls[0].url).toContain('Limit=5');
    expect(calls[0].url).toContain('MediaTypes=Video');
  });

  it('latest: nacktes Array (kein {Items})', async () => {
    const { client, calls } = authedClient(() => jsonResponse([{ Id: 'l1' }, { Id: 'l2' }]));
    const items = await client.latest(2);
    expect(items.map((i) => i.Id)).toEqual(['l1', 'l2']);
    expect(calls[0].url).toContain('/Users/user-9/Items/Latest?');
    expect(calls[0].url).toContain('IncludeItemTypes=Movie%2CSeries');
  });

  it('nextUp: /Shows/NextUp mit userId', async () => {
    const { client, calls } = authedClient(() => jsonResponse({ Items: [{ Id: 'n1' }] }));
    await client.nextUp(3);
    expect(calls[0].url).toContain('/Shows/NextUp?');
    expect(calls[0].url).toContain('userId=user-9');
    expect(calls[0].url).toContain('Limit=3');
  });

  it('items: baut ParentId/Sort/Recursive korrekt', async () => {
    const { client, calls } = authedClient(() => jsonResponse({ Items: [] }));
    await client.items({ parentId: 'lib-movies', includeItemTypes: 'Movie', limit: 50 });
    const url = calls[0].url;
    expect(url).toContain('/Users/user-9/Items?');
    expect(url).toContain('ParentId=lib-movies');
    expect(url).toContain('IncludeItemTypes=Movie');
    expect(url).toContain('SortBy=SortName');
    expect(url).toContain('Recursive=true');
    expect(url).toContain('Limit=50');
  });

  it('item/seasons/episodes treffen die richtigen Pfade', async () => {
    const { client, calls } = authedClient((url) =>
      url.includes('/Episodes') ? jsonResponse({ Items: [{ Id: 'e1' }] })
      : url.includes('/Seasons') ? jsonResponse({ Items: [{ Id: 's1' }] })
      : jsonResponse({ Id: 'series-1' }),
    );
    expect((await client.item('series-1')).Id).toBe('series-1');
    expect(await client.seasons('series-1')).toHaveLength(1);
    expect(await client.episodes('series-1', 's1')).toHaveLength(1);
    expect(calls[0].url).toContain('/Users/user-9/Items/series-1');
    expect(calls[1].url).toBe(`${BASE}/Shows/series-1/Seasons?userId=user-9`);
    expect(calls[2].url).toContain('/Shows/series-1/Episodes?');
    expect(calls[2].url).toContain('seasonId=s1');
  });
});

describe('Fehlerbehandlung', () => {
  it('401 im Browse → Session verworfen, onAuthError, JellyfinAuthError', async () => {
    const { fn } = mockFetch(() => jsonResponse({}, 401));
    const c = new JellyfinClient({ baseUrl: BASE, fetchImpl: fn, deviceId: 'dev', token: 'tok', userId: 'u' });
    const onAuth = vi.fn();
    c.onAuthError(onAuth);
    await expect(c.views()).rejects.toBeInstanceOf(JellyfinAuthError);
    expect(onAuth).toHaveBeenCalledOnce();
    expect(c.hasSession()).toBe(false);
  });

  it('sonstiger HTTP-Fehler → generischer Error (kein Auth-Fehler)', async () => {
    const { client } = authedClient(() => jsonResponse({}, 503));
    await expect(client.views()).rejects.toThrow(/HTTP 503/);
  });

  it('ohne Session → requireUser wirft JellyfinAuthError', async () => {
    const { fn } = mockFetch(() => jsonResponse({}));
    const c = new JellyfinClient({ baseUrl: BASE, fetchImpl: fn, deviceId: 'dev', token: null, userId: null });
    await expect(c.resume()).rejects.toBeInstanceOf(JellyfinAuthError);
    expect(fn).not.toHaveBeenCalled(); // gar kein Request abgesetzt
  });
});

describe('imageUrl', () => {
  it('Primary mit tag + maxWidth', () => {
    const { client } = authedClient(() => jsonResponse({}));
    const url = client.imageUrl('item-1', { tag: 'abc', maxWidth: 320 });
    expect(url).toBe(`${BASE}/Items/item-1/Images/Primary?tag=abc&maxWidth=320`);
  });
  it('Backdrop-Typ + ohne Query', () => {
    const { client } = authedClient(() => jsonResponse({}));
    expect(client.imageUrl('item-1', { type: 'Backdrop' })).toBe(`${BASE}/Items/item-1/Images/Backdrop`);
  });
  it('trägt keinen Token in die Bild-URL (browser-cachebar)', () => {
    const { client } = authedClient(() => jsonResponse({}));
    expect(client.imageUrl('item-1', { tag: 't' })).not.toContain('tok-123');
  });
});

describe('Wiedergabe (Funktionsumfang 9)', () => {
  it('postPlaybackInfo: POST an /Items/{id}/PlaybackInfo mit userId + DeviceProfile', async () => {
    const { client, calls } = authedClient(() =>
      jsonResponse({ PlaySessionId: 'sess-1', MediaSources: [{ Id: 'ms-1', SupportsDirectPlay: true }] }));
    const info = await client.postPlaybackInfo('item-9', { startPositionTicks: 30_000_000 });
    expect(info.PlaySessionId).toBe('sess-1');
    const call = calls[0];
    expect(call.url).toContain(`${BASE}/Items/item-9/PlaybackInfo?`);
    expect(call.url).toContain('userId=user-9');
    expect(call.url).toContain('StartTimeTicks=30000000');
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(call.init!.body as string)).toHaveProperty('DeviceProfile');
  });

  it('streamUrl: HLS-Master mit api_key (anders als imageUrl)', () => {
    const { client } = authedClient(() => jsonResponse({}));
    const url = client.streamUrl('item-9', {
      source: { Id: 'ms-1' }, mediaSourceId: 'ms-1', playSessionId: 'sess-1', playMethod: 'DirectStream',
    });
    expect(url).toContain(`${BASE}/Videos/item-9/master.m3u8?`);
    expect(url).toContain('api_key=tok-123');
    expect(url).toContain('mediaSourceId=ms-1');
  });

  it('reportProgress: POST an /Sessions/Playing/Progress mit PositionTicks', async () => {
    const { client, calls } = authedClient(() => jsonResponse({}, 204));
    client.reportProgress({
      ItemId: 'item-9', PlaySessionId: 'sess-1', MediaSourceId: 'ms-1',
      PositionTicks: 55_000_000, IsPaused: false,
    });
    await Promise.resolve(); // fire-and-forget: den Microtask abwarten
    expect(calls[0].url).toBe(`${BASE}/Sessions/Playing/Progress`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init!.body as string).PositionTicks).toBe(55_000_000);
  });

  it('reportStart/reportStopped treffen die richtigen Endpunkte', async () => {
    const { client, calls } = authedClient(() => jsonResponse({}, 204));
    const body = { ItemId: 'i', PlaySessionId: 's', MediaSourceId: 'm', PositionTicks: 0 };
    client.reportStart(body);
    client.reportStopped(body);
    await Promise.resolve();
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/Sessions/Playing`,
      `${BASE}/Sessions/Playing/Stopped`,
    ]);
  });

  it('reportProgress schluckt Netzwerkfehler (best-effort, kein Wurf)', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const client = new JellyfinClient({ baseUrl: BASE, fetchImpl: failing, deviceId: 'd', token: 't', userId: 'u' });
    expect(() => client.reportProgress({
      ItemId: 'i', PlaySessionId: 's', MediaSourceId: 'm', PositionTicks: 0,
    })).not.toThrow();
    await Promise.resolve();
  });
});
