// SPDX-License-Identifier: AGPL-3.0-only
import { cubicInOut } from 'svelte/easing';
import { draw, fade, type TransitionConfig } from 'svelte/transition';
import { parseDurationMs, prefersReducedMotion, tokenDuration, tokenValue } from '../motion/index.ts';

export function commuteTiming(name: 'map' | 'route'): number {
  return prefersReducedMotion() ? 0 : parseDurationMs(tokenValue(null, `--commute-${name}-duration`)) ?? 0;
}

/** Both maps move in the same zoom direction while their ink crossfades. */
export function commuteMapTransition(node: Element, { commute = false }: { commute?: boolean } = {}): TransitionConfig {
  const zoom = Number.parseFloat(tokenValue(node, '--commute-map-zoom')) || 0;
  return { duration: commuteTiming('map'), easing: cubicInOut,
    css: (t) => `opacity:${t};transform:scale(${1 + (commute ? zoom : -zoom) * (1 - t)});transform-origin:center;` };
}

/** Geometry is ordered from start to destination by the HA route. */
export function commuteRouteDraw(node: SVGGeometryElement): TransitionConfig {
  return draw(node, { delay: commuteTiming('map'), duration: commuteTiming('route'), easing: cubicInOut });
}

export function commuteFade(node: Element, { delay = 0 }: { delay?: number } = {}): TransitionConfig {
  return fade(node, { delay: prefersReducedMotion() ? 0 : delay, duration: prefersReducedMotion() ? 0 : tokenDuration(node, 'enter') });
}
