import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { createTunnelSupervisor } from '../../server/remote.mjs';
// @ts-expect-error Native Node test without @types/node.
import { mkdtempSync, writeFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';

function fakeChild() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  return {
    stderr: { on() { /* still */ } },
    on(event: string, handler: (...args: unknown[]) => void) { handlers[event] = handler; },
    kill() { handlers.exit?.(0); },
    exit(code: number) { handlers.exit?.(code); },
  };
}

describe('Tunnel-Aufsicht', () => {
  it('bleibt ohne Binary schlicht nicht verfügbar', () => {
    const tunnel = createTunnelSupervisor({ binary: '/nirgends/hauser-tunnel', stateDir: '/tmp/x', target: 'http://127.0.0.1:4173' });
    expect(tunnel.available).toBe(false);
    tunnel.start();
    expect(tunnel.status()).toEqual({ enabled: false, state: 'unavailable' });
    expect(tunnel.url()).toBe(null);
  });

  it('startet den Sidecar mit Umgebung und liefert die Funnel-Adresse nur im Zustand running', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hauser-tunnel-'));
    const binary = join(root, 'hauser-tunnel');
    writeFileSync(binary, '#!/bin/sh\n');
    const spawned: Array<{ env: Record<string, string> }> = [];
    const child = fakeChild();
    let remoteStatus: Record<string, unknown> = { state: 'needs-login', authUrl: 'https://login.tailscale.com/a/x' };
    const tunnel = createTunnelSupervisor({
      binary, stateDir: join(root, 'state'), target: 'http://127.0.0.1:4173', control: '127.0.0.1:9',
      spawnImpl: (_bin: string, _args: string[], options: { env: Record<string, string> }) => { spawned.push(options); return child; },
      fetchImpl: async () => ({ ok: true, json: async () => remoteStatus }),
      log: { warn() { /* leise */ } },
    });
    tunnel.start();
    expect(spawned[0].env.HAUSER_TUNNEL_TARGET).toBe('http://127.0.0.1:4173');
    expect(spawned[0].env.HAUSER_TUNNEL_STATE).toBe(join(root, 'state'));
    expect(tunnel.status().state).toBe('starting');
    expect(tunnel.url()).toBe(null);
    remoteStatus = { state: 'running', url: 'https://hauser.tail.ts.net', hostname: 'hauser.tail.ts.net' };
    /* Abfrage läuft im Intervall; hier direkt über reset()/fetch prüfen. */
    expect(await tunnel.reset()).toBe(true);
    tunnel.close();
  });
});
