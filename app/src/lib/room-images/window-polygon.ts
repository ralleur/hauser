/** Normalized window corners. Existing model polygons remain untouched until edited. */
type Point = { x: number; y: number };
export function polygonArea(points: readonly Point[]): number {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
}
export function moveCorner(points: readonly Point[], index: number, point: Point): Point[] {
  const next = points.map((p, i) => i === index
    ? { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) } : { ...p });
  if (polygonArea(next) < 0.003) return [...points];
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < next.length; i++) {
    const a = next[i], b = next[(i + 1) % next.length];
    for (let j = i + 2; j < next.length; j++) {
      if (i === 0 && j === next.length - 1) continue;
      const c = next[j], d = next[(j + 1) % next.length];
      if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return [...points];
    }
  }
  return next;
}
