import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import http from 'node:http';
// @ts-expect-error Native Node ESM server contract.
import { createHaWebSocketGateway } from '../../server/ha-gateway.mjs';
// @ts-expect-error Native Node ESM server contract.
import { createHmiServer } from '../../server.mjs';
import { HaBackend } from './adapter/ha-backend.ts';

const SUPERVISOR_TOKEN = 'supervisor-token-fixture';
const HA_VERSION = '2026.8.1';

const servers: Array<{ close: (cb: () => void) => void }> = [];
const gateways: Array<{ close: () => void }> = [];

afterEach(async () => {
  for (const gateway of gateways.splice(0)) gateway.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  delete (globalThis as any).location;
});

const STATES = [
  { entity_id: 'light.living_ceiling', state: 'on', attributes: { friendly_name: 'Ceiling' } },
  { entity_id: 'calendar.family', state: 'on', attributes: { friendly_name: 'Family' } },
  { entity_id: 'todo.groceries', state: '2', attributes: { friendly_name: 'Groceries' } },
  { entity_id: 'update.core', state: 'on', attributes: { title: 'Core', installed_version: '1', latest_version: '2' } },
];

class FakeUpstream {
  static OPEN = 1;
  static instances: FakeUpstream[] = [];
  static rejectCommand = false;
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
    const reply = (body: Record<string, unknown>) => queueMicrotask(() => this.emitMessage({ id: message.id, ...body }));
    switch (message.type) {
      case 'auth':
        queueMicrotask(() => this.emitMessage({ type: 'auth_ok', ha_version: HA_VERSION }));
        return;
      case 'subscribe_entities':
        reply({ type: 'result', success: true, result: null });
        queueMicrotask(() => this.emitMessage({
          id: message.id,
          type: 'event',
          event: { a: { 'light.living_ceiling': { s: 'on', a: {} } } },
        }));
        return;
      case 'get_states':
        reply({ type: 'result', success: true, result: STATES });
        return;
      case 'call_service':
        if (FakeUpstream.rejectCommand) {
          reply({ type: 'result', success: false, error: { code: 'not_allowed', message: 'no' } });
          return;
        }
        reply({
          type: 'result',
          success: true,
          result: message.return_response
            ? { response: { 'calendar.family': { events: [{ summary: 'Dinner', start: '2026-09-01', end: '2026-09-02' }] } } }
            : { context: { id: 'ctx' } },
        });
        return;
      case 'todo/item/list':
        reply({ type: 'result', success: true, result: { items: [{ uid: '1', summary: 'Milk', status: 'needs_action' }] } });
        return;
      case 'config/entity_registry/update':
        reply({ type: 'result', success: true, result: { entity_entry: { entity_id: message.entity_id, name: message.name } } });
        return;
      default:
        reply({ type: 'result', success: true, result: [] });
    }
  }
  close() { for (const handler of [...(this.listeners.close ?? [])]) handler({}); }
}

async function connectedBackend() {
  FakeUpstream.instances = [];
  FakeUpstream.rejectCommand = false;
  const gateway = createHaWebSocketGateway({
    connectionMode: 'supervisor',
    env: { SUPERVISOR_TOKEN },
    WebSocketImpl: FakeUpstream as unknown as typeof WebSocket,
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
  (globalThis as any).location = { origin: `http://127.0.0.1:${port}`, protocol: 'http:' };
  const backend = new HaBackend({
    url: () => 'http://ha.invalid:8123',
    transport: 'gateway',
    entityIds: ['light.living_ceiling'],
  });
  const statuses: string[] = [];
  backend.onConnectionChange((status) => statuses.push(status));
  backend.subscribe(() => {});
  backend.start();
  await waitFor(() => statuses.includes('connected'), 'connected');
  return backend;
}

const waitFor = async (check: () => boolean, label = 'condition') => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};

describe('Backend-Parität über das Gateway', () => {
  it('führt Service-Calls aus', async () => {
    const backend = await connectedBackend();
    backend.callService('light', 'turn_on', 'light.living_ceiling', {});
    await waitFor(
      () => FakeUpstream.instances[0].received.some((m: any) => m.type === 'call_service' && m.service === 'turn_on'),
      'call_service',
    );
    const call = FakeUpstream.instances[0].received.find((m: any) => m.type === 'call_service');
    expect(call).toMatchObject({ domain: 'light', service: 'turn_on', target: { entity_id: 'light.living_ceiling' } });
  });

  it('meldet einen abgelehnten Befehl an die Reconciliation', async () => {
    const backend = await connectedBackend();
    FakeUpstream.rejectCommand = true;
    const failed: string[] = [];
    backend.onCommandError((entityId) => failed.push(entityId));
    backend.callService('light', 'turn_on', 'light.living_ceiling', {});
    await waitFor(() => failed.length > 0, 'command error');
    expect(failed).toEqual(['light.living_ceiling']);
  });

  it('liest Kalenderquellen und Kalenderereignisse', async () => {
    const backend = await connectedBackend();
    const sources = await backend.listCalendarSources();
    expect(sources).toEqual([{ entityId: 'calendar.family', name: 'Family', color: null }]);
    const events = await backend.getCalendarEvents(
      'calendar.family', new Date('2026-09-01'), new Date('2026-09-02'),
    );
    expect(events[0]).toMatchObject({ title: 'Dinner' });
  });

  it('liest Erinnerungslisten und Einträge', async () => {
    const backend = await connectedBackend();
    expect(await backend.listReminderSources()).toEqual([
      { entityId: 'todo.groceries', name: 'Groceries', color: null },
    ]);
    const reminders = await backend.getReminders('todo.groceries');
    expect(reminders[0]).toMatchObject({ title: 'Milk' });
  });

  it('liest verfügbare Systemupdates', async () => {
    const backend = await connectedBackend();
    expect(await backend.listSystemUpdates()).toEqual([
      { entityId: 'update.core', name: 'Core', installedVersion: '1', latestVersion: '2' },
    ]);
  });

  it('benennt eine Entität um', async () => {
    const backend = await connectedBackend();
    await backend.renameEntity('light.living_ceiling', '  Decke  ');
    const rename = FakeUpstream.instances[0].received
      .find((m: any) => m.type === 'config/entity_registry/update');
    expect(rename).toMatchObject({ entity_id: 'light.living_ceiling', name: 'Decke' });
  });
});

describe('CalDAV-Flow über die Same-Origin-Route', () => {
  const fixtureServer = async (clientFactory: any, mode = 'supervisor') => {
    // @ts-expect-error Native Node test without @types/node.
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    // @ts-expect-error Native Node test without @types/node.
    const { tmpdir } = await import('node:os');
    // @ts-expect-error Native Node test without @types/node.
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'hauser-caldav-'));
    const staticRoot = join(root, 'dist');
    mkdirSync(staticRoot);
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>Hauser</title>');
    const server = createHmiServer('', {
      staticRoot,
      householdConfigPath: join(root, 'household.json'),
      householdConfigMode: 'shadow',
      configPath: join(root, 'config.json'),
      paperlessPin: '',
      paperlessToken: '',
      haConnectionMode: mode,
      haSupervisorClientFactory: clientFactory,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  };

  const flowClient = (step: unknown, startStatus = 200) => () => ({
    available: true,
    close: () => {},
    rest: async (_method: string, path: string) => (path.includes('/flow/')
      ? { status: 200, body: step }
      : { status: startStatus, body: startStatus === 200 ? { flow_id: 'flow-1' } : null }),
    ws: async () => [],
  });

  it('richtet iCloud über den internen Zugang ein, ohne Browser-Token', async () => {
    const base = await fixtureServer(flowClient({ type: 'create_entry' }));
    const response = await fetch(`${base}/api/ha/caldav-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'apple@id', password: 'app-specific' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { type: 'create_entry' } });
  });

  it('reicht Ablehnungen von Home Assistant unverändert durch', async () => {
    const base = await fixtureServer(flowClient({ type: 'form', errors: { base: 'invalid_auth' } }));
    const response = await fetch(`${base}/api/ha/caldav-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'apple@id', password: 'wrong' }),
    });
    expect(await response.json()).toEqual({
      ok: true, result: { type: 'form', errors: { base: 'invalid_auth' } },
    });
  });

  it('meldet eine fehlende CalDAV-Integration verständlich', async () => {
    const base = await fixtureServer(flowClient(null, 404));
    const response = await fetch(`${base}/api/ha/caldav-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'apple@id', password: 'x' }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'HA_CALDAV_NOT_AVAILABLE' });
  });

  it('verlangt Apple-ID und App-Passwort', async () => {
    const base = await fixtureServer(flowClient({ type: 'create_entry' }));
    const response = await fetch(`${base}/api/ha/caldav-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '   ' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'HA_CALDAV_INVALID_REQUEST' });
  });

  it('gibt es im direkten Modus nicht', async () => {
    const base = await fixtureServer(flowClient({ type: 'create_entry' }), 'direct');
    const response = await fetch(`${base}/api/ha/caldav-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'apple@id', password: 'x' }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'HA_CALDAV_FLOW_NOT_AVAILABLE' });
  });
});
