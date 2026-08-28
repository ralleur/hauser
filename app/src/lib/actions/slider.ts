/* ValueSlider (docs/06 Primitives): Haarlinien-Track, Wert IM Thumb-Badge.
   Fill via scaleX, Thumb via translateX — keine Layout-Properties.
   Portiert aus prototype initSlider() als Svelte-Action: identisches DOM,
   identische Pointer-Mechanik. onChange(val, final) pflegt den State,
   final=true entspricht Release → Command (docs/02 Slider-Contract).
   plain = Thumb ohne Wert-Badge (Player-Seek: Zeit steht daneben).
   Externe Updates (Wiedergabe-Tick) kommen über den value-Parameter —
   während eines Drags gewinnt immer der Finger. */

export interface SliderParams {
  value: number; // Prozent 0–100
  onChange: (val: number, final: boolean) => void;
  plain?: boolean;
  /* disabled = Pendant zu "initSlider wird nicht gebunden" im Clickdummy
     (Player nicht verfügbar): kein Paint, keine Pointer-Reaktion */
  disabled?: boolean;
  /* Reconciliation-Korrektur (docs/02): steigt diese Sequenz, interpoliert der
     Slider den nächsten value-Wechsel über --duration-correct (300 ms) statt
     zurückzuspringen. Die Action steuert das Timing selbst, damit die Transition-
     Klasse garantiert VOR dem Repaint sitzt. */
  correct?: number;
  format?: (value: number) => string;
}

export function slider(node: HTMLElement, params: SliderParams) {
  let { value, onChange, plain, disabled, format } = params;
  let lastCorrect = params.correct ?? 0;
  let correctTimer: ReturnType<typeof setTimeout> | undefined;

  const fill = node.querySelector<HTMLElement>('.slider-fill')!;
  const thumb = node.querySelector<HTMLElement>('.slider-thumb')!;
  // Gemessen statt Konstante: der Seek-Thumb ist kleiner als das 40px-Badge.
  // In versteckten Containern (display:none) misst 0 → Fallback 40px-Badge.
  const THUMB_HALF = (thumb.offsetWidth || 40) / 2;

  let width = 0;
  const measure = () => { width = node.clientWidth; };

  let shownPct: number | null = null;
  const paint = (pct: number) => {
    const usable = Math.max(0, width - 2 * THUMB_HALF);
    const x = THUMB_HALF + (pct / 100) * usable;
    fill.style.transform = `scaleX(${pct / 100})`;
    node.style.setProperty('--thumb-x', `translateX(${x}px)`);
    if (!plain && pct !== shownPct) { shownPct = pct; thumb.textContent = format ? format(pct) : String(Math.round(pct)); }
  };

  // Initial-Paint: synchron, wenn das Element schon Layout hat
  measure();
  if (!disabled && width > 0) paint(value);

  // Anders als im Clickdummy (Render beim Tab-Wechsel) sind die Screens hier
  // statisch gemountet: beim App-Start ist der Container display:none und
  // misst 0. Der ResizeObserver malt nach, sobald Layout da ist (Screen wird
  // sichtbar, Overlay öffnet, Rotation) — Ersatz für den alten rAF-Fallback.
  const ro = new ResizeObserver(() => {
    const prev = width;
    measure();
    if (!disabled && !dragging && width > 0 && width !== prev) paint(pendingPct);
  });
  ro.observe(node);

  let dragging = false;
  let rafPending = false;
  let pendingPct = value;

  const pctFromEvent = (e: PointerEvent) => {
    const rect = node.getBoundingClientRect();
    const x = e.clientX - rect.left - THUMB_HALF;
    const usable = Math.max(1, rect.width - 2 * THUMB_HALF);
    return Math.round(Math.min(100, Math.max(0, (x / usable) * 100)));
  };

  const onDown = (e: PointerEvent) => {
    if (disabled) return;
    dragging = true;
    measure();
    node.classList.add('is-dragging');
    // Capture kann werfen, wenn der Pointer schon wieder weg ist — dann
    // trotzdem malen (der Tap auf den Track soll nie verloren gehen)
    try { node.setPointerCapture(e.pointerId); } catch { /* noop */ }
    pendingPct = pctFromEvent(e);
    paint(pendingPct);
    onChange(pendingPct, false);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    pendingPct = pctFromEvent(e);
    onChange(pendingPct, false);
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; paint(pendingPct); });
    }
  };

  const end = () => {
    if (!dragging) return;
    dragging = false;
    node.classList.remove('is-dragging');
    onChange(pendingPct, true); // Release → Command (docs/02 Slider-Contract)
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);

  return {
    update(next: SliderParams) {
      onChange = next.onChange;
      plain = next.plain;
      disabled = next.disabled;
      value = next.value;
      format = next.format;
      if (disabled || dragging) return; // Drag hat Vorrang vor externen Updates
      if (!width) measure();
      pendingPct = value;
      // Korrektur nach Widerspruch (docs/02): transiente 300-ms-Transition auf den
      // Thumb/Fill-Transform — Klasse VOR paint(), damit der Übergang greift.
      const nextCorrect = next.correct ?? 0;
      if (nextCorrect !== lastCorrect) {
        lastCorrect = nextCorrect;
        node.classList.add('is-correcting');
        clearTimeout(correctTimer);
        correctTimer = setTimeout(() => node.classList.remove('is-correcting'), 300);
      }
      paint(value);
    },
    destroy() {
      clearTimeout(correctTimer);
      ro.disconnect();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
    },
  };
}
