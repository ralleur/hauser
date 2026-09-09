/* Raumbild für Geräte ohne AVIF (Uhr). Der Server weiß, welches Bild ein
   Raum hat — eigenes Set oder mitgeliefertes — und liefert es als JPEG in
   der gewünschten Breite: einmal gerechnet, danach aus dem Speicher, mit
   ETag. Zugelassen sind gekoppelte Geräte oder eine freigegebene Origin. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonResponse, requestOriginAllowed } from './shared.mjs';

export const APP_HERO_ROUTE_PREFIX = '/api/app/hero';

/* Adresse `light | dark | dark-off | overcast` → Schlüssel im Bildset und
   Dateiname des mitgelieferten Satzes. */
const VARIANTS = Object.freeze({
  light: { asset: 'light', file: 'light' },
  dark: { asset: 'dark', file: 'dark' },
  'dark-off': { asset: 'darkOff', file: 'dark-off' },
  overcast: { asset: 'overcast', file: 'overcast' },
});
/* Räume mit mitgeliefertem Bild (`public/hero`); wo kein Raum passt, gilt das Wohnzimmer. */
const PROJECT_ROOMS = new Set(['wohnzimmer', 'kinderzimmer', 'schlafzimmer', 'bad', 'kueche', 'flur']);
const ROOM_ID = /^[a-z0-9_-]{1,64}$/;
const MIN_WIDTH = 96;
const MAX_WIDTH = 1600;
export const DEFAULT_HERO_WIDTH = 480;
const CACHE_LIMIT = 96;

export function createAppHeroService({ readHousehold, assetStore = null, staticRoots = [], sharp = null, quality = 82 }) {
  const cache = new Map();

  function household() {
    const result = readHousehold();
    if (!result?.ok) return null;
    try { return JSON.parse(result.body); } catch { return null; }
  }

  /** Welches Bild der Raum in dieser Fassung hat — oder null. */
  function resolve(roomId, variant) {
    const spec = VARIANTS[variant];
    if (!spec || typeof roomId !== 'string' || !ROOM_ID.test(roomId)) return null;
    const room = household()?.rooms?.find((entry) => entry?.id === roomId) ?? null;
    if (!room) return null;
    const assetId = typeof room.hero?.assetId === 'string' ? room.hero.assetId : null;
    if (assetId && assetStore) return { kind: 'asset', assetId, variant: spec.asset, key: `asset:${assetId}:${spec.asset}` };
    const projectRoom = PROJECT_ROOMS.has(roomId) ? roomId : 'wohnzimmer';
    return { kind: 'project', room: projectRoom, variant: spec.file, key: `project:${projectRoom}:${spec.file}` };
  }

  /* Die trübe Fassung ist optional; fehlt sie, gilt das Tagbild (R3: nichts
     behaupten, aber auch kein Loch). */
  function sourceBytes(source) {
    if (source.kind === 'asset') {
      const bytes = assetStore.variantBytes(source.assetId, source.variant);
      if (bytes) return bytes;
      return source.variant === 'overcast' ? assetStore.variantBytes(source.assetId, 'light') : null;
    }
    for (const variant of source.variant === 'overcast' ? ['overcast', 'light'] : [source.variant]) {
      for (const root of staticRoots) {
        const file = join(root, 'hero', `${source.room}-${variant}.avif`);
        if (existsSync(file)) return readFileSync(file);
      }
    }
    return null;
  }

  function clampWidth(width) {
    const value = Number.isFinite(width) ? Math.round(width) : DEFAULT_HERO_WIDTH;
    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
  }

  /** JPEG in Wunschbreite samt ETag — oder null, wenn der Raum kein Bild hat. */
  async function render(roomId, variant, width = DEFAULT_HERO_WIDTH) {
    const source = resolve(roomId, variant);
    if (!source) return null;
    const target = clampWidth(width);
    const cacheKey = `${source.key}@${target}`;
    const hit = cache.get(cacheKey);
    if (hit) {
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return hit;
    }
    const bytes = sourceBytes(source);
    if (!bytes) return null;
    if (!sharp) throw Object.assign(new Error('Die Bildbibliothek ist nicht verfügbar.'), { code: 'APP_HERO_UNAVAILABLE', status: 503 });
    const jpeg = await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 24_000_000 })
      .resize({ width: target, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    const entry = { bytes: jpeg, etag: `"${createHash('sha256').update(jpeg).digest('hex').slice(0, 32)}"`, width: target };
    cache.set(cacheKey, entry);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return entry;
  }

  return { resolve, render, invalidate() { cache.clear(); } };
}

export async function serveAppHero(req, res, { service, allowedOrigins }) {
  if (!req.hauserDevice && !requestOriginAllowed(req, allowedOrigins)) {
    return jsonResponse(res, 403, { ok: false, code: 'APP_ORIGIN_FORBIDDEN', message: 'Nur gekoppelte Geräte oder eine freigegebene Origin.' });
  }
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    return jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Das Raumbild erlaubt ausschließlich GET und HEAD.' }, { allow: 'GET, HEAD' });
  }
  const url = new URL(req.url || '/', 'http://hauser.local');
  const match = url.pathname.match(/^\/api\/app\/hero\/([^/]+)\/([^/]+)$/);
  if (!match) return jsonResponse(res, 404, { ok: false, code: 'APP_ROUTE_NOT_FOUND', message: 'Die App-Route wurde nicht gefunden.' });
  let entry;
  try {
    entry = await service.render(decodeURIComponent(match[1]), match[2], Number(url.searchParams.get('w') ?? DEFAULT_HERO_WIDTH));
  } catch (error) {
    return jsonResponse(res, error?.status ?? 500, { ok: false, code: error?.code ?? 'APP_HERO_FAILED', message: error?.message ?? 'Das Raumbild konnte nicht erzeugt werden.' });
  }
  if (!entry) return jsonResponse(res, 404, { ok: false, code: 'APP_HERO_NOT_FOUND', message: 'Für diesen Raum gibt es kein Bild.' });
  const headers = { etag: entry.etag, 'cache-control': 'private, max-age=3600', vary: 'authorization' };
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'content-type': 'image/jpeg', 'content-length': entry.bytes.byteLength });
  if (req.method === 'HEAD') res.end(); else res.end(entry.bytes);
}
