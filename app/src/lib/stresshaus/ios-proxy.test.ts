import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM tooling.
import { createServer } from 'node:http';
// @ts-expect-error Native Node ESM tooling.
import { startProxy } from '../../../scripts/stresshaus/ios.mjs';

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
