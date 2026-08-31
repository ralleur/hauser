import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import http from 'node:http';
// @ts-expect-error Native Node ESM server contract.
import { createHaWebSocketGateway } from '../../server/ha-gateway.mjs';
import { HaBackend } from './adapter/ha-backend.ts';
import { configuredHaTransport, rememberHaTransport } from './adapter/runtime.svelte.ts';
import { syncHaTransport } from './state/runtime-backend-sync.ts';

const SUPERVISOR_TOKEN = 'supervisor-token-fixture';
const HA_VERSION = '2026.8.1';

const servers: Array<{ close: (cb: () => void) => void }> = [];
const upgradeLog: string[][] = [];
const gateways: Array<{ close: () => void }> = [];
const backends: HaBackend[] = [];

afterEach(async () => {
  upgradeLog.splice(0);
  backends.splice(0);
  for (const gateway of gateways.splice(0)) gateway.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  delete (globalThis as any).location;
});

/* Ein Home-Assistant-Core, der genau die Frames spricht, die das read-only
   Backend im App-Modus braucht. */
class FakeUpstream {
  static OPEN = 1;
  static instances: FakeUpstream[] = [];
  readyState = FakeUpstream.OPEN;
  received: any[] = [];
  private listeners: Record<string, Array<(event: any) => void>> = {};
  constructor(public url: string) {
    FakeUpstream.instances.push(this);
    queueMicrotask(() => this.emitMessage({ type: 'auth_required', ha_version: HA_VERSION }));
  }
  addEventListener(type: string, handler: (event: any) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: (event: any) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== handler);
  }
  emitMessage(message: unknown) {
    for (const handler of [...(this.listeners.message ?? [])]) handler({ data: JSON.stringify(message) });
  }
  send(payload: string) {
    const message = JSON.parse(payload);
    this.received.push(message);
    if (message.type === 'auth') {
      queueMicrotask(() => this.emitMessage({ type: 'auth_ok', ha_version: HA_VERSION }));
      return;
    }
    if (message.type === 'subscribe_entities') {
      queueMicrotask(() => {
        this.emitMessage({ id: message.id, type: 'result', success: true, result: null });
        this.emitMessage({
          id: message.id,
          type: 'event',
          event: { a: { 'light.living_ceiling': { s: 'on', a: { friendly_name: 'Ceiling' } } } },
        });
      });
      return;
    }
    queueMicrotask(() => this.emitMessage({ id: message.id, type: 'result', success: true, result: [] }));
  }
  close() { for (const handler of [...(this.listeners.close ?? [])]) handler({}); }
}

async function serveGateway() {
  FakeUpstream.instances = [];
  const gateway = createHaWebSocketGateway({
    connectionMode: 'supervisor',
    env: { SUPERVISOR_TOKEN },
    WebSocketImpl: FakeUpstream as unknown as typeof WebSocket,
  });
  gateways.push(gateway);
  const server = http.createServer((req: any, res: any) => {
    if (req.url === '/api/ha/connection') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode: 'supervisor', credentialsRequired: false, available: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req: any, socket: any, head: any) => {
    for (const log of upgradeLog) log.push(req.url);
    if (!gateway.handlesUpgrade(req)) { socket.destroy(); return; }
    gateway.handleUpgrade(req, socket, head);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { origin: `http://127.0.0.1:${port}` };
}

const waitFor = async (check: () => boolean, label = 'condition') => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

describe('Betriebsart aus der Laufzeitauskunft', () => {
  it('übernimmt den App-Modus vom Server und merkt ihn sich', async () => {
    const storage = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    };
    try {
      expect(configuredHaTransport()).toBe('direct');
      const { origin } = await serveGateway();
      await syncHaTransport(((path: string, init?: RequestInit) => fetch(`${origin}${path}`, init)) as typeof fetch);
      expect(configuredHaTransport()).toBe('gateway');
    } finally {
      delete (globalThis as any).localStorage;
    }
  });

  it('behält den bekannten Kanal, wenn die Auskunft scheitert', async () => {
    const storage = new Map<string, string>([['hmi:ha-transport', 'gateway']]);
    (globalThis as any).localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    };
    try {
      await syncHaTransport((async () => { throw new Error('offline'); }) as unknown as typeof fetch);
      expect(configuredHaTransport()).toBe('gateway');
    } finally {
      delete (globalThis as any).localStorage;
    }
  });
});

describe('Read-only Backend über das Gateway', () => {
  it('verbindet ohne Browser-Token, abonniert selektiv und rendert den State', async () => {
    const { origin } = await serveGateway();
    (globalThis as any).location = { origin, protocol: 'http:' };
    const backend = new HaBackend({
      url: () => 'http://unused.invalid:8123',
      transport: 'gateway',
      entityIds: ['light.living_ceiling'],
    });
    backends.push(backend);

    /* Ohne Token und trotzdem kein Login-Layer. */
    expect(backend.hasToken()).toBe(true);
    const statuses: string[] = [];
    backend.onConnectionChange((status) => statuses.push(status));
    const updates: Array<[string, unknown]> = [];
    backend.subscribe((entityId, value) => updates.push([entityId, value]));
    const authReasons: string[] = [];
    backend.onAuthError((reason) => authReasons.push(reason));

    backend.start();
    await waitFor(() => statuses.includes('connected'), 'connected');
    await waitFor(() => updates.length > 0, 'entity update');

    expect(authReasons).toEqual([]);
    expect(updates[0][0]).toBe('light.living_ceiling');
    const upstream = FakeUpstream.instances[0];
    /* Der Server authentifiziert sich, nicht der Browser. */
    expect(upstream.received[0]).toEqual({ type: 'auth', access_token: SUPERVISOR_TOKEN });
    const subscribe = upstream.received.find((message: any) => message.type === 'subscribe_entities');
    expect(subscribe.entity_ids).toEqual(['light.living_ceiling']);
  });

  it('spricht das Same-Origin-Gateway an, nicht die konfigurierte HA-Adresse', async () => {
    const { origin } = await serveGateway();
    (globalThis as any).location = { origin, protocol: 'http:' };
    const upgrades: string[] = [];
    upgradeLog.push(upgrades);
    const backend = new HaBackend({
      url: () => 'http://ha.invalid:8123',
      transport: 'gateway',
      entityIds: ['light.living_ceiling'],
    });
    backends.push(backend);
    backend.onConnectionChange(() => {});
    backend.start();
    await waitFor(() => FakeUpstream.instances.length > 0, 'upstream');
    expect(upgrades).toEqual(['/api/websocket']);
  });

  it('meldet im direkten Modus weiterhin einen fehlenden Token', async () => {
    (globalThis as any).localStorage = {
      getItem: () => null, setItem: () => {}, removeItem: () => {},
    };
    try {
      const backend = new HaBackend({
        url: () => 'http://ha.invalid:8123',
        transport: 'direct',
        entityIds: ['light.living_ceiling'],
      });
      backends.push(backend);
      expect(backend.hasToken()).toBe(false);
      const reasons: string[] = [];
      backend.onAuthError((reason) => reasons.push(reason));
      backend.start();
      await waitFor(() => reasons.length > 0, 'missing token');
      expect(reasons).toEqual(['missing-token']);
    } finally {
      delete (globalThis as any).localStorage;
    }
  });
});
