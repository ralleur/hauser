// SPDX-License-Identifier: AGPL-3.0-only
import { placementRotation, placementRy, type DeviceZonePoint, type ImmersionLightPlacement } from './immersion-light.ts';

/** Screen-space outline: the tolerance stays the same on phones and large panels. */
export function deviceZoneOutline(placement: ImmersionLightPlacement, width: number, height: number): DeviceZonePoint[] {
  if (placement.points) return placement.points.map(p => ({ x: p.x * width, y: p.y * height }));
  const angle = placementRotation(placement) * Math.PI / 180;
  return Array.from({ length: 64 }, (_, index) => {
    const phase = index * Math.PI / 32;
    const x = Math.cos(phase) * placement.radius * width;
    const y = Math.sin(phase) * placementRy(placement) * width;
    return { x: placement.x * width + x * Math.cos(angle) - y * Math.sin(angle),
      y: placement.y * height + x * Math.sin(angle) + y * Math.cos(angle) };
  });
}

export function distanceToDeviceZone(point: DeviceZonePoint, outline: readonly DeviceZonePoint[]): number {
  let inside = false, distance = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j], b = outline[i];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return inside ? 0 : distance;
}

/** Real zones win over halos; then nearest edge, nearest centre, stable ID. */
export function nearestDeviceZone<T extends { id: string; outline: DeviceZonePoint[] }>(targets: readonly T[], point: DeviceZonePoint, tolerance: number): T | undefined {
  return targets.map(target => {
    const center = target.outline.reduce((sum, p) => ({ x: sum.x + p.x / target.outline.length, y: sum.y + p.y / target.outline.length }), { x: 0, y: 0 });
    return { target, distance: distanceToDeviceZone(point, target.outline), center: Math.hypot(point.x - center.x, point.y - center.y) };
  }).filter(hit => hit.distance <= tolerance + 0.01)
    .sort((a, b) => a.distance - b.distance || a.center - b.center || (a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0))[0]?.target;
}
