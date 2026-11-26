// SPDX-License-Identifier: AGPL-3.0-only
import { defaultCommute, freshCommute, type CommuteMapBounds, type CommuteRoute, type CommuteStatus } from './commute.ts';
export const commute = $state<CommuteStatus>({ config: { ...defaultCommute }, route: null });
const VIEW_KEY = 'hmi:commute:view:v1';
function savedView(): boolean | null {
  try { const value = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'); return typeof value === 'boolean' ? value : null; }
  catch { return null; }
}
export const commuteView = $state({ mode: savedView() });
export function setCommuteView(mode: boolean): void {
  commuteView.mode = mode;
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(mode)); } catch { /* Keep the choice for this session. */ }
}
let flight: Promise<void> | null = null;
let mapCache: Pick<CommuteRoute, 'mapKey' | 'roads' | 'areas'> | undefined;
const MAP_BOUNDS_KEY = 'hmi:commute:map-bounds:v1';
function savedMapBounds(): CommuteMapBounds | null {
  try {
    const bounds = JSON.parse(localStorage.getItem(MAP_BOUNDS_KEY) ?? 'null');
    return Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isInteger) ? bounds as CommuteMapBounds : null;
  } catch { return null; }
}
let mapBounds: CommuteMapBounds | null = savedMapBounds();
const mapQuery = (wait = false) => `${wait ? 'waitForMap=1&' : ''}${mapBounds ? `mapBounds=${mapBounds.join(',')}&` : ''}${mapCache?.mapKey ? `mapKey=${encodeURIComponent(mapCache.mapKey)}` : ''}`;

export function coverCommuteMap(bounds: CommuteMapBounds | null): void {
  if (!bounds) return;
  const previous = mapBounds;
  if (previous) {
    // Keep the existing coverage when hints appear, a screen rotates, or a list changes size.
    bounds = [Math.min(previous[0], bounds[0]), Math.min(previous[1], bounds[1]), Math.max(previous[2], bounds[2]), Math.max(previous[3], bounds[3])];
    if (bounds.every((edge, i) => edge === previous[i])) return;
  }
  mapBounds = bounds;
  try { localStorage.setItem(MAP_BOUNDS_KEY, JSON.stringify(bounds)); } catch { /* Memory still covers this session. */ }
  if (flight) void flight.then(() => { if (mapBounds === bounds) void refreshCommute(); });
  else void refreshCommute();
}
function applyStatus(status: CommuteStatus): void {
  const route = status.route, previous = mapCache;
  if (route) {
    if (route.mapKey && route.mapKey === previous?.mapKey) {
      route.roads = previous.roads; route.areas = previous.areas;
    } else {
      // Static map geometry must not become hundreds of thousands of proxies.
      Object.freeze(route.roads);
      if (route.areas) Object.freeze(route.areas);
    }
    if (route.mapKey) mapCache = { mapKey: route.mapKey, roads: route.roads, areas: route.areas };
    Object.freeze(route);
  }
  Object.assign(commute, status);
}
export async function prepareCommutePreview(forceRefresh = false): Promise<CommuteStatus> {
  const response = await fetch(`/api/admin/commute/preview?${forceRefresh ? 'refresh=1&' : ''}${mapQuery(true)}`, { method: 'POST', signal: AbortSignal.timeout(195_000) });
  if (!response.ok) throw new Error('COMMUTE_UNAVAILABLE');
  const status = await response.json() as CommuteStatus;
  if (!freshCommute(status.route, new Date())) throw new Error('COMMUTE_UNAVAILABLE');
  applyStatus(status);
  return status;
}
export function refreshCommute(): Promise<void> {
  if (flight) return flight;
  flight = (async () => {
    try {
      const response = await fetch(`/api/commute?${mapQuery()}`, { signal: AbortSignal.timeout(195_000) });
      if (!response.ok) return;
      const value = await response.json() as CommuteStatus;
      if (!value.config || !Array.isArray(value.config.days)) return;
      applyStatus(value);
    } catch { /* Keep the prepared map; freshness still gates its traffic data. */ }
  })().finally(() => { flight = null; });
  return flight;
}
