// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
// @ts-expect-error Node is available to Vitest; application types intentionally omit it.
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { moveDeviceZone, moveZoneCorner, toggleZoneShape, zoneBounds, zoneShapeButton } from './device-zone.ts';
import { parseImmersionLightConfig, validDeviceZonePoints, type ImmersionLightPlacement } from './immersion-light.ts';

const ellipse: ImmersionLightPlacement = { x: 0.5, y: 0.5, radius: 0.12, ry: 0.06, rotation: 30 };

describe('device areas shared by lamps, blinds and heating', () => {
  it('keeps a rotated ellipse when changing to a rectangle, including image aspect', () => {
    const rectangle = toggleZoneShape(ellipse, 1.5);
    expect(rectangle.points).toHaveLength(4);
    expect(validDeviceZonePoints(rectangle.points)).toBe(true);
    expect(rectangle.points![0].x).toBeCloseTo(0.42607695);
    expect(rectangle.points![0].y).toBeCloseTo(0.33205771);
    const circle = toggleZoneShape(rectangle, 1.5);
    expect(circle.points).toBeUndefined();
    expect(circle.rotation).toBeUndefined();
    expect(circle.x).toBeCloseTo(ellipse.x);
  });

  it('moves a single rectangle corner like a window, leaving the other three alone', () => {
    const rectangle = toggleZoneShape({ x: 0.5, y: 0.5, radius: 0.2 }, 1);
    const moved = moveZoneCorner(rectangle, 0, { x: 0.4, y: 0.35 });
    expect(moved.points![0]).toEqual({ x: 0.4, y: 0.35 });
    expect(moved.points!.slice(1)).toEqual(rectangle.points!.slice(1));
    expect(moveZoneCorner(rectangle, 0, { x: 0.9, y: 0.6 })).toEqual(rectangle);
  });

  it('preserves the shape when repositioning a device and stops at the image edge', () => {
    const rectangle = toggleZoneShape(ellipse, 1.5);
    const moved = moveDeviceZone(rectangle, 1, 0.1);
    const before = zoneBounds(rectangle.points!), after = zoneBounds(moved.points!);
    expect(after.right).toBeCloseTo(1);
    expect(after.width).toBeCloseTo(before.width);
    expect(after.height).toBeCloseTo(before.height);
    expect(after.top).toBeGreaterThanOrEqual(0);
    expect(moveDeviceZone(ellipse, 0.2, 0.3)).toEqual({ ...ellipse, x: 0.2, y: 0.3 });
  });

  it.each([0, 30, 90, 135])('creates an editable rectangle at an image corner with rotation %s', rotation => {
    const rectangle = toggleZoneShape({ ...ellipse, x: 1, y: 0, rotation }, 1.5);
    expect(validDeviceZonePoints(rectangle.points)).toBe(true);
  });

  it('places the form button on the right and moves it to the left near the edge', () => {
    const center = zoneShapeButton({ x: 0.5, y: 0.5, radius: 0.1 }, 880, 620, 44, 22);
    expect(center.x).toBeGreaterThan(0.6 * 880);
    const edge = zoneShapeButton({ x: 0.94, y: 0.5, radius: 0.05 }, 880, 620, 44, 22);
    expect(edge.x + 44).toBeLessThan(0.89 * 880);
    const corner = zoneShapeButton({ x: 1, y: 0, radius: 0.05 }, 320, 220, 44, 22);
    expect(corner.x).toBeGreaterThanOrEqual(0);
    expect(corner.x + 44).toBeLessThanOrEqual(320);
    expect(corner.y).toBe(0);
  });

  it('persists rectangle corners for every domain and ignores invalid polygons', () => {
    const rectangle = toggleZoneShape(ellipse, 1.5);
    const rooms = parseImmersionLightConfig(JSON.stringify({ version: 1, rooms: { living: {
      'light.lamp': rectangle, 'cover.blind': rectangle, 'climate.heating': rectangle,
      'switch.bad': { ...ellipse, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }] },
    } } })).rooms.living;
    for (const id of ['light.lamp', 'cover.blind', 'climate.heating']) expect(rooms[id].points).toEqual(rectangle.points);
    expect(rooms['switch.bad'].points).toBeUndefined();
  });

  it.each(['RoomEdit', 'HeroDeviceTargets', 'RoomHero'])('compiles the changed %s UI', name => {
    const filename = new URL(`../components/${name}.svelte`, import.meta.url);
    expect(() => compile(readFileSync(filename, 'utf8'), { filename: filename.pathname, generate: 'client' })).not.toThrow();
  });
});
