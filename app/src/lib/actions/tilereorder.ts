/* Kachel-Reorder für die gespiegelte Raum-Konfiguration am Telefon: die
   Geschwister von `dragreorder`, aber im Raster und ohne Griff — die Kachel
   selbst ist der Griff, wie auf dem Home-Bildschirm. Kurz halten, dann ziehen;
   ein schneller Wisch bleibt das Scrollen der Seite.

   Die Kacheln tragen `data-reorder-tile="<id>"`; der Container wird über
   `grid` benannt. Wie bei `dragreorder` werden die Plätze beim Aufnehmen
   einmal gemessen und während des Zugs nicht neu gelesen — die Nachbarn
   wandern selbst, wer gegen wandernde Kanten testet, tauscht in einer
   Rückkopplung hin und her. Getauscht wird, wenn die Mitte der Kachel einem
   anderen Platz deutlich näher ist als dem eigenen.

   Reines Melden — die Reihenfolge hält der Aufrufer. Pfeiltasten verschieben
   ohne Zeiger (links/rechts um eins, hoch/runter um eine Rasterzeile). */

export interface TileReorderParams {
  id: string;
  grid: () => HTMLElement | undefined;
  /** Zielposition melden (Index in der aktuellen Anzeige-Reihenfolge) */
  onReorder: (id: string, targetIndex: number) => void;
  onDragChange?: (dragging: boolean) => void;
  /** Versatz der gezogenen Kachel zu ihrem Platz in px — damit sie am Finger hängt */
  onDragOffset?: (offset: { x: number; y: number }) => void;
  enabled?: boolean;
}

const HOLD_MS = 200;
/* Bewegt sich der Finger vor Ablauf so weit, war es ein Wisch, kein Halten. */
const HOLD_SLOP = 8;
/* Ein anderer Platz gewinnt erst, wenn er deutlich näher liegt. */
const SWAP_BIAS = 0.75;

interface Slot { x: number; y: number; width: number; height: number }

export function tilereorder(node: HTMLElement, params: TileReorderParams) {
  let current = params;
  let dragging = false;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerId = -1;
  let slots: Slot[] = [];
  let startIndex = 0;
  let slotIndex = 0;
  let startX = 0;
  let startY = 0;

  const tiles = (): HTMLElement[] => [
    ...(current.grid()?.querySelectorAll<HTMLElement>('[data-reorder-tile]') ?? []),
  ];

  const setDragging = (value: boolean) => {
    if (dragging === value) return;
    dragging = value;
    current.onDragChange?.(value);
    if (!value) current.onDragOffset?.({ x: 0, y: 0 });
  };

  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = undefined; };

  const pickUp = () => {
    holdTimer = undefined;
    const list = tiles();
    startIndex = list.findIndex((tile) => tile.dataset.reorderTile === current.id);
    if (list.length < 2 || startIndex < 0) return;
    slots = list.map((tile) => {
      const rect = tile.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    });
    slotIndex = startIndex;
    try { node.setPointerCapture(pointerId); } catch { /* Zeiger schon fort */ }
    setDragging(true);
    current.onDragOffset?.({ x: 0, y: 0 });
  };

  const onDown = (event: PointerEvent) => {
    if (current.enabled === false || event.button !== 0) return;
    /* Das Minus an der Ecke bleibt ein Tipp. */
    if (event.target instanceof Element && event.target.closest('button')) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    cancelHold();
    holdTimer = setTimeout(pickUp, HOLD_MS);
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging) {
      if (holdTimer && Math.hypot(event.clientX - startX, event.clientY - startY) > HOLD_SLOP) cancelHold();
      return;
    }
    const start = slots[startIndex];
    if (!start) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const cx = start.x + start.width / 2 + dx;
    const cy = start.y + start.height / 2 + dy;
    const distance = (slot: Slot) => Math.hypot(slot.x + slot.width / 2 - cx, slot.y + slot.height / 2 - cy);
    let next = slotIndex;
    let best = distance(slots[slotIndex]) * SWAP_BIAS;
    slots.forEach((slot, index) => {
      const d = distance(slot);
      if (index !== slotIndex && d < best) { best = d; next = index; }
    });
    if (next !== slotIndex) {
      slotIndex = next;
      current.onReorder(current.id, next);
    }
    /* Der Versatz zählt ab dem Platz, in dem die Kachel gerade steckt. */
    const home = slots[slotIndex] ?? start;
    current.onDragOffset?.({ x: start.x + dx - home.x, y: start.y + dy - home.y });
  };

  const onUp = (event: PointerEvent) => {
    cancelHold();
    if (!dragging) return;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  /* Nach dem Aufnehmen gehört die Bewegung der Kachel, nicht dem Scrollen. */
  const onTouchMove = (event: TouchEvent) => { if (dragging && event.cancelable) event.preventDefault(); };
  const onContextMenu = (event: Event) => { if (dragging || holdTimer) event.preventDefault(); };

  const onKeydown = (event: KeyboardEvent) => {
    if (current.enabled === false) return;
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' ? -2 : event.key === 'ArrowDown' ? 2 : 0;
    if (step === 0) return;
    const list = tiles();
    const index = list.findIndex((tile) => tile.dataset.reorderTile === current.id);
    const target = index + step;
    if (index < 0 || target < 0 || target > list.length - 1) return;
    event.preventDefault();
    current.onReorder(current.id, target);
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('contextmenu', onContextMenu);
  node.addEventListener('keydown', onKeydown);

  return {
    update(next: TileReorderParams) { current = next; },
    destroy() {
      cancelHold();
      setDragging(false);
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('contextmenu', onContextMenu);
      node.removeEventListener('keydown', onKeydown);
    },
  };
}
