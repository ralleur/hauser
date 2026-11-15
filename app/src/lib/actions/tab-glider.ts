// SPDX-License-Identifier: AGPL-3.0-only
import { prefersReducedMotion, parseDurationMs, tokenValue } from '../motion/index.ts';

type Geometry = { x: number; w: number };

/** Set the final width once; the moving pill only animates its transform. */
export function tabGlider(node: HTMLElement, initial: Geometry) {
  let previous: Geometry | undefined;
  let animation: Animation | undefined;
  function update(target: Geometry) {
    if (previous?.x === target.x && previous.w === target.w) return;
    const bounds = previous ? node.getBoundingClientRect() : null;
    const parent = bounds ? node.offsetParent as HTMLElement | null : null;
    const origin = parent?.getBoundingClientRect();
    animation?.cancel();
    node.style.width = `${target.w}px`;
    node.style.transform = `translate3d(${target.x}px, 0, 0)`;
    const duration = parseDurationMs(tokenValue(node, '--duration-glider')) ?? 0;
    if (bounds && parent && origin && target.w > 0 && duration > 0 && !prefersReducedMotion()) {
      animation = node.animate([
        { transform: `translate3d(${bounds.left - origin.left - parent.clientLeft}px, 0, 0) scaleX(${bounds.width / target.w})` },
        { transform: `translate3d(${target.x}px, 0, 0) scaleX(1)` },
      ], { duration, easing: tokenValue(node, '--ease-glider') });
    }
    previous = target;
  }
  update(initial);
  return { update, destroy: () => animation?.cancel() };
}
