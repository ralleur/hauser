// SPDX-License-Identifier: AGPL-3.0-only
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { clipAreaRing, clipPolyline } from './ambient-map-renderer.mjs';

const MAX_TILES = 12;
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);

export function commuteOverviewTiles([south, west, north, east]) {
  for (let zoom = 10; zoom >= 0; zoom--) {
    const count = 2 ** zoom;
    const index = (position) => Math.max(0, Math.min(count - 1, Math.floor(position * count)));
    const x = (lon) => index((lon + 180) / 360);
    const y = (lat) => index((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2);
    const left = x(west), right = x(east), top = y(north), bottom = y(south);
    if ((right - left + 1) * (bottom - top + 1) > MAX_TILES) continue;
    const tiles = [];
    for (let column = left; column <= right; column++) {
      for (let row = top; row <= bottom; row++) tiles.push({ zoom, column, row });
    }
    return tiles;
  }
}

function tileGeometry(bytes, { zoom, column, row }, project, bounds) {
  const count = 2 ** zoom;
  const lon = (x) => x / count * 360 - 180;
  const lat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / count))) * 180 / Math.PI;
  const [left, top] = project([lat(row), lon(column)]);
  const [right, bottom] = project([lat(row + 1), lon(column + 1)]);
  // Vector tiles include overlapping data at their edges. Clip each to its own footprint.
  const clip = { minX: Math.max(left, bounds.minX), maxX: Math.min(right, bounds.maxX), minY: Math.max(top, bounds.minY), maxY: Math.min(bottom, bounds.maxY) };
  const tile = new VectorTile(new Pbf(bytes));
  const roads = [], areas = [];
  const toMap = (points) => points.map(([x, y]) => project([y, x]));
  for (const name of ['transportation', 'water', 'landcover']) {
    const layer = tile.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const kind = feature.properties.class;
      if (name === 'transportation' && (feature.type !== 2 || !ROAD_CLASSES.has(kind))) continue;
      if (name !== 'transportation' && (feature.type !== 3 || (name === 'landcover' && kind !== 'wood'))) continue;
      const { geometry } = feature.toGeoJSON(column, row, zoom);
      const parts = geometry.type.startsWith('Multi') ? geometry.coordinates : [geometry.coordinates];
      if (name === 'transportation') {
        for (const line of parts) roads.push(...clipPolyline(toMap(line), clip));
      } else {
        const layer = name === 'water' ? 'water' : 'green';
        for (const polygon of parts) {
          const [outer, ...holes] = polygon.map((ring) => clipAreaRing(toMap(ring), clip));
          if (outer.length >= 4) areas.push({ layer, rings: [outer, ...holes.filter((ring) => ring.length >= 4)] });
        }
      }
    }
  }
  return { roads, areas };
}

export async function loadCommuteOverview(tiles, project, bounds, fetchImpl) {
  const roads = [], areas = [];
  const signal = AbortSignal.timeout(20_000);
  for (let start = 0; start < tiles.length; start += 4) {
    const batch = await Promise.all(tiles.slice(start, start + 4).map(async (tile) => {
      const { zoom, column, row } = tile;
      const response = await fetchImpl(`https://tiles.openfreemap.org/planet/latest/${zoom}/${column}/${row}.pbf`, {
        headers: { 'User-Agent': 'Hauser commute (+https://hauserhome.app)' }, signal,
      });
      if (!response.ok) throw new Error('COMMUTE_OVERVIEW_UNAVAILABLE');
      const bytes = new Uint8Array(await response.arrayBuffer());
      return tileGeometry(bytes, tile, project, bounds);
    }));
    for (const tile of batch) {
      roads.push(...tile.roads);
      areas.push(...tile.areas);
    }
  }
  return { roads, areas };
}
