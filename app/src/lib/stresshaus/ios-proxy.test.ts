import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM tooling.
import { createServer } from 'node:http';
// @ts-expect-error Native Node ESM tooling.
import { simulatorTemplate, startProxy } from '../../../scripts/stresshaus/ios.mjs';

describe('Stresshaus #52: renamed simulators', () => {
  it('uses the device type when every iPhone has a project-specific name', () => {
    const model = { name: 'HH-S3-4-1f4c780650', deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro' };
    expect(simulatorTemplate({ 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [model] }, /iPhone/)).toEqual({
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0', model,
    });
    expect(simulatorTemplate({ ios: [model] }, /iPad/)).toBeNull();
  });
});

describe('Stresshaus #42: absichtliche HA-Ausfälle im iOS-Durchleiter', () => {
  it.each([false, true])('Unruhe %s: Antworten bleiben unverändert, nur der erwartete Ausfall ist kein Befund', async (unrest) => {
    let status = 503;
    let body = JSON.stringify({ ok: false, code: 'HA_UNAVAILABLE' });
    const upstream = createServer((_req: unknown, res: any) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const findings: string[] = [];
    const proxy = await startProxy(`http://127.0.0.1:${upstream.address().port}`, (line: string) => findings.push(line), unrest);
    try {
      const answer = await fetch(`${proxy.origin}/api/app/command`, { method: 'POST' });
      expect(answer.status).toBe(503);
      expect(await answer.json()).toEqual({ ok: false, code: 'HA_UNAVAILABLE' });
      expect(findings).toHaveLength(unrest ? 0 : 1);

      for (const failure of [
        { status: 500, code: 'HA_UNAVAILABLE', path: '/api/app/command' },
        { status: 503, code: 'OTHER_ERROR', path: '/api/app/command' },
        { status: 503, code: 'HA_UNAVAILABLE', path: '/api/household-config' },
      ]) {
        status = failure.status;
        body = JSON.stringify({ ok: false, code: failure.code });
        await (await fetch(`${proxy.origin}${failure.path}`)).text();
      }
      body = 'kein JSON';
      await (await fetch(`${proxy.origin}/api/app/command`)).text();
      expect(findings).toHaveLength(unrest ? 4 : 5);
    } finally {
      proxy.close();
      await new Promise<void>((resolve) => upstream.close(resolve));
    }
  });
});

describe('Stresshaus #51: unterbrochene Verbindung zur Konfiguration', () => {
  it('wiederholt einen abgebrochenen GET einmal, bevor die App einen Fehler erhält', async () => {
    let calls = 0;
    const upstream = createServer((req: any, res: any) => {
      calls += 1;
      if (calls === 1) { req.socket.destroy(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', etag: '"config-1"' });
      res.end('{"hmi:theme":"dark"}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const findings: string[] = [];
    const proxy = await startProxy(`http://127.0.0.1:${upstream.address().port}`, (line: string) => findings.push(line));
    try {
      const answer = await fetch(`${proxy.origin}/api/config`);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('etag')).toBe('"config-1"');
      expect(await answer.json()).toEqual({ 'hmi:theme': 'dark' });
      expect(calls).toBe(2);
      expect(findings).toEqual([]);
    } finally {
      proxy.close();
      await new Promise<void>((resolve) => upstream.close(resolve));
    }
  });

  it.each(['GET', 'POST'])('%s: ein dauerhafter Transportausfall bleibt ein nachvollziehbarer Befund', async (method) => {
    let calls = 0;
    const upstream = createServer((req: any) => { calls += 1; req.socket.destroy(); });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const findings: string[] = [];
    const proxy = await startProxy(`http://127.0.0.1:${upstream.address().port}`, (line: string) => findings.push(line));
    try {
      const answer = await fetch(`${proxy.origin}/api/config`, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect(answer.status).toBe(503);
      expect(await answer.json()).toMatchObject({ code: 'HAUSER_UPSTREAM_UNAVAILABLE' });
      expect(calls).toBe(method === 'GET' ? 2 : 1);
      expect(findings).toEqual([expect.stringContaining(`503 ${method} /api/config`)]);
      expect(findings[0]).toContain('ECONNRESET');
    } finally {
      proxy.close();
      await new Promise<void>((resolve) => upstream.close(resolve));
    }
  });
});
