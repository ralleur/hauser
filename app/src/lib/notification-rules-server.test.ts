// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { mkdtempSync, rmSync } from 'node:fs';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { tmpdir } from 'node:os';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { join } from 'node:path';
// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { createNotificationRulesStore, serveNotifications } from '../../server/notification-rules.mjs';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function rule(index: number) {
  return {
    id: `doors_windows_fenster_${index}`,
    category: 'doors-windows',
    name: `Fenster Nummer ${index}`,
    entityId: `binary_sensor.fenster_${index}`,
    enabled: true,
    triggers: [
      { key: 'open', label: 'Das Fenster ist schon länger offen', enabled: true, kind: 'state', to: ['on'], delayMinutes: 15 },
      { key: 'closed', label: 'Das Fenster ist wieder zu', enabled: false, kind: 'state', to: ['off'], delayMinutes: 0 },
    ],
  };
}

function put(service: unknown, body: unknown): Promise<{ status: number; payload: { ok?: boolean; rules?: unknown[] } }> {
  const req = Object.assign(Readable.from([JSON.stringify(body)]), { method: 'PUT', url: '/api/notifications/rules', headers: {} });
  return new Promise((resolve) => {
    let status = 0;
    const res = {
      writeHead(code: number) { status = code; return res; },
      end(chunk: string) { resolve({ status, payload: JSON.parse(chunk) }); },
    };
    serveNotifications(req, res, service);
  });
}

describe('Benachrichtigungsregeln am Server', () => {
  it('speichert eine Regelliste, die größer als ein Kilobyte ist (ralleur/hauser#25)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hauser-rules-'));
    dirs.push(dir);
    const store = createNotificationRulesStore(join(dir, 'notification-rules.json'));
    const rules = Array.from({ length: 12 }, (_, index) => rule(index));
    expect(JSON.stringify({ rules }).length).toBeGreaterThan(1024);
    const result = await put({ store, sync: async () => ({ created: 12, updated: 0, deleted: 0, unchanged: 0 }) }, { rules, colors: {} });
    expect(result.status).toBe(200);
    expect(result.payload.ok).toBe(true);
    expect(store.read().rules).toHaveLength(12);
  });
});
