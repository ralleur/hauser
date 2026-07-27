/* Swipe-Rechts-Action (Phone-Einkaufsliste): der Finger zieht den Eintrag
   nach rechts mit; ab der Schwelle feuert `onSwipe` (Erledigt markieren),
   sonst federt der Eintrag zurück. Vertikale Bewegung gewinnt (Scroll bleibt
   ungestört), Wischen nach links ist wirkungslos. Stil analog longpress.ts. */

export interface SwipeRightParams {
  onSwipe: () => void;
  /** Auslöse-Schwelle in px (Default: 35 % der Elementbreite, mind. 72 px). */
  threshold?: number;
  enabled?: boolean;
}

const DIRECTION_LOCK = 12; // px Bewegung, bis horizontal/vertikal entschieden ist

export function swiperight(node: HTMLElement, params: SwipeRightParams) {
  let { onSwipe, threshold, enabled = true } = params;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let locked: 'horizontal' | 'vertical' | null = null;

  const resolvedThreshold = () => threshold ?? Math.max(72, node.offsetWidth * 0.35);

  const reset = (animate: boolean) => {
    pointerId = null;
    dragging = false;
    locked = null;
    node.style.transition = animate ? 'transform 160ms ease-out, opacity 160ms ease-out' : '';
    node.style.transform = '';
    node.style.opacity = '';
  };

  const onDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0 || pointerId !== null) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    locked = null;
    node.style.transition = '';
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (locked === null && (Math.abs(dx) > DIRECTION_LOCK || Math.abs(dy) > DIRECTION_LOCK)) {
      locked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      if (locked === 'horizontal') {
        try {
          node.setPointerCapture(pointerId);
        } catch { /* Pointer schon weg (z. B. pointercancel): Geste läuft ohne Capture weiter. */ }
      }
    }
    if (locked !== 'horizontal') return;
    const shift = Math.max(0, dx);
    node.style.transform = `translateX(${shift}px)`;
    node.style.opacity = String(Math.max(0.4, 1 - shift / (node.offsetWidth || 1)));
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const fire = locked === 'horizontal' && e.clientX - startX >= resolvedThreshold();
    reset(!fire);
    if (fire) onSwipe();
  };

  const onCancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    reset(true);
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onCancel);

  return {
    update(next: SwipeRightParams) {
      onSwipe = next.onSwipe;
      threshold = next.threshold;
      enabled = next.enabled ?? true;
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
    },
  };
}
