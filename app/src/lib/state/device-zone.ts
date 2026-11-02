// SPDX-License-Identifier: AGPL-3.0-only
import { placementRotation, placementRy, validDeviceZonePoints, type DeviceZonePoint, type ImmersionLightPlacement } from './immersion-light.ts';

export function zoneBounds(points: readonly DeviceZonePoint[]) {
  const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
  const right = Math.max(...points.map(p => p.x)), bottom = Math.max(...points.map(p => p.y));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** The editor and runtime use the same normalized corners, including perspective. */
export function zoneCorners(placement: ImmersionLightPlacement, aspect: number): DeviceZonePoint[] {
  if (placement.points) return placement.points;
  const angle = placementRotation(placement) * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = sx * placement.radius, y = sy * placementRy(placement);
    return { x: placement.x + x * Math.cos(angle) - y * Math.sin(angle), y: placement.y + (x * Math.sin(angle) + y * Math.cos(angle)) * aspect };
  });
}

export function zoneWithPoints(placement: ImmersionLightPlacement, points: DeviceZonePoint[]): ImmersionLightPlacement {
  const bounds = zoneBounds(points);
  return { ...placement, x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2, points };
}

export function toggleZoneShape(placement: ImmersionLightPlacement, aspect: number): ImmersionLightPlacement {
  if (placement.points) {
    const { points, rotation, ...ellipse } = placement;
    const bounds = zoneBounds(points);
    return { ...ellipse, radius: Math.max(0.008, Math.min(0.4, bounds.width / 2)), ry: Math.max(0.008, Math.min(0.4, bounds.height / aspect / 2)) };
  }
  const corners = zoneCorners(placement, aspect), bounds = zoneBounds(corners);
  const scale = Math.min(1, 1 / bounds.width, 1 / bounds.height);
  const points = corners.map(p => ({ x: (p.x - bounds.left) * scale, y: (p.y - bounds.top) * scale }));
  const left = Math.max(0, Math.min(1 - bounds.width * scale, bounds.left));
  const top = Math.max(0, Math.min(1 - bounds.height * scale, bounds.top));
  return zoneWithPoints(placement, points.map(p => ({ x: p.x + left, y: p.y + top })));
}

export function moveZoneCorner(placement: ImmersionLightPlacement, index: number, point: DeviceZonePoint): ImmersionLightPlacement {
  if (!placement.points) return placement;
  const points = placement.points.map((p, i) => i === index ? { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) } : p);
  return validDeviceZonePoints(points) ? zoneWithPoints(placement, points) : placement;
}

export function moveDeviceZone(placement: ImmersionLightPlacement, x: number, y: number): ImmersionLightPlacement {
  if (!placement.points) return { ...placement, x, y };
  const bounds = zoneBounds(placement.points);
  const dx = Math.max(-bounds.left, Math.min(1 - bounds.right, x - placement.x));
  const dy = Math.max(-bounds.top, Math.min(1 - bounds.bottom, y - placement.y));
  return zoneWithPoints(placement, placement.points.map(p => ({ x: p.x + dx, y: p.y + dy })));
}

/** Keep the form button beside the handles and inside the visible editor. */
export function zoneShapeButton(placement: ImmersionLightPlacement, width: number, height: number, size: number, gap: number) {
  const bounds = zoneBounds(zoneCorners(placement, width / height));
  const right = bounds.right * width + gap;
  const left = right + size <= width ? right : bounds.left * width - gap - size;
  return { x: Math.max(0, Math.min(width - size, left)), y: Math.max(0, Math.min(height - size, placement.y * height - size / 2)) };
}

/** Polygon coordinates relative to its bounding box, for a clipped hit target. */
export function zoneClipPath(points: DeviceZonePoint[]): string {
  const bounds = zoneBounds(points);
  return `polygon(${points.map(p => `${(p.x - bounds.left) / bounds.width * 100}% ${(p.y - bounds.top) / bounds.height * 100}%`).join(', ')})`;
}
