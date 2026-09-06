/* Bundle- und Bild-Manifest für die Companion-App (Plan 21, Stufe 0/§10).

   Die App enthält keine eigene Oberfläche: sie spiegelt das Phone-Bundle
   dieses Servers und die Phone-Varianten der Raumbilder in ihr Dateisystem.
   Beides beschreibt der Server hier als Liste aus Pfad, Hash und Größe — die
   App lädt nur, was sich geändert hat, über die normalen statischen Pfade. */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { jsonResponse, requestOriginAllowed } from './shared.mjs';

export const APP_ROUTE_PREFIX = '/api/app';
const PHONE_VARIANT_FILES = new Set(['phone-light.avif', 'phone-dark.avif']);

function walk(root, out = []) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function publicPath(root, file) {
  return `/${relative(root, file).split(sep).join('/')}`;
}

/** Liste aus Pfad, Hash und Größe; Hashes bleiben je (Pfad, mtime, Größe) im
    Speicher, damit wiederholte Abfragen die Platte nicht neu lesen. */
export function createFileIndex() {
  const cache = new Map();
  return function index(root, { prefix = '', include = () => true } = {}) {
    const files = [];
    for (const file of walk(root)) {
      const path = `${prefix}${publicPath(root, file)}`;
      if (!include(path, file)) continue;
      const stat = statSync(file);
      const key = `${file}|${stat.mtimeMs}|${stat.size}`;
      let hash = cache.get(key);
      if (!hash) {
        hash = createHash('sha256').update(readFileSync(file)).digest('hex');
        cache.set(key, hash);
      }
      files.push({ path, hash, size: stat.size });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return files;
  };
}

function listingEtag(payload) {
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32)}"`;
}

export function serveAppBundle(req, res, { staticRoot, roomImageAssetRoot, buildInfo, allowedOrigins, index }) {
  const url = new URL(req.url || '/', 'http://hauser.local');
  const pathname = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Die App-Routen sind nur per GET lesbar.' }, { allow: 'GET, HEAD' });
  }
  if (!requestOriginAllowed(req, allowedOrigins)) {
    return jsonResponse(res, 403, { ok: false, code: 'APP_ORIGIN_FORBIDDEN', message: 'Die App-Anfrage stammt nicht von einer freigegebenen Origin.' });
  }
  let payload;
  if (pathname === `${APP_ROUTE_PREFIX}/bundle`) {
    /* Raumbilder liegen unter dem Asset-Root, nicht im Build — sie gehören
       ins Manifest, nicht ins Bundle. */
    const files = index(staticRoot, { include: (path) => !path.startsWith('/assets/room-images/') });
    payload = { ok: true, version: buildInfo?.version ?? null, revision: buildInfo?.revision ?? null, files };
  } else if (pathname === `${APP_ROUTE_PREFIX}/manifest`) {
    const root = join(roomImageAssetRoot, 'room-images');
    const files = index(root, {
      prefix: '/assets/room-images',
      include: (path) => PHONE_VARIANT_FILES.has(path.slice(path.lastIndexOf('/') + 1)),
    });
    payload = { ok: true, files };
  } else {
    return jsonResponse(res, 404, { ok: false, code: 'APP_ROUTE_NOT_FOUND', message: 'Die App-Route wurde nicht gefunden.' });
  }
  const etag = listingEtag(payload);
  if (req.headers?.['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'cache-control': 'no-cache' });
    res.end();
    return;
  }
  jsonResponse(res, 200, payload, { ETag: etag, 'cache-control': 'no-cache' });
}
