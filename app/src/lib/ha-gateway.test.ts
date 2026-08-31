import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { WebSocket as WsClient } from 'ws';
// @ts-expect-error Native Node ESM server contract.
import { createHaWebSocketGateway } from '../../server/ha-gateway.mjs';
// @ts-expect-error Native Node test without @types/node.
import http from 'node:http';

const SUPERVISOR_TOKEN = 'supervisor-token-fixture';
const HA_VERSION = '2026.8.1';

const servers: Array<{ close: (cb: () => void) => void }> = [];
const gateways: Array<{ close: () => void }> = [];
const clients: any[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) { try { client.close(); } catch { /* egal */ } }
  for (const gateway of gateways.splice(0)) gateway.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
});

/* Ein Home-Assistant-Core, der nur den Handshake und die Frames spricht, die
   das Gateway tatsächlich benutzt. */
class FakeUpstream {
  static OPEN = 1;
  static instances: FakeUpstream[] = [];
  readyState = FakeUpstream.OPEN;
  sent: any[] = [];
  closed = false;
  private listeners: Record<string, Array<(event: any) => void>> = {};
  constructor(public url: string, private options: { reject?: boolean } = {}) {
    FakeUpstream.instances.push(this);
    queueMicrotask(() => this.receive({ type: 'auth_required', ha_version: HA_VERSION }));
  }
  addEventListener(type: string, handler: (event: any) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: (event: any) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== handler);
  }
  emit(type: string, event: any = {}) { for (const handler of [...(this.listeners[type] ?? [])]) handler(event); }
  receive(message: unknown) { this.emit('message', { data: JSON.stringify(message) }); }
  send(payload: string) {
    const message = JSON.parse(payload);
    this.sent.push(message);
    if (message.type === 'auth') {
      queueMicrotask(() => this.receive(this.options.reject
        ? { type: 'auth_invalid' }
        : { type: 'auth_ok', ha_version: HA_VERSION }));
    }
  }
  close() { this.closed = true; this.emit('close'); }
}

function upstreamFactory(options: { reject?: boolean } = {}) {
  FakeUpstream.instances = [];
  return class extends FakeUpstream {
    constructor(url: string) { super(url, options); }
  } as unknown as typeof WebSocket;
}

async function serve(overrides: Record<string, unknown> = {}) {
  const gateway = createHaWebSocketGateway({
    connectionMode: 'supervisor',
    env: { SUPERVISOR_TOKEN },
    WebSocketImpl: upstreamFactory(),
    ...overrides,
  });
  gateways.push(gateway);
  const server = http.createServer((_req: any, res: any) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (req: any, socket: any, head: any) => {
    if (!gateway.handlesUpgrade(req)) { socket.destroy(); return; }
    gateway.handleUpgrade(req, socket, head);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { gateway, url: `ws://127.0.0.1:${port}${gateway.path}`, port };
}

function connect(url: string, options: Record<string, unknown> = {}) {
  const socket = new WsClient(url, options);
  clients.push(socket);
  const frames: any[] = [];
  const closes: number[] = [];
  socket.on('message', (data: any) => frames.push(JSON.parse(data.toString())));
  socket.on('close', (code: number) => closes.push(code));
  return { socket, frames, closes };
}

const waitFor = async (check: () => boolean, label = 'condition') => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

describe('Gateway-Aktivierung', () => {
  it('existiert im direkten Modus nicht', async () => {
    const gateway = createHaWebSocketGateway({ connectionMode: 'direct' });
    gateways.push(gateway);
    expect(gateway.enabled).toBe(false);
    expect(gateway.handlesUpgrade({ url: '/api/websocket' })).toBe(false);
  });

  it('erhebt ausschließlich den eigenen Pfad zum WebSocket', async () => {
    const { gateway } = await serve();
    expect(gateway.handlesUpgrade({ url: '/api/websocket' })).toBe(true);
    expect(gateway.handlesUpgrade({ url: '/api/websocket?x=1' })).toBe(true);
    for (const url of ['/api/config', '/', '/api/websocket/extra', '/api/ha/connection', '/api/setup/activate']) {
      expect(gateway.handlesUpgrade({ url })).toBe(false);
    }
  });

  it('weist eine fremde Origin ab', async () => {
    const { url } = await serve({ originAllowed: (req: any) => req.headers.origin === 'http://hauser.local' });
    const { closes, socket } = connect(url, { headers: { origin: 'https://evil.example' } });
    const errors: unknown[] = [];
    socket.on('error', (error: unknown) => errors.push(error));
    await waitFor(() => closes.length > 0 || errors.length > 0, 'rejected upgrade');
    expect(FakeUpstream.instances).toHaveLength(0);
  });
});

describe('Handshake ohne Credentialweitergabe', () => {
  it('beantwortet den HA-Handshake selbst und meldet die echte HA-Version', async () => {
    const { url } = await serve();
    const { socket, frames } = connect(url);
    await waitFor(() => frames.length > 0, 'auth_required');
    expect(frames[0]).toEqual({ type: 'auth_required', ha_version: HA_VERSION });
    socket.send(JSON.stringify({ type: 'auth', access_token: 'browser-placeholder' }));
    await waitFor(() => frames.length > 1, 'auth_ok');
    expect(frames[1]).toEqual({ type: 'auth_ok', ha_version: HA_VERSION });
  });

  it('authentifiziert sich intern mit dem Supervisor-Token und reicht den Browserwert nie weiter', async () => {
    const { url } = await serve();
    const { socket, frames } = connect(url);
    await waitFor(() => frames.length > 0, 'auth_required');
    socket.send(JSON.stringify({ type: 'auth', access_token: 'browser-placeholder' }));
    await waitFor(() => frames.length > 1, 'auth_ok');
    const upstream = FakeUpstream.instances[0];
    expect(upstream.sent[0]).toEqual({ type: 'auth', access_token: SUPERVISOR_TOKEN });
    expect(upstream.sent.some((message) => JSON.stringify(message).includes('browser-placeholder'))).toBe(false);
    expect(JSON.stringify(frames)).not.toContain(SUPERVISOR_TOKEN);
  });

  it('spiegelt keine Auth-Frames des Cores an den Browser', async () => {
    const { url } = await serve();
    const { socket, frames } = connect(url);
    await waitFor(() => frames.length > 0, 'auth_required');
    socket.send(JSON.stringify({ type: 'auth', access_token: 'x' }));
    await waitFor(() => frames.length > 1, 'auth_ok');
    FakeUpstream.instances[0].receive({ type: 'auth_ok', access_token: SUPERVISOR_TOKEN });
    FakeUpstream.instances[0].receive({ type: 'auth_invalid' });
    FakeUpstream.instances[0].receive({ id: 1, type: 'result', success: true, result: [] });
    await waitFor(() => frames.length > 2, 'result');
    expect(frames.filter((frame) => String(frame.type).startsWith('auth'))).toHaveLength(2);
    expect(JSON.stringify(frames)).not.toContain(SUPERVISOR_TOKEN);
  });

  it('trennt fail-closed, wenn der interne Zugang fehlt', async () => {
    const { url } = await serve({ env: {} });
    const { closes, frames } = connect(url);
    await waitFor(() => closes.length > 0, 'close');
    expect(frames).toHaveLength(0);
    expect(FakeUpstream.instances).toHaveLength(0);
  });

  it('trennt fail-closed, wenn Home Assistant den internen Zugang ablehnt', async () => {
    const { url } = await serve({ WebSocketImpl: upstreamFactory({ reject: true }) });
    const { closes, frames } = connect(url);
    await waitFor(() => closes.length > 0, 'close');
    expect(frames).toHaveLength(0);
  });
});

describe('Nachrichtenallowlist', () => {
  const authenticate = async (url: string) => {
    const client = connect(url);
    await waitFor(() => client.frames.length > 0, 'auth_required');
    client.socket.send(JSON.stringify({ type: 'auth', access_token: 'x' }));
    await waitFor(() => client.frames.length > 1, 'auth_ok');
    return client;
  };

  it('leitet erlaubte Anfragen und HA-Antworten durch', async () => {
    const { url } = await serve();
    const client = await authenticate(url);
    client.socket.send(JSON.stringify({ id: 1, type: 'subscribe_entities' }));
    await waitFor(() => FakeUpstream.instances[0].sent.length > 1, 'forwarded');
    expect(FakeUpstream.instances[0].sent[1]).toEqual({ id: 1, type: 'subscribe_entities' });
    FakeUpstream.instances[0].receive({ id: 1, type: 'event', event: { a: { 'light.k': { s: 'on' } } } });
    await waitFor(() => client.frames.length > 2, 'event');
    expect(client.frames[2]).toMatchObject({ id: 1, type: 'event' });
  });

  it('trennt bei einem nicht freigegebenen Nachrichtentyp statt ihn weiterzuleiten', async () => {
    for (const type of ['supervisor/info', 'config/auth/create', 'auth/long_lived_access_token', 'hassio/addon/info']) {
      const { url } = await serve();
      const client = await authenticate(url);
      const forwardedBefore = FakeUpstream.instances[0].sent.length;
      client.socket.send(JSON.stringify({ id: 2, type }));
      await waitFor(() => client.closes.length > 0, `close for ${type}`);
      expect(client.closes[0]).toBe(1008);
      expect(FakeUpstream.instances[0].sent).toHaveLength(forwardedBefore);
    }
  });

  it('verwirft unbekannte HA-Frames, statt sie an den Browser zu geben', async () => {
    const { url } = await serve();
    const client = await authenticate(url);
    FakeUpstream.instances[0].receive({ type: 'supervisor/event', data: 'nope' });
    FakeUpstream.instances[0].receive({ id: 5, type: 'result', success: true, result: 'ok' });
    await waitFor(() => client.frames.length > 2, 'result');
    expect(client.frames.map((frame: any) => frame.type)).toEqual(['auth_required', 'auth_ok', 'result']);
  });

  it('lässt vor dem Browser-Handshake keine Kommandos durch', async () => {
    const { url } = await serve();
    const client = connect(url);
    await waitFor(() => client.frames.length > 0, 'auth_required');
    client.socket.send(JSON.stringify({ id: 1, type: 'get_states' }));
    await waitFor(() => client.closes.length > 0, 'close');
    expect(client.closes[0]).toBe(1008);
    expect(FakeUpstream.instances[0].sent).toHaveLength(1);
  });
});

describe('Ressourcen und Verbindungsende', () => {
  it('schließt den internen Upstream, wenn der Browser geht', async () => {
    const { url, gateway } = await serve();
    const client = connect(url);
    await waitFor(() => client.frames.length > 0, 'auth_required');
    expect(gateway.openSessions).toBe(1);
    client.socket.close();
    await waitFor(() => FakeUpstream.instances[0].closed, 'upstream closed');
    expect(gateway.openSessions).toBe(0);
  });

  it('trennt den Browser, wenn die interne Verbindung endet', async () => {
    const { url } = await serve();
    const client = connect(url);
    await waitFor(() => client.frames.length > 0, 'auth_required');
    FakeUpstream.instances[0].close();
    await waitFor(() => client.closes.length > 0, 'downstream closed');
  });

  it('gibt beim Schließen des Gateways alle Sitzungen frei', async () => {
    const { url, gateway } = await serve();
    const client = connect(url);
    await waitFor(() => client.frames.length > 0, 'auth_required');
    gateway.close();
    await waitFor(() => client.closes.length > 0, 'downstream closed');
    expect(gateway.openSessions).toBe(0);
  });
});
