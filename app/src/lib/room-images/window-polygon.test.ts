import { describe, expect, it } from 'vitest';
import { moveCorner, polygonArea } from './window-polygon.ts';
const rectangle = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }];
describe('manual window corners', () => {
  it('makes a perspective window without moving the other corners', () => {
    const next = moveCorner(rectangle, 0, { x: .3, y: .2 });
    expect(next[0]).toEqual({ x: .3, y: .2 });
    expect(next.slice(1)).toEqual(rectangle.slice(1));
    expect(rectangle[0]).toEqual({ x: .1, y: .1 });
    expect(polygonArea(next)).toBeGreaterThan(.003);
  });
  it('keeps corners inside the image and rejects crossed edges and collapsed windows', () => {
    expect(moveCorner(rectangle, 0, { x: -1, y: -1 })[0]).toEqual({ x: 0, y: 0 });
    expect(moveCorner(rectangle, 0, { x: 1, y: .5 })).toEqual(rectangle);
    const small = [{ x: .1, y: .1 }, { x: .2, y: .1 }, { x: .2, y: .14 }, { x: .1, y: .14 }];
    expect(moveCorner(small, 0, { x: .19, y: .13 })).toEqual(small);
  });
});
