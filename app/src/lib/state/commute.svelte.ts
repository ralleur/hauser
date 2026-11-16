// SPDX-License-Identifier: AGPL-3.0-only
import { defaultCommute, freshCommute, type CommuteMapBounds, type CommuteRoute, type CommuteStatus } from './commute.ts';
export const commute = $state<CommuteStatus>({ config: { ...defaultCommute }, route: null });
let flight: Promise<void> | null = null;
let mapCache: Pick<CommuteRoute, 'mapKey' | 'roads' | 'areas'> | undefined;
let mapBounds: CommuteMapBounds | null = null;
const mapQuery = () => `mapBounds=${mapBounds?.join(',') ?? 'route'}${mapCache?.mapKey ? `&mapKey=${encodeURIComponent(mapCache.mapKey)}` : ''}`;

export function coverCommuteMap(bounds: CommuteMapBounds | null): void {
  if (!bounds) { mapBounds = null; return; }
  const previous = mapBounds;
  if (previous) {
    // Keep the existing coverage when hints appear, a screen rotates, or a list changes size.
    bounds = [Math.min(previous[0], bounds[0]), Math.min(previous[1], bounds[1]), Math.max(previous[2], bounds[2]), Math.max(previous[3], bounds[3])];
    if (bounds.every((edge, i) => edge === previous[i])) return;
  }
  mapBounds = bounds;
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
  const response = await fetch(`/api/admin/commute/preview?${forceRefresh ? 'refresh=1&' : ''}${mapQuery()}`, { method: 'POST', signal: AbortSignal.timeout(95_000) });
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
      const response = await fetch(`/api/commute?${mapQuery()}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) { commute.route = null; return; }
      const value = await response.json() as CommuteStatus;
      if (!value.config || !Array.isArray(value.config.days)) return;
      applyStatus(value);
    } catch { commute.route = null; }
  })().finally(() => { flight = null; });
  return flight;
}
