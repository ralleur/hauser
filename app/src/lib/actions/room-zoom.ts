// SPDX-License-Identifier: AGPL-3.0-only
import { tokenDuration, prefersReducedMotion } from '../motion/index.ts';

const COMMIT_DELTA = 0.18;
const IGNORE = '.home-panels, .camera-popout-layer, .hero-device-target, .hero-device-hit-layer, .image-edge-pull, [role="dialog"], input, select, textarea';

export interface RoomZoomParams {
  enabled: boolean;
  roomsView: boolean;
  onZoom: (roomId: string | null) => Promise<void>;
}

/** Two fingers own the complete gesture, including the trailing click. The
 * existing room morph finishes the zoom from the finger's last position. */
export function roomZoom(node: HTMLElement, initial: RoomZoomParams) {
  let params = initial;
  const pointers = new Map<number, EventTarget>();
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && event.target) pointers.set(event.pointerId, event.target);
  };
  const pointerEnd = (event: PointerEvent) => { pointers.delete(event.pointerId); };
  let gesture: {
    ids: number[]; distance: number; scale: number; intoRoom: boolean;
    roomId: string | null; source: HTMLElement; original: string;
    transition: string; origin: string; zIndex: string;
    card: HTMLElement | null; visibility: string;
    namedImage: HTMLElement | null; transitionName: string;
  } | null = null;
  let owned = false;
  let settling = false;
  let blockClickUntil = 0;

  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const restore = (current: NonNullable<typeof gesture>) => {
    current.source.style.transform = current.original;
    current.source.style.transition = current.transition;
    current.source.style.transformOrigin = current.origin;
    current.source.style.zIndex = current.zIndex;
    if (current.card) {
      current.source.remove();
      current.card.style.visibility = current.visibility;
      if (current.namedImage?.isConnected) current.namedImage.style.viewTransitionName = current.transitionName;
    }
  };

  async function finish(commit: boolean) {
    const current = gesture;
    if (!current) return;
    gesture = null;
    settling = true;
    try {
      if (commit) await params.onZoom(current.roomId);
      else if (!prefersReducedMotion()) {
        current.source.style.transition = 'transform var(--duration-quick) var(--ease-out)';
        current.source.style.transform = current.original || 'none';
        await new Promise(resolve => setTimeout(resolve, tokenDuration(current.source, 'quick')));
      }
    } finally {
      restore(current);
      settling = false;
    }
  }

  const onStart = (event: TouchEvent) => {
    if (owned) {
      stop(event);
      if (event.touches.length !== 2) void finish(false);
      return;
    }
    if (!params.enabled || settling || event.touches.length !== 2) return;
    const [a, b] = Array.from(event.touches);
    if ([a, b].some(touch => touch.target instanceof Element && touch.target.closest(IGNORE))) return;
    const intoRoom = params.roomsView;
    const hit = document.elementFromPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    const card = hit?.closest<HTMLElement>('.phone-room-card[data-room-id]');
    let source = intoRoom ? card : node.querySelector<HTMLElement>(':scope > .room-hero');
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!source || (intoRoom && !card) || distance < 1) return;
    const namedImage = intoRoom ? node.querySelector<HTMLElement>('.phone-room-morph-image[style*="home-room"]') : null;
    const transitionName = namedImage?.style.viewTransitionName ?? '';
    const visibility = card?.style.visibility ?? '';
    if (intoRoom && card) {
      // Lift only the visual copy out of the scrollport. The real card keeps
      // its layout and touch target, while the picture may grow behind chrome.
      const rect = card.getBoundingClientRect();
      const preview = card.cloneNode(true) as HTMLElement;
      preview.removeAttribute('data-room-id');
      preview.setAttribute('data-room-zoom-preview', '');
      preview.setAttribute('aria-hidden', 'true');
      Object.assign(preview.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, minHeight: '0', margin: '0', pointerEvents: 'none' });
      if (namedImage) namedImage.style.viewTransitionName = 'none';
      const image = preview.querySelector<HTMLElement>('.phone-room-morph-image');
      if (image) image.style.viewTransitionName = 'home-room';
      card.style.visibility = 'hidden';
      node.append(preview);
      source = preview;
    }
    owned = true;
    blockClickUntil = Infinity;
    gesture = { ids: [a.identifier, b.identifier], distance, scale: 1, intoRoom,
      roomId: card?.dataset.roomId ?? null, source, original: source.style.transform,
      transition: source.style.transition, origin: source.style.transformOrigin, zIndex: source.style.zIndex,
      card: intoRoom ? card ?? null : null, visibility, namedImage, transitionName };
    // Hand ownership to the pinch through the actions' normal cancellation
    // path. Phones need no global zoom listener or panel imports.
    for (const [pointerId, target] of pointers) {
      target.dispatchEvent(new PointerEvent('pointercancel', { pointerId, pointerType: 'touch', bubbles: true }));
    }
    source.style.transition = 'none';
    source.style.transformOrigin = 'center';
    if (intoRoom) source.style.zIndex = '3';
    stop(event);
  };

  const onMove = (event: TouchEvent) => {
    if (!owned) return;
    stop(event);
    const current = gesture;
    if (!current) return;
    const touches = current.ids.map(id => Array.from(event.touches).find(touch => touch.identifier === id));
    const [a, b] = touches;
    if (!a || !b || event.touches.length !== 2) { void finish(false); return; }
    current.scale = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / current.distance;
    const progress = Math.max(0, Math.min(1, (current.intoRoom ? current.scale - 1 : 1 - current.scale) / COMMIT_DELTA));
    if (!prefersReducedMotion()) current.source.style.transform = `scale(${1 + progress * (current.intoRoom ? COMMIT_DELTA : -COMMIT_DELTA)})`;
  };

  const onEnd = (event: TouchEvent) => {
    if (!owned) return;
    stop(event);
    if (gesture && event.touches.length < 2) {
      const delta = gesture.intoRoom ? gesture.scale - 1 : 1 - gesture.scale;
      void finish(event.type !== 'touchcancel' && delta >= COMMIT_DELTA);
    }
    if (event.touches.length === 0) { owned = false; blockClickUntil = performance.now() + 400; }
  };
  const blockPointer = (event: Event) => { if (owned || settling) stop(event); };
  const blockClick = (event: Event) => { if (performance.now() < blockClickUntil || settling) stop(event); };

  node.addEventListener('pointerdown', pointerDown, true);
  window.addEventListener('pointerup', pointerEnd, true);
  window.addEventListener('pointercancel', pointerEnd, true);
  node.addEventListener('touchstart', onStart, { capture: true, passive: false });
  node.addEventListener('touchmove', onMove, { capture: true, passive: false });
  node.addEventListener('touchend', onEnd, { capture: true, passive: false });
  node.addEventListener('touchcancel', onEnd, { capture: true, passive: false });
  for (const type of ['pointerdown', 'pointerup', 'pointermove']) node.addEventListener(type, blockPointer, true);
  node.addEventListener('click', blockClick, true);
  return {
    update(next: RoomZoomParams) { params = next; },
    destroy() {
      if (gesture) restore(gesture);
      node.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointerup', pointerEnd, true);
      window.removeEventListener('pointercancel', pointerEnd, true);
      node.removeEventListener('touchstart', onStart, true);
      node.removeEventListener('touchmove', onMove, true);
      node.removeEventListener('touchend', onEnd, true);
      node.removeEventListener('touchcancel', onEnd, true);
      for (const type of ['pointerdown', 'pointerup', 'pointermove']) node.removeEventListener(type, blockPointer, true);
      node.removeEventListener('click', blockClick, true);
    },
  };
}
