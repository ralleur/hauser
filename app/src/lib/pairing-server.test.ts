import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { tmpdir } from 'node:os';
// @ts-expect-error Native Node test without @types/node.
import { join } from 'node:path';
// @ts-expect-error Native Node ESM Servermodul.
import { applyAppCors, authenticateRequest, bearerToken, createDeviceStore, createRateLimiter, pairingLink, remoteGateAllows, REMOTE_MARKER_HEADER } from '../../server/pairing.mjs';
// @ts-expect-error Native Node ESM Servermodul.
import { requestOriginAllowed } from '../../server/shared.mjs';

const roots: string[] = [];
function tempStore(now = () => 1_000_000) {
  const root = mkdtempSync(join(tmpdir(), 'hauser-pairing-'));
  roots.push(root);
  return createDeviceStore(join(root, 'nested', 'devices.json'), { now });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Kopplung der Companion-App', () => {
  it('löst einen Code genau einmal ein und speichert nur den Token-Hash', () => {
    const store = tempStore();
    const { code } = store.startPairing();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    const result = store.claim(code, { name: 'Sams iPhone', platform: 'ios' });
    expect(result?.device.name).toBe('Sams iPhone');
    expect(result?.token.length).toBeGreaterThan(30);
    expect(store.claim(code, {})).toBe(null);
    const raw = readFileSync(store.path, 'utf8');
    expect(raw).not.toContain(result!.token);
    expect(store.authenticate(result!.token)?.id).toBe(result!.device.id);
    expect(store.authenticate('falsch')).toBe(null);
  });

  it('lässt Codes nach fünf Minuten verfallen und nimmt Kleinschreibung', () => {
    let t = 0;
    const store = tempStore(() => t);
    const { code } = store.startPairing();
    t = 5 * 60 * 1000 + 1;
    expect(store.claim(code, {})).toBe(null);
    const second = store.startPairing().code;
    expect(store.claim(second.toLowerCase(), {})).not.toBe(null);
  });

  it('widerruft Geräte und überlebt einen Neustart', () => {
    const store = tempStore();
    const a = store.claim(store.startPairing().code, { name: 'A' })!;
    const b = store.claim(store.startPairing().code, { name: 'B' })!;
    expect(store.revoke(a.device.id)).toBe(true);
    expect(store.revoke(a.device.id)).toBe(false);
    const reopened = createDeviceStore(store.path);
    expect(reopened.list().map((d: { name: string }) => d.name)).toEqual(['B']);
    expect(reopened.authenticate(b.token)?.name).toBe('B');
    expect(reopened.authenticate(a.token)).toBe(null);
    expect(existsSync(store.path)).toBe(true);
  });

  it('liest den Token aus Header oder Query und hebt damit die Origin-Grenze auf', () => {
    const store = tempStore();
    const { token } = store.claim(store.startPairing().code, {})!;
    const fromHeader = { url: '/api/config', headers: { authorization: `Bearer ${token}`, origin: 'capacitor://localhost' } };
    const fromQuery = { url: `/api/websocket?device_token=${token}`, headers: { origin: 'capacitor://localhost' } };
    const stranger = { url: '/api/config', headers: { origin: 'capacitor://localhost' } };
    expect(bearerToken(fromHeader)).toBe(token);
    expect(bearerToken(fromQuery)).toBe(token);
    expect(requestOriginAllowed(stranger, new Set())).toBe(false);
    authenticateRequest(fromHeader, store);
    authenticateRequest(fromQuery, store);
    expect(requestOriginAllowed(fromHeader, new Set())).toBe(true);
    expect(requestOriginAllowed(fromQuery, new Set())).toBe(true);
    expect(store.list()[0].lastSeenVia).toBe('lan');
  });

  it('lässt über den Tunnel ohne Gerät nur Health und Build-Info durch', () => {
    const store = tempStore();
    const { token } = store.claim(store.startPairing().code, {})!;
    const remote = (url: string, extra: Record<string, string> = {}) => ({ url, headers: { [REMOTE_MARKER_HEADER]: '1', ...extra } });
    expect(remoteGateAllows(remote('/api/health'))).toBe(true);
    expect(remoteGateAllows(remote('/api/build-info?x=1'))).toBe(true);
    expect(remoteGateAllows(remote('/api/config'))).toBe(false);
    expect(remoteGateAllows(remote('/'))).toBe(false);
    const paired = remote('/api/config', { authorization: `Bearer ${token}` });
    authenticateRequest(paired, store);
    expect(remoteGateAllows(paired)).toBe(true);
    expect(store.list()[0].lastSeenVia).toBe('remote');
    expect(remoteGateAllows({ url: '/api/config', headers: {} })).toBe(true);
  });

  it('beantwortet Preflights der App-Origin und rüstet Antworten mit CORS nach', () => {
    const written: Array<[number, Record<string, string>]> = [];
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
      writeHead: (status: number, h: Record<string, string> = {}) => { written.push([status, { ...headers, ...h }]); },
      end: () => undefined,
    };
    const preflight = { method: 'OPTIONS', url: '/api/config', headers: { origin: 'capacitor://localhost', 'access-control-request-headers': 'authorization' } };
    expect(applyAppCors(preflight, res)).toBe(true);
    expect(written[0][0]).toBe(204);
    expect(written[0][1]['access-control-allow-origin']).toBe('capacitor://localhost');
    expect(written[0][1]['access-control-allow-headers']).toBe('authorization');

    const actual = { method: 'GET', url: '/api/config', headers: { origin: 'https://localhost' } };
    expect(applyAppCors(actual, res)).toBe(false);
    res.writeHead(200, { etag: '"x"' });
    expect(written[1][1]['access-control-allow-origin']).toBe('https://localhost');
    expect(written[1][1].etag).toBe('"x"');

    const browser = { method: 'OPTIONS', url: '/api/config', headers: { origin: 'https://evil.example' } };
    expect(applyAppCors(browser, res)).toBe(false);
  });

  it('drosselt pro Quelle und Minute', () => {
    let t = 0;
    const limiter = createRateLimiter(2, { now: () => t });
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
    expect(limiter.hit('b')).toBe(true);
    expect(limiter.blocked('a')).toBe(true);
    t = 60_001;
    expect(limiter.blocked('a')).toBe(false);
    expect(limiter.hit('a')).toBe(true);
  });

  it('sperrt eine Tunnel-Quelle nach zu vielen falschen Tokens', () => {
    const store = tempStore();
    const failures = createRateLimiter(2);
    const bad = () => ({ url: '/api/config', headers: { [REMOTE_MARKER_HEADER]: '1', authorization: 'Bearer falsch', 'x-forwarded-for': '203.0.113.9' }, socket: {} });
    authenticateRequest(bad(), store, { failures });
    authenticateRequest(bad(), store, { failures });
    const third = bad();
    authenticateRequest(third, store, { failures });
    expect((third as { hauserThrottled?: boolean }).hauserThrottled).toBe(true);
    expect(remoteGateAllows(third)).toBe(false);
    /* Aus dem LAN zählt nichts. Die Adresse ist nur der Schlüssel der Zählung;
       entscheidend ist, dass die Anfrage ohne Tunnel-Marker hereinkommt. */
    const lan = { url: '/api/config', headers: { authorization: 'Bearer falsch' }, socket: { remoteAddress: '10.0.0.5' } };
    authenticateRequest(lan, store, { failures });
    expect((lan as { hauserThrottled?: boolean }).hauserThrottled).toBeUndefined();
  });

  it('setzt die Person eines Geräts', () => {
    const store = tempStore();
    const { device } = store.claim(store.startPairing().code, { name: 'X' })!;
    expect(store.setPerson(device.id, 'person.sam')?.person).toBe('person.sam');
    expect(store.list()[0].person).toBe('person.sam');
    expect(store.setPerson(device.id, '')?.person).toBe(null);
    expect(store.setPerson('nix', 'person.sam')).toBe(null);
  });

  it('lässt Gast-Tokens mit dem Aufenthalt erlöschen', () => {
    let t = 1_000_000;
    const store = tempStore(() => t);
    const { code } = store.startPairing({ guest: true, deviceExpiresAt: t + 60_000 });
    const guest = store.claim(code, {})!;
    expect(guest.device.guest).toBe(true);
    expect(store.authenticate(guest.token)?.name).toBe('Gast');
    t += 60_001;
    expect(store.authenticate(guest.token)).toBe(null);
    const resident = store.claim(store.startPairing().code, { name: 'Sam' })!;
    expect(store.revokeGuests()).toBe(1);
    expect(store.list().map((d: { name: string }) => d.name)).toEqual(['Sam']);
    expect(store.authenticate(resident.token)?.name).toBe('Sam');
  });

  it('formt den QR-Inhalt als hauser://pair-Link', () => {
    expect(pairingLink({ code: 'ABCD2345', lan: 'http://homeassistant.local:4173', remote: null }))
      .toBe('hauser://pair?v=1&code=ABCD2345&lan=http%3A%2F%2Fhomeassistant.local%3A4173');
  });
});
