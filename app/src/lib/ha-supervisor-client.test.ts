import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error native .mjs runtime contract
import { HA_SUPERVISOR_REST_BASE_URL, HA_SUPERVISOR_WEBSOCKET_URL, createHaSupervisorClient, parseHaConnectionMode, readSupervisorToken, redactSupervisorToken } from '../../server/ha-supervisor.mjs';

const TOKEN = 'supervisor-token-fixture';
const env = (token: string | undefined = TOKEN) => (token === undefined ? {} : { SUPERVISOR_TOKEN: token });

function jsonResponse(status: number, body: unknown) {
  return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}

class FakeSocket {
  static OPEN = 1;
  readyState = FakeSocket.OPEN;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Array<(event: any) => void>> = {};
  constructor(public url: string) { sockets.push(this); }
  addEventListener(type: string, handler: (event: any) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: (event: any) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== handler);
  }
  emit(type: string, event: any = {}) {
    for (const handler of [...(this.listeners[type] ?? [])]) handler(event);
  }
  receive(message: unknown) { this.emit('message', { data: JSON.stringify(message) }); }
  send(payload: string) {
    this.sent.push(payload);
    const message = JSON.parse(payload);
    if (message.type === 'auth') queueMicrotask(() => this.receive({ type: authReply }));
  }
  close() { this.closed = true; }
}

let sockets: FakeSocket[] = [];
let authReply = 'auth_ok';

function client(overrides: Record<string, unknown> = {}) {
  sockets = [];
  return createHaSupervisorClient({
    env: env(),
    WebSocketImpl: FakeSocket,
    fetchImpl: async () => jsonResponse(200, { ok: true }),
    timeoutMs: 50,
    ...overrides,
  });
}

describe('HMI_HA_CONNECTION_MODE', () => {
  it('bleibt ohne Wert im direkten Modus', () => {
    expect(parseHaConnectionMode(undefined)).toBe('direct');
    expect(parseHaConnectionMode('')).toBe('direct');
  });

  it('erlaubt genau die beiden dokumentierten Werte', () => {
    expect(parseHaConnectionMode('direct')).toBe('direct');
    expect(parseHaConnectionMode('supervisor')).toBe('supervisor');
  });

  it('bricht bei jedem anderen Wert ab statt still auf direct zurückzufallen', () => {
    for (const value of ['Supervisor', ' supervisor', 'ingress', '1', 'true']) {
      expect(() => parseHaConnectionMode(value)).toThrowError(
        expect.objectContaining({ code: 'HA_CONNECTION_MODE_INVALID' }),
      );
    }
  });
});

describe('Supervisor-Token', () => {
  it('liest den Token aus der Prozessumgebung', () => {
    expect(readSupervisorToken(env())).toBe(TOKEN);
    expect(readSupervisorToken({ SUPERVISOR_TOKEN: `  ${TOKEN}  ` })).toBe(TOKEN);
  });

  it('meldet ein fehlendes oder leeres Token als nicht vorhanden', () => {
    expect(readSupervisorToken({})).toBeNull();
    expect(readSupervisorToken({ SUPERVISOR_TOKEN: '   ' })).toBeNull();
  });

  it('redigiert den Token in Strings, Fehlern und serialisierten Objekten', () => {
    expect(redactSupervisorToken(`Bearer ${TOKEN}`, TOKEN)).toBe('Bearer [redacted]');
    const error = redactSupervisorToken(new Error(`auth ${TOKEN} rejected`), TOKEN);
    expect((error as Error).message).toBe('auth [redacted] rejected');
    expect(redactSupervisorToken({ headers: { authorization: `Bearer ${TOKEN}` } }, TOKEN))
      .toEqual({ headers: { authorization: 'Bearer [redacted]' } });
  });

  it('hält den Token aus dem serialisierten Client heraus', () => {
    const serialized = JSON.stringify(client());
    expect(serialized).not.toContain(TOKEN);
    expect(JSON.parse(serialized)).toEqual({
      mode: 'supervisor',
      restBaseUrl: HA_SUPERVISOR_REST_BASE_URL,
      websocketUrl: HA_SUPERVISOR_WEBSOCKET_URL,
      tokenPresent: true,
    });
  });
});

describe('interner REST-Zugang', () => {
  it('spricht die festen Supervisor-Endpunkte mit dem Prozess-Token an', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{ entity_id: 'light.kitchen' }]));
    const result = await client({ fetchImpl }).rest('GET', '/api/states');
    expect(result).toEqual({ status: 200, body: [{ entity_id: 'light.kitchen' }] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://supervisor/core/api/states');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('scheitert ohne Token fail-closed statt auf einen Nutzer-Token auszuweichen', async () => {
    const fetchImpl = vi.fn();
    const offline = client({ env: {}, fetchImpl });
    expect(offline.available).toBe(false);
    await expect(offline.rest('GET', '/api/config')).rejects.toMatchObject({
      code: 'HA_SUPERVISOR_TOKEN_MISSING',
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('bildet abgelehnte Auth, Timeout, Verbindungsabbruch und Schrottantworten ab', async () => {
    await expect(client({ fetchImpl: async () => jsonResponse(401, null) }).rest('GET', '/api/config'))
      .rejects.toMatchObject({ code: 'HA_SUPERVISOR_AUTH_FAILED' });
    await expect(client({
      fetchImpl: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
    }).rest('GET', '/api/config')).rejects.toMatchObject({ code: 'HA_SUPERVISOR_TIMEOUT', status: 504 });
    await expect(client({
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    }).rest('GET', '/api/config')).rejects.toMatchObject({ code: 'HA_SUPERVISOR_UNREACHABLE' });
    await expect(client({
      fetchImpl: async () => ({ status: 200, text: async () => { throw new Error('socket hang up'); } }),
    }).rest('GET', '/api/config')).rejects.toMatchObject({ code: 'HA_SUPERVISOR_CONNECTION_LOST' });
    await expect(client({
      fetchImpl: async () => ({ status: 200, text: async () => 'not json' }),
    }).rest('GET', '/api/config')).rejects.toMatchObject({ code: 'HA_SUPERVISOR_INVALID_RESPONSE' });
  });

  it('serialisiert Fehler ohne Token', async () => {
    const failure = await client({ fetchImpl: async () => jsonResponse(403, null) })
      .rest('GET', '/api/config').catch((error: Error) => error);
    expect(JSON.stringify(failure)).toBe(JSON.stringify({
      name: 'HaSupervisorError',
      code: 'HA_SUPERVISOR_AUTH_FAILED',
      status: 502,
      message: 'Home Assistant hat den internen App-Zugang abgelehnt.',
    }));
  });
});

describe('interner WebSocket-Zugang', () => {
  it('authentifiziert sich am internen HA-Core-WebSocket', async () => {
    authReply = 'auth_ok';
    const connection = client();
    const pending = connection.ws('config/area_registry/list');
    await vi.waitFor(() => expect(sockets[0]).toBeDefined());
    sockets[0].receive({ type: 'auth_required' });
    await vi.waitFor(() => expect(sockets[0].sent.length).toBe(2));
    expect(sockets[0].url).toBe(HA_SUPERVISOR_WEBSOCKET_URL);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ type: 'auth', access_token: TOKEN });
    sockets[0].receive({ id: 1, type: 'result', success: true, result: [{ area_id: 'kitchen' }] });
    await expect(pending).resolves.toEqual([{ area_id: 'kitchen' }]);
    connection.close();
    expect(sockets[0].closed).toBe(true);
  });

  it('meldet eine abgelehnte interne Anmeldung und schließt die Verbindung', async () => {
    authReply = 'auth_invalid';
    const connection = client();
    const pending = connection.ws('config/area_registry/list');
    await vi.waitFor(() => expect(sockets[0]).toBeDefined());
    sockets[0].receive({ type: 'auth_required' });
    await expect(pending).rejects.toMatchObject({ code: 'HA_SUPERVISOR_AUTH_FAILED' });
    expect(sockets[0].closed).toBe(true);
    authReply = 'auth_ok';
  });

  it('öffnet ohne Token gar keine Verbindung', async () => {
    const connection = client({ env: {} });
    await expect(connection.ws('config/area_registry/list')).rejects.toMatchObject({
      code: 'HA_SUPERVISOR_TOKEN_MISSING',
    });
    expect(sockets).toHaveLength(0);
  });
});
