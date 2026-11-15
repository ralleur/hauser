// SPDX-License-Identifier: AGPL-3.0-only
import { commuteTiming } from '../state/commute-motion.ts';
import { tokenValue } from '../motion/index.ts';

interface Options { active: boolean; commute: boolean }
interface Placement { left: number; top: number; width: number; height: number; parentScaleX: number; parentScaleY: number }

/** Keep the actual clock/date/status nodes and morph their painted rectangles.
 * Layout changes once; only compositor transforms run during the movement. */
export function commuteClockMotion(node: HTMLElement, initial: Options) {
  let options = initial;
  const positions = new Map<HTMLElement, Placement>();
  const animations = new Map<HTMLElement, Animation>();
  let queued = false, disposed = false;
  const elements = () => [...node.querySelectorAll<HTMLElement>('.ambient-clock, .ambient-date, .ambient-status')];
  function measure(animate = true) {
    queued = false;
    if (disposed) return;
    const duration = options.active && animate ? commuteTiming('map') : 0;
    const updates = elements().map(element => {
      const previous = positions.get(element);
      const animation = animations.get(element), time = animation?.currentTime;
      // Layout has already changed: apply the current transform to the old
      // target to recover the painted position before that layout change.
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      const visual = animation && previous ? {
        left: previous.left + matrix.e * previous.parentScaleX,
        top: previous.top + matrix.f * previous.parentScaleY,
        width: previous.width * matrix.a, height: previous.height * matrix.d,
      } : previous;
      animation?.cancel();
      const target = element.getBoundingClientRect();
      positions.set(element, { left: target.left, top: target.top, width: target.width, height: target.height,
        parentScaleX: target.width / element.offsetWidth || 1, parentScaleY: target.height / element.offsetHeight || 1 });
      const changed = previous && (['left', 'top', 'width', 'height'] as const).some(key => Math.abs(previous[key] - target[key]) > .5);
      if (animation && !changed && duration) {
        animation.play(); animation.currentTime = time ?? 0;
      } else animations.delete(element);
      return { element, from: animation ? visual : previous, target, changed };
    });
    for (const { element, from, target, changed } of updates) {
      if (!duration || !changed || !from?.width || !from.height || !target.width || !target.height) continue;
      const parentScaleX = target.width / element.offsetWidth || 1;
      const parentScaleY = target.height / element.offsetHeight || 1;
      const dx = (from.left - target.left) / parentScaleX, dy = (from.top - target.top) / parentScaleY;
      node.classList.add('is-clock-morphing');
      node.querySelector('.ambient-clock')?.classList.remove('is-tick');
      const animation = element.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${from.width / target.width}, ${from.height / target.height})`, transformOrigin: '0 0' },
        { transform: 'none', transformOrigin: '0 0' },
      ], { duration, easing: tokenValue(node, '--ease-in-out'), fill: 'both' });
      animations.set(element, animation);
      animation.onfinish = () => {
        if (animations.get(element) === animation) { animations.delete(element); animation.cancel(); }
        if (!animations.size) node.classList.remove('is-clock-morphing');
      };
    }
  }
  function schedule() {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => measure());
  }
  measure(false);
  const resize = new ResizeObserver(schedule);
  for (const element of elements()) resize.observe(element);
  const changes = new MutationObserver(schedule);
  changes.observe(node, { attributes: true, childList: true, subtree: true });
  const surface = node.closest('.ambient');
  if (surface) changes.observe(surface, { attributes: true, attributeFilter: ['class'] });
  return {
    update(next: Options) {
      const entering = next.active && !options.active;
      options = next;
      if (entering || !next.active) measure(false); else schedule();
    },
    destroy() {
      disposed = true; resize.disconnect(); changes.disconnect();
      for (const animation of animations.values()) animation.cancel();
    },
  };
}
