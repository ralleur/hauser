// SPDX-License-Identifier: AGPL-3.0-only
import { polygonArea, moveCorner } from './window-polygon.ts';
export type Point = { x: number; y: number };
export { moveCorner };
export const OBJECT_KINDS = ['window', 'floor', 'seating', 'table', 'desk', 'bed', 'tv', 'mirror', 'bath', 'appliance', 'bin', 'toy', 'solar'] as const;
export function rectangle(a: Point, b: Point): Point[] {
  return [{ x: Math.min(a.x,b.x), y: Math.min(a.y,b.y) }, { x: Math.max(a.x,b.x), y: Math.min(a.y,b.y) },
    { x: Math.max(a.x,b.x), y: Math.max(a.y,b.y) }, { x: Math.min(a.x,b.x), y: Math.max(a.y,b.y) }];
}
export function validShape(points: readonly Point[]): boolean {
  if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) || polygonArea(points) < .003) return false;
  if (new Set(points.map(p => `${p.x},${p.y}`)).size !== points.length) return false;
  const cross = (a: Point,b: Point,c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  for (let i=0; i<points.length; i++) for (let j=i+2; j<points.length; j++) {
    if (i===0 && j===points.length-1) continue;
    const a=points[i], b=points[(i+1)%points.length], c=points[j], d=points[(j+1)%points.length];
    if (Math.max(a.x,b.x) < Math.min(c.x,d.x) || Math.max(c.x,d.x) < Math.min(a.x,b.x) || Math.max(a.y,b.y) < Math.min(c.y,d.y) || Math.max(c.y,d.y) < Math.min(a.y,b.y)) continue;
    if (cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0) return false;
  }
  return true;
}
export function freehand(stroke: readonly Point[]): Point[] {
  const points: Point[] = [];
  for (const p of stroke) if (!points.length || Math.hypot(p.x-points.at(-1)!.x,p.y-points.at(-1)!.y)>.003) points.push({...p});
  if (points.length > 1 && Math.hypot(points[0].x-points.at(-1)!.x,points[0].y-points.at(-1)!.y)<.015) points.pop();
  if (!validShape(points)) return [];
  while (points.length>12) {
    let least=0, area=Infinity;
    points.forEach((p,i)=> { const bend=polygonArea([points[(i+points.length-1)%points.length],p,points[(i+1)%points.length]]); if (bend<area) { area=bend; least=i; } });
    points.splice(least,1);
  }
  return validShape(points) ? points : [];
}
