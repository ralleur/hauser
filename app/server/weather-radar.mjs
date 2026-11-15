// SPDX-License-Identifier: AGPL-3.0-only
// RainViewer observations around the lock-screen location (100 km wide). Coordinates
// stay on the server; the browser receives cropped images and timestamps.
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { jsonResponse } from './shared.mjs';
const MANIFEST = 'https://api.rainviewer.com/public/weather-maps.json';
const HOST = 'https://tilecache.rainviewer.com';
const ZOOM = 7, TILE = 256, WIDTH = 960, HEIGHT = 600;
const TIMEOUT = 12000;

export function radarPlacement({ latitude, longitude, radiusMetres }, zoom = ZOOM) {
  const WORLD = TILE * 2 ** zoom;
  if (![latitude, longitude, radiusMetres].every(Number.isFinite) || Math.abs(latitude) > 85 || Math.abs(longitude) > 180 || radiusMetres < 1 || radiusMetres > 50000) throw new Error('RADAR_LOCATION_UNAVAILABLE');
  const lat = latitude * Math.PI / 180;
  const x = (longitude + 180) / 360 * WORLD;
  const y = (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * WORLD;
  const metresPerPixel = 2 * Math.PI * 6378137 * Math.cos(lat) / WORLD;
  const scale = WIDTH * metresPerPixel / (2 * radiusMetres);
  const halfX = WIDTH / scale / 2, halfY = HEIGHT / scale / 2;
  const tiles = [];
  for (let row = Math.floor((y - halfY) / TILE); row <= Math.floor((y + halfY) / TILE); row++) {
    for (let col = Math.floor((x - halfX) / TILE); col <= Math.floor((x + halfX) / TILE); col++) {
      tiles.push({ x: (col + 2 ** zoom) % 2 ** zoom, y: Math.max(0, Math.min(2 ** zoom - 1, row)),
        left: WIDTH / 2 + (col * TILE - x) * scale, top: HEIGHT / 2 + (row * TILE - y) * scale, size: TILE * scale });
    }
  }
  return { width: WIDTH, height: HEIGHT, tiles };
}

export function createWeatherRadarService({ resolveMap, fetchImpl = fetch, now = () => Date.now(), cacheDirectory = resolve(tmpdir(), 'hauser-radar-map-tiles') }) {
  let manifest, manifestAt = 0, manifestPending;
  const images = new Map(), pending = new Map();
  let coverage;
  async function request(url, limit) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT), redirect: 'error' });
    if (!response.ok) throw new Error('RADAR_UNAVAILABLE');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('RADAR_UNAVAILABLE');
    return bytes;
  }
  async function frames() {
    if (manifest && now() - manifestAt < 2 * 60000) return manifest;
    if (manifestPending) return manifestPending;
    manifestPending = (async () => {
      const data = JSON.parse((await request(MANIFEST, 65536)).toString());
      if (data.host !== HOST) throw new Error('RADAR_UNAVAILABLE');
      const list = (data.radar?.past ?? []).filter(f => Number.isSafeInteger(f.time) && /^\/v2\/radar\/[a-zA-Z0-9_-]+$/.test(f.path) && f.time * 1000 <= now() + 60000 && now() - f.time * 1000 < 3 * 3600000).sort((a, b) => a.time - b.time).slice(-13);
      if (!list.length) throw new Error('RADAR_UNAVAILABLE');
      manifest = list; manifestAt = now(); return list;
    })();
    try { return await manifestPending; } finally { manifestPending = null; }
  }
  async function map() {
    const value = await resolveMap();
    if (!value) throw new Error('RADAR_LOCATION_UNAVAILABLE');
    radarPlacement(value); return { ...value, radiusMetres: 50000 };
  }
  async function baseTile(tile) {
    await mkdir(cacheDirectory, { recursive: true });
    const path = resolve(cacheDirectory, `9-${tile.x}-${tile.y}.json`);
    let cached;
    try { cached = JSON.parse(await readFile(path, 'utf8')); } catch { /* First view of this tile. */ }
    if (cached?.until > now()) return Buffer.from(cached.png, 'base64');
    const headers = { 'User-Agent': 'Hauser/1.0 (+https://github.com/ralleur/hauser)', Referer: 'https://github.com/ralleur/hauser' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.modified) headers['If-Modified-Since'] = cached.modified;
    const response = await fetchImpl(`https://tile.openstreetmap.org/9/${tile.x}/${tile.y}.png`, { headers, signal: AbortSignal.timeout(TIMEOUT), redirect: 'error' });
    if (!response.ok && response.status !== 304) throw new Error('RADAR_MAP_UNAVAILABLE');
    const bytes = response.status === 304 && cached ? Buffer.from(cached.png, 'base64') : Buffer.from(await response.arrayBuffer());
    if (bytes.length > 1024 * 1024) throw new Error('RADAR_MAP_UNAVAILABLE');
    const seconds = Number(/max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 0);
    await writeFile(path, JSON.stringify({ png: bytes.toString('base64'), until: now() + Math.max(7 * 86400, seconds) * 1000,
      etag: response.headers.get('etag') ?? cached?.etag, modified: response.headers.get('last-modified') ?? cached?.modified }));
    return bytes;
  }
  let baseImage;
  async function basemap(expectedMap) {
    const location = await map();
    if (expectedMap && location.assetUrl?.split('/').at(-1) !== expectedMap) throw new Error('RADAR_MAP_CHANGED');
    const key = JSON.stringify(location);
    if (baseImage?.key === key) return baseImage.bytes;
    const placement = radarPlacement(location, 9);
    const parts = await Promise.all(placement.tiles.map(async tile => {
      const bytes = await baseTile(tile);
      return `<image x="${tile.left}" y="${tile.top}" width="${tile.size}" height="${tile.size}" href="data:image/png;base64,${bytes.toString('base64')}"/>`;
    }));
    const bytes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`)).png().toBuffer();
    baseImage = { key, bytes }; return bytes;
  }
  async function render(location, framePath, mask = false) {
    const placement = radarPlacement(location);
    const parts = await Promise.all(placement.tiles.map(async tile => {
      const bytes = await request(`${HOST}${framePath}/${TILE}/${ZOOM}/${tile.x}/${tile.y}/${mask ? '0/0_0' : '2/1_1'}.png`, 1024 * 1024);
      return `<image x="${tile.left}" y="${tile.top}" width="${tile.size}" height="${tile.size}" href="data:image/png;base64,${bytes.toString('base64')}"/>`;
    }));
    return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`)).png().toBuffer();
  }
  async function readCoverage(location) {
    const key = JSON.stringify(location);
    if (coverage?.key === key && now() - coverage.at < 6 * 3600000) return coverage.value;
    try {
      const image = await render(location, '/v2/coverage/0', true);
      const stats = await sharp(image).ensureAlpha().stats();
      const alpha = stats.channels[3];
      const value = alpha.max === 0 ? 'available' : alpha.min === 255 ? 'unavailable' : 'partial';
      coverage = { key, at: now(), value }; return value;
    } catch { return 'unknown'; }
  }
  async function read() {
    const [location, list] = await Promise.all([map(), frames()]);
    return { ok: true, coverage: await readCoverage(location), mapAsset: location.assetUrl ?? null, spanKm: 100, baseMap: `/api/weather/radar/map.png?map=${location.assetUrl?.split('/').at(-1) ?? ''}`,
      frames: list.map(f => ({ time: f.time, url: `/api/weather/radar/${f.time}.png?map=${location.assetUrl?.split('/').at(-1) ?? ''}` })) };
  }
  async function image(time, expectedMap) {
    const [location, list] = await Promise.all([map(), frames()]);
    if (expectedMap && location.assetUrl?.split('/').at(-1) !== expectedMap) throw new Error('RADAR_MAP_CHANGED');
    const frame = list.find(f => f.time === time);
    if (!frame) throw new Error('RADAR_FRAME_EXPIRED');
    const key = JSON.stringify([location, frame.path]);
    if (images.has(key)) return images.get(key);
    if (pending.has(key)) return pending.get(key);
    const promise = render(location, frame.path);
    pending.set(key, promise);
    try {
      const bytes = await promise; images.set(key, bytes);
      while (images.size > 13) images.delete(images.keys().next().value);
      return bytes;
    } finally { pending.delete(key); }
  }
  return { read, image, basemap };
}

export async function serveWeatherRadar(req, res, service) {
  if (req.method !== 'GET') { jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }); return; }
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const match = /^\/api\/weather\/radar\/(\d+)\.png$/.exec(path);
    if (match || path === '/api/weather/radar/map.png') {
      const expectedMap = new URL(req.url, 'http://localhost').searchParams.get('map');
      const image = match ? await service.image(Number(match[1]), expectedMap) : await service.basemap(expectedMap);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300', 'Content-Length': image.length }); res.end(image);
    } else if (path === '/api/weather/radar') jsonResponse(res, 200, await service.read());
    else jsonResponse(res, 404, { ok: false, code: 'NOT_FOUND' });
  } catch (error) { jsonResponse(res, 503, { ok: false, code: error.message?.startsWith('RADAR_') ? error.message : 'RADAR_UNAVAILABLE' }); }
}
