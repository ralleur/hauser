/* Swipe-Runter-Action (Phone-Sheets): der Finger zieht das Sheet nach unten
   mit; ab der Schwelle feuert `onSwipe` (Schließen), sonst federt es zurück.
   Gegenstück zu swiperight.ts — gleiche Bauart, andere Achse.

   Die Geste hängt an einem Griff (Sheet-Kopf), bewegt aber die Fläche
   dahinter: `surface` liefert sie erst beim Zugriff, weil `bind:this` des
   Elternelements zur Init-Zeit der Action noch leer sein kann. Wischen nach
   oben ist wirkungslos, horizontale Bewegung gewinnt (Kopfzeilen dürfen
   weiter scrollen/wischen). */

export interface SwipeDownParams {
  onSwipe: () => void;
  /** Fläche, die dem Finger folgt (Default: der Griff selbst). */
  surface?: () => HTMLElement | undefined;
  /** Auslöse-Schwelle in px (Default: 25 % der Flächenhöhe, mind. 96 px). */
  threshold?: number;
  enabled?: boolean;
}

const DIRECTION_LOCK = 12; // px Bewegung, bis horizontal/vertikal entschieden ist

export function swipedown(node: HTMLElement, params: SwipeDownParams) {
  let { onSwipe, surface, threshold, enabled = true } = params;
  let pointerId: number | null = null;
  let moved: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let locked: 'horizontal' | 'vertical' | null = null;

  const resolvedThreshold = (target: HTMLElement) => threshold ?? Math.max(96, target.offsetHeight * 0.25);

  const reset = (animate: boolean) => {
    const target = moved;
    pointerId = null;
    moved = null;
    dragging = false;
    locked = null;
    if (!target) return;
    target.style.transition = animate ? 'transform 160ms ease-out, opacity 160ms ease-out' : '';
    target.style.transform = '';
    target.style.opacity = '';
  };

  const onDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0 || pointerId !== null) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    locked = null;
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (locked === null && (Math.abs(dx) > DIRECTION_LOCK || Math.abs(dy) > DIRECTION_LOCK)) {
      locked = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
      if (locked === 'vertical') {
        moved = surface?.() ?? node;
        // Die Einflug-Animation liegt mit `fill: both` über der Inline-Angabe.
        // Sie ist längst gelaufen — abbrechen, sonst bewegt sich nichts.
        moved.getAnimations?.().forEach((animation) => animation.cancel());
        moved.style.transition = '';
        try {
          node.setPointerCapture(pointerId);
        } catch { /* Pointer schon weg (z. B. pointercancel): Geste läuft ohne Capture weiter. */ }
      }
    }
    if (locked !== 'vertical' || !moved) return;
    const shift = Math.max(0, dy);
    moved.style.transform = `translateY(${shift}px)`;
    moved.style.opacity = String(Math.max(0.4, 1 - shift / (moved.offsetHeight || 1)));
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const fire = locked === 'vertical' && moved !== null
      && e.clientY - startY >= resolvedThreshold(moved);
    // Beim Auslösen die Inline-Angaben sofort räumen: die Ausblend-Transition
    // des Sheets setzt ihre eigene Verschiebung.
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
    update(next: SwipeDownParams) {
      onSwipe = next.onSwipe;
      surface = next.surface;
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
