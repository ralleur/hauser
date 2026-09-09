/* Swipe-Runter-Action (Phone-Sheets): der Finger zieht das Sheet nach unten
   mit; ab der Schwelle feuert `onSwipe` (Schließen), sonst federt es zurück.
   Gegenstück zu swiperight.ts — gleiche Bauart, andere Achse.

   Die Geste hängt an einem Griff (Sheet-Kopf) oder am ganzen Sheet, bewegt
   aber die Fläche dahinter: `surface` liefert sie erst beim Zugriff, weil
   `bind:this` des Elternelements zur Init-Zeit der Action noch leer sein kann.
   Wischen nach oben ist wirkungslos, horizontale Bewegung gewinnt (Kopfzeilen
   dürfen weiter scrollen/wischen).

   Liegt die Action auf der ganzen Fläche, teilt sie sich die Achse mit dem
   Inhalt. Zwei Regeln halten beide auseinander: `atTop` gibt die Geste an den
   Inhalt ab, solange der nicht an seinem oberen Anschlag steht, und `ignore`
   überlässt Bedienelementen mit eigener Zeigergeste (Regler, Ziehgriffe,
   Eingaben) ihren Druck. Nach oben wird ohnehin nie gezogen — diese Richtung
   gehört dem Scrollen. */

export interface SwipeDownParams {
  onSwipe: () => void;
  /** Fläche, die dem Finger folgt (Default: der Griff selbst). */
  surface?: () => HTMLElement | undefined;
  /** Auslöse-Schwelle in px (Default: 25 % der Flächenhöhe, mind. 96 px). */
  threshold?: number;
  /** Steht der Inhalt an seinem oberen Anschlag (oder liegt der Griff außerhalb
      des Scrollbereichs)? Sonst gehört die Geste dem Inhalt. */
  atTop?: (target: Element | null) => boolean;
  /** Elemente mit eigener Zeigergeste, die den Druck behalten (CSS-Selektor). */
  ignore?: string;
  enabled?: boolean;
}

const DIRECTION_LOCK = 12; // px Bewegung, bis horizontal/vertikal entschieden ist

/* Was in einem Sheet seinen eigenen Druck behält: Regler und Ziehgriffe deuten
   dieselbe Bewegung anders, Eingaben brauchen Auswahl und Cursor. */
export const SHEET_SWIPE_IGNORE = 'input, textarea, select, [role="slider"], .slider, .cfg-handle';

export function swipedown(node: HTMLElement, params: SwipeDownParams) {
  let { onSwipe, surface, threshold, atTop, ignore, enabled = true } = params;
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
    const target = e.target as Element | null;
    if (ignore && target?.closest?.(ignore)) return;
    // Mitten im Inhalt gehört die Abwärtsbewegung dem Scrollen; erst am oberen
    // Anschlag ist sie wieder frei für das Sheet.
    if (atTop && !atTop(target)) return;
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
      // Nach oben zieht niemand ein Sheet: diese Richtung gehört dem Inhalt,
      // sonst hinge das Scrollen am Zeiger-Capture fest.
      if (locked === 'vertical' && dy < 0) {
        dragging = false;
        locked = null;
        pointerId = null;
        return;
      }
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
      atTop = next.atTop;
      ignore = next.ignore;
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
