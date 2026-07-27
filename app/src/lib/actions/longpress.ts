/* Long-Press-Action: hält der Finger ~400 ms still, feuert `onLongPress`
   (Licht-Detail öffnen, docs/07 zweite Ebene). Der kurze Tap bleibt dem Klick
   der Kachel (Toggle) — nach einem ausgelösten Long-Press wird der folgende
   `click` unterdrückt, damit nicht zusätzlich getoggelt wird. Bewegung > 10 px
   (Scroll) bricht ab. `contextmenu` während des Drucks wird unterdrückt (kein
   iOS/Desktop-Kontextmenü). Motion-frei; Stil analog actions/pulse.ts. */

export interface LongPressParams {
  onLongPress: () => void;
  ms?: number;
  /** false = Action inaktiv (Licht ohne regelbare Fähigkeit) */
  enabled?: boolean;
}

const MOVE_TOLERANCE = 10; // px

export function longpress(node: HTMLElement, params: LongPressParams) {
  let { onLongPress, ms = 400, enabled = true } = params;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const clear = () => { clearTimeout(timer); timer = undefined; };

  const onDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0) return;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    clear();
    timer = setTimeout(() => { fired = true; onLongPress(); }, ms);
  };

  const onMove = (e: PointerEvent) => {
    if (timer === undefined) return;
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) clear();
  };

  const onUp = () => clear();

  // Nach einem ausgelösten Long-Press den unmittelbar folgenden Klick schlucken
  // (Capture-Phase, vor dem onclick der Kachel), damit der Tap nicht togglet.
  const onClick = (e: MouseEvent) => {
    if (!fired) return;
    fired = false;
    // Svelte hängt `onclick` am selben Node ein. stopPropagation() reicht dafür
    // nicht; nur stopImmediatePropagation() blockt nachfolgende Same-Target-Handler.
    e.stopImmediatePropagation();
    e.preventDefault();
  };

  const onContextMenu = (e: Event) => { if (fired || timer !== undefined) e.preventDefault(); };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  node.addEventListener('pointerleave', onUp);
  node.addEventListener('click', onClick, { capture: true });
  node.addEventListener('contextmenu', onContextMenu);

  return {
    update(next: LongPressParams) {
      onLongPress = next.onLongPress;
      ms = next.ms ?? 400;
      enabled = next.enabled ?? true;
    },
    destroy() {
      clear();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      node.removeEventListener('pointerleave', onUp);
      node.removeEventListener('click', onClick, { capture: true });
      node.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
