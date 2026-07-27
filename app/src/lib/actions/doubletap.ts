export interface DoubleTapParams {
  onDoubleTap: () => void;
  enabled?: boolean;
}

const MAX_TAP_MS = 300;
const MAX_GAP_MS = 350;
const MAX_MOVE_PX = 12;

/* Pointer-basierter Double-Tap statt `dblclick`: funktioniert auf Touch-PWAs
   zuverlässig, ohne einen einzelnen Tap zu verzögern oder Scrollen auszulösen. */
export function doubletap(node: HTMLElement, params: DoubleTapParams) {
  let { onDoubleTap, enabled = true } = params;
  let pointerId: number | null = null;
  let downAt = 0;
  let startX = 0;
  let startY = 0;
  let lastTapAt = 0;

  const onDown = (event: PointerEvent) => {
    if (!enabled || event.button !== 0) return;
    pointerId = event.pointerId;
    downAt = performance.now();
    startX = event.clientX;
    startY = event.clientY;
  };

  const onUp = (event: PointerEvent) => {
    if (!enabled || event.pointerId !== pointerId) return;
    pointerId = null;
    const now = performance.now();
    const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
    if (now - downAt > MAX_TAP_MS || moved > MAX_MOVE_PX) {
      lastTapAt = 0;
      return;
    }
    if (lastTapAt && now - lastTapAt <= MAX_GAP_MS) {
      lastTapAt = 0;
      onDoubleTap();
    } else {
      lastTapAt = now;
    }
  };

  const onCancel = () => {
    pointerId = null;
    lastTapAt = 0;
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onCancel);

  return {
    update(next: DoubleTapParams) {
      onDoubleTap = next.onDoubleTap;
      enabled = next.enabled ?? true;
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
    },
  };
}
