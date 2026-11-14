// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
// @ts-expect-error Node is available to Vitest; application types intentionally omit it.
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { deviceZoneOutline, nearestDeviceZone } from './device-zone-hit.ts';
import type { ImmersionLightPlacement } from './immersion-light.ts';

const zone = (id: string, placement: ImmersionLightPlacement, width = 1000, height = 600) => ({
  id, outline: deviceZoneOutline(placement, width, height),
});
const rect = (id: string, left: number, right: number) => zone(id, { x: (left + right) / 2, y: 0.5, radius: 0.1,
  points: [{ x: left, y: 0.4 }, { x: right, y: 0.4 }, { x: right, y: 0.6 }, { x: left, y: 0.6 }] });
const winner = (targets: ReturnType<typeof zone>[], x: number, y = 300) => nearestDeviceZone(targets, { x, y }, 32)?.id;

describe('forgiving image controls', () => {
  it('accepts a 32px halo around small ellipses and perspective corners, leaving free space free', () => {
    const ellipse = zone('lamp', { x: 0.5, y: 0.5, radius: 0.01 });
    expect(winner([ellipse], 541)).toBe('lamp');
    expect(winner([ellipse], 543)).toBeUndefined();
    const rectangle = rect('blind', 0.4, 0.6);
    expect(winner([rectangle], 622, 218)).toBe('blind');
    expect(winner([rectangle], 625, 215)).toBeUndefined();
  });

  it('prefers a real hit over a neighbouring halo regardless of paint order', () => {
    const targets = [rect('left', 0.3, 0.4), rect('right', 0.42, 0.5)];
    expect(winner(targets, 425)).toBe('right');
    expect(winner(targets.toReversed(), 425)).toBe('right');
    expect(winner(targets, 405)).toBe('left');
    expect(winner(targets.toReversed(), 415)).toBe('right');
  });

  it('uses the nearest edge rather than the centre of differently sized zones', () => {
    expect(winner([rect('large', 0.05, 0.5), rect('small', 0.54, 0.56)], 510)).toBe('large');
  });

  it('resolves overlapping originals by centre and exact ties by stable ID', () => {
    const targets = [rect('b', 0.4, 0.5), rect('a', 0.4, 0.5)];
    expect(winner(targets, 450)).toBe('a');
    expect(winner(targets.toReversed(), 450)).toBe('a');
    expect(winner([rect('large', 0.2, 0.6), rect('small', 0.48, 0.5)], 490)).toBe('small');
  });

  it('keeps rotation and the same physical margin after resizing the image', () => {
    const placement = { x: 0.5, y: 0.5, radius: 0.1, ry: 0.01, rotation: 90 };
    expect(winner([zone('rotated', placement)], 500, 430)).toBe('rotated');
    expect(winner([zone('rotated', placement)], 543)).toBeUndefined();
    expect(winner([zone('phone', placement, 400, 800)], 200, 470)).toBe('phone');
    expect(winner([zone('phone', placement, 400, 800)], 200, 473)).toBeUndefined();
  });

  it('compiles the connected touch layer', () => {
    const filename = new URL('../components/HeroDeviceTargets.svelte', import.meta.url);
    const result = compile(readFileSync(filename, 'utf8'), { filename: filename.pathname, generate: 'client' });
    expect(result.warnings.filter(w => w.code.startsWith('a11y'))).toEqual([]);
  });
});
