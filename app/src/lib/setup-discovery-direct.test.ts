import { describe, expect, it } from 'vitest';
// @ts-expect-error The production server intentionally remains native Node ESM.
import { serveSetupDiscovery } from '../../server/setup.mjs';
// @ts-expect-error Das Stresshaus-HA ist natives Node-ESM.
import { startFakeHa } from '../../scripts/stresshaus/fake-ha.mjs';

/* Stresshaus-Gegenprobe (2026-09-24): Die iOS-App fragt die Struktur des
   Hauses über den Server ab. Im Docker-Betrieb gab es die Abfrage nicht — in
   der App ließ sich kein Gerät einem Raum zuordnen. */
function response() {
  return {
    status: 0, body: '',
    writeHead(status: number) { this.status = status; return this; },
    setHeader() {},
    end(body?: string) { this.body = String(body ?? ''); },
  };
}

describe('Hausstruktur für die App im Docker-Betrieb', () => {
  it('liefert Bereiche, Geräte und Zustände mit dem Zugang aus der Einrichtung', async () => {
    const ha = await startFakeHa();
    try {
      const res = response();
      await serveSetupDiscovery(res, { connectionMode: 'direct', directAccess: () => ({ baseUrl: ha.url, token: 'stresshaus' }) });
      const body = JSON.parse(res.body);
      expect(res.status).toBe(200);
      expect(body.areas.length).toBeGreaterThan(0);
      expect(body.entities.length).toBeGreaterThan(0);
    } finally {
      await ha.close();
    }
  });

  it('sagt ohne eingerichtete Verbindung, warum nicht', async () => {
    const res = response();
    await serveSetupDiscovery(res, { connectionMode: 'direct', directAccess: () => null });
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).code).toBe('SETUP_DISCOVERY_NOT_AVAILABLE');
  });
});
