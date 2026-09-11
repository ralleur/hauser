/* Waagerechte Wischgeste (Kontrollfläche, Layout-Menü, Bühne): der Finger
   zieht die Fläche in Wischrichtung mit (`move`, Standard an); ab der
   Schwelle feuert `onSwipe` (Fläche fliegt aus dem Bild), sonst federt sie
   zurück. Vertikale Bewegung gewinnt (Scrollen bleibt ungestört), die
   Gegenrichtung ist wirkungslos. Gesten, die in einem waagerecht scrollenden
   Kind beginnen (Raumauswahl) oder in `ignore` treffen, gehören dem Kind.
   Ohne `move` (Bühne) wird nach einem Treffer der nachfolgende Klick
   geschluckt, damit die Kachel unter dem Finger nicht auch noch wählt.
   Bewegung nur über Transform; Dauer und Kurve kommen aus dem Stylesheet. */

export interface SwipeLeftParams {
  onSwipe: () => void;
  /** Auslöse-Schwelle in px (Default: 25 % der Elementbreite, mind. 72 px). */
  threshold?: number;
  enabled?: boolean;
  /** Wischrichtung; Standard links. */
  direction?: 'left' | 'right';
  /** Fläche folgt dem Finger (Standard) — `false` für Gesten auf der Bühne. */
  move?: boolean;
  /** Selektor: Gesten, die hier beginnen, werden ignoriert. */
  ignore?: string;
  /** Fingerstand während der Geste (Vorzeichen der Richtung, 0 am Start) —
      damit eine andere Fläche am Finger kleben kann, etwa ein Blatt, das erst
      hereinkommt. */
  onDrag?: (travel: number) => void;
  /** Ende der Geste: `fired` sagt, ob die Schwelle erreicht war. */
  onDragEnd?: (fired: boolean) => void;
  /** Wie schief der Wisch sein darf, in Grad ab der Waagerechten (Default
      45). Größer = toleranter gegenüber einem ungenauen Finger; auf einer
      senkrecht scrollenden Fläche bleibt das Scrollen darüber hinaus. */
  angle?: number;
}

const DIRECTION_LOCK = 12; // px Bewegung, bis horizontal/vertikal entschieden ist
/* Ein Schnipser zählt auch unterhalb der Schwelle: schneller als das, in
   Wischrichtung, mindestens ein kleines Stück weit. */
const FLICK_VELOCITY = 0.45; // px je ms
const FLICK_MIN_TRAVEL = 24;

function insideHorizontalScroller(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
    el = el.parentElement;
  }
  return false;
}

function swallowNextClick(): void {
  const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); stop(); };
  /* Kommt kein Klick (Pointer-Capture, Touch ohne Klick), darf der nächste
     echte Tipp nicht geschluckt werden: ein neuer Finger hebt das Schlucken
     auf, spätestens die Frist. */
  const stop = () => {
    window.removeEventListener('click', swallow, { capture: true });
    window.removeEventListener('pointerdown', stop, { capture: true });
  };
  window.addEventListener('click', swallow, { capture: true });
  window.addEventListener('pointerdown', stop, { capture: true });
  window.setTimeout(stop, 400);
}

export function swipeleft(node: HTMLElement, params: SwipeLeftParams) {
  let { onSwipe, threshold, enabled = true, direction = 'left', move = true, ignore, onDrag, onDragEnd, angle = 45 } = params;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let locked: 'horizontal' | 'vertical' | null = null;
  /* Für die Geschwindigkeit beim Loslassen: Stand und Zeit der letzten Bewegungen. */
  let lastX = 0;
  let lastT = 0;
  let prevX = 0;
  let prevT = 0;

  const resolvedThreshold = () => threshold ?? Math.max(72, node.offsetWidth * 0.25);

  /* Während der Finger zieht, gilt keine Transition; danach übernimmt das
     Stylesheet (Dauer und Kurve aus den Tokens) — für das Zurückfedern wie
     für den Flug in die Klasse `is-hidden`. */
  const reset = () => {
    pointerId = null;
    dragging = false;
    locked = null;
    node.style.transition = '';
    node.style.transform = '';
  };

  const onDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0 || pointerId !== null) return;
    if (insideHorizontalScroller(e.target, node)) return;
    if (ignore && e.target instanceof Element && e.target.closest(ignore)) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastX = prevX = e.clientX;
    lastT = prevT = e.timeStamp;
    dragging = true;
    locked = null;
    node.style.transition = 'none';
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (locked === null && (Math.abs(dx) > DIRECTION_LOCK || Math.abs(dy) > DIRECTION_LOCK)) {
      const slope = Math.tan(Math.min(89, Math.max(1, angle)) * Math.PI / 180);
      locked = Math.abs(dy) <= Math.abs(dx) * slope ? 'horizontal' : 'vertical';
      if (locked === 'horizontal') {
        try {
          node.setPointerCapture(pointerId);
        } catch { /* Pointer schon weg (z. B. pointercancel): Geste läuft ohne Capture weiter. */ }
      }
    }
    if (locked !== 'horizontal') return;
    if (e.timeStamp - lastT > 40) { prevX = lastX; prevT = lastT; }
    lastX = e.clientX;
    lastT = e.timeStamp;
    const travel = direction === 'left' ? Math.min(0, dx) : Math.max(0, dx);
    onDrag?.(travel);
    if (!move) return;
    node.style.transform = `translateX(${travel}px)`;
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const travel = direction === 'left' ? startX - e.clientX : e.clientX - startX;
    const wasHorizontal = locked === 'horizontal';
    const dt = Math.max(1, e.timeStamp - prevT);
    const velocity = ((direction === 'left' ? prevX - e.clientX : e.clientX - prevX)) / dt;
    const flick = velocity >= FLICK_VELOCITY && travel >= FLICK_MIN_TRAVEL;
    const fire = wasHorizontal && (travel >= resolvedThreshold() || flick);
    /* Der Flug endet dort, wo die Klasse `is-hidden` die Fläche hinlegt: die
       Inline-Verschiebung fällt weg, die Transition läuft vom Fingerstand aus
       weiter, statt zurück auf null zu springen. */
    reset();
    if (wasHorizontal) onDragEnd?.(fire);
    if (!fire) return;
    if (!move) swallowNextClick();
    onSwipe();
  };

  const onCancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const wasHorizontal = locked === 'horizontal';
    reset();
    if (wasHorizontal) onDragEnd?.(false);
  };

  /* Auf Touch-Geräten entscheidet der Browser selbst, ob ein Finger scrollt —
     bei `touch-action: pan-y` schon ab 45 Grad, und dann bricht er unsere
     Geste mit pointercancel ab. Deshalb hört die Geste zusätzlich auf das
     erste touchmove (nicht passiv): liegt die Bewegung innerhalb des
     erlaubten Winkels, beansprucht sie den Finger mit preventDefault, und der
     Browser scrollt nicht; darüber hinaus bleibt es beim Scrollen. */
  const lockFromTouch = (e: TouchEvent) => {
    if (!dragging || pointerId === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    if (locked === 'horizontal') { e.preventDefault(); return; }
    if (locked === 'vertical') return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    /* Noch unentschieden: nichts verhindern — ein einmal verhindertes
       touchmove nimmt dem Browser das Scrollen für den ganzen Zug, und jeder
       Zug beginnt mit ein paar kleinen Bewegungen. Unsere Sperre (12 px)
       greift vor der des Browsers, die Entscheidung kommt also rechtzeitig. */
    if (Math.abs(dx) <= DIRECTION_LOCK && Math.abs(dy) <= DIRECTION_LOCK) return;
    const slope = Math.tan(Math.min(89, Math.max(1, angle)) * Math.PI / 180);
    locked = Math.abs(dy) <= Math.abs(dx) * slope ? 'horizontal' : 'vertical';
    if (locked === 'horizontal') {
      e.preventDefault();
      try { node.setPointerCapture(pointerId); } catch { /* siehe onMove */ }
    }
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onCancel);
  node.addEventListener('touchmove', lockFromTouch, { passive: false });

  return {
    update(next: SwipeLeftParams) {
      onSwipe = next.onSwipe;
      threshold = next.threshold;
      enabled = next.enabled ?? true;
      direction = next.direction ?? 'left';
      move = next.move ?? true;
      ignore = next.ignore;
      onDrag = next.onDrag;
      onDragEnd = next.onDragEnd;
      angle = next.angle ?? 45;
    },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onCancel);
      node.removeEventListener('touchmove', lockFromTouch);
    },
  };
}
