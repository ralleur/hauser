/* Fernzugriff (Plan 21, Stufe 2): Aufsicht über den tsnet-Sidecar
   `hauser-tunnel` und dessen Zustand für den System-Screen.

   Der Sidecar ist ein eigenes Binary (tools/tunnel). Fehlt es, bleibt der
   Fernzugriff einfach „nicht verfügbar" — Hauser läuft im LAN unverändert.
   Stirbt der Prozess, wird er mit wachsendem Abstand neu gestartet. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { jsonResponse, requestOriginAllowed } from './shared.mjs';

export const REMOTE_ROUTE_PREFIX = '/api/remote';
const STATUS_INTERVAL_MS = 5_000;
const RESTART_MIN_MS = 2_000;
const RESTART_MAX_MS = 60_000;

export function createTunnelSupervisor({
  binary,
  stateDir,
  target,
  control = '127.0.0.1:4174',
  hostname = 'hauser',
  spawnImpl = spawn,
  fetchImpl = fetch,
  log = console,
} = {}) {
  const available = !!binary && existsSync(binary);
  let child = null;
  let backoff = RESTART_MIN_MS;
  let stopped = false;
  let timer = null;
  let status = { enabled: available, state: available ? 'starting' : 'unavailable' };

  function start() {
    if (!available || stopped) return;
    mkdirSync(stateDir, { recursive: true });
    child = spawnImpl(binary, [], {
      env: {
        ...process.env,
        HAUSER_TUNNEL_STATE: stateDir,
        HAUSER_TUNNEL_TARGET: target,
        HAUSER_TUNNEL_CONTROL: control,
        HAUSER_TUNNEL_HOSTNAME: hostname,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) log.warn(`[hauser-tunnel] ${line}`);
    });
    child.on('exit', (code) => {
      child = null;
      if (stopped) return;
      status = { enabled: true, state: 'stopped', error: `Sidecar beendet (Code ${code ?? '?'})` };
      log.warn(`[hauser] Tunnel-Sidecar beendet (${code ?? '?'}), Neustart in ${backoff / 1000}s`);
      timer = setTimeout(() => { backoff = Math.min(backoff * 2, RESTART_MAX_MS); start(); }, backoff);
    });
  }

  async function poll() {
    if (!available || stopped || !child) return;
    try {
      const response = await fetchImpl(`http://${control}/status`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      status = { enabled: true, ...data };
      if (data.state === 'running') backoff = RESTART_MIN_MS;
    } catch {
      status = { enabled: true, state: status.state === 'starting' ? 'starting' : 'unreachable' };
    }
  }

  return {
    available,
    start() {
      if (!available) return;
      start();
      timer = setInterval(() => { void poll(); }, STATUS_INTERVAL_MS);
      timer.unref?.();
    },
    status() { return status; },
    /** Für den QR-Code: die Funnel-Adresse, sobald sie steht. */
    url() { return status.state === 'running' && status.url ? status.url : null; },
    async reset() {
      if (!available || !child) return false;
      try {
        const response = await fetchImpl(`http://${control}/reset`, { method: 'POST' });
        return response.ok;
      } catch {
        return false;
      }
    },
    close() {
      stopped = true;
      if (timer) { clearTimeout(timer); clearInterval(timer); }
      child?.kill();
      child = null;
    },
  };
}

export async function serveRemote(req, res, { tunnel, allowedOrigins, ownUrl = () => null }) {
  const pathname = new URL(req.url || '/', 'http://hauser.local').pathname;
  if (!requestOriginAllowed(req, allowedOrigins)) {
    return jsonResponse(res, 403, { ok: false, code: 'REMOTE_ORIGIN_FORBIDDEN', message: 'Die Fernzugriffs-Anfrage stammt nicht von einer freigegebenen Origin.' });
  }
  if (pathname === REMOTE_ROUTE_PREFIX && req.method === 'GET') {
    return jsonResponse(res, 200, { ok: true, ...tunnel.status(), ownUrl: ownUrl() }, { 'cache-control': 'no-store' });
  }
  if (pathname === `${REMOTE_ROUTE_PREFIX}/reset` && req.method === 'POST') {
    const done = await tunnel.reset();
    return jsonResponse(res, done ? 200 : 503, { ok: done });
  }
  jsonResponse(res, 404, { ok: false, code: 'REMOTE_ROUTE_NOT_FOUND', message: 'Die Fernzugriffs-Route wurde nicht gefunden.' });
}
