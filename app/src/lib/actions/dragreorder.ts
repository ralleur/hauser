/* Drag-Reorder-Action für Konfigurations-Overlays: hängt an den Neun-Punkte-
   Griff einer Listenzeile (`.cfg-handle`) und meldet die Zielposition, sobald
   der Zeiger weit genug über einer anderen Zeile steht. Die Zeilen tragen dafür
   `data-reorder-row="<id>"`; der Container wird über `list` benannt.

   Muster stammt aus RoomListEditor (Einstellungen → Räume & Geräte) und ist
   hier herausgelöst, damit jedes weitere Konfig-Overlay dieselbe Geste und
   dieselbe Tastaturbedienung bekommt (docs/07): Pfeil hoch/runter verschiebt
   ohne Zeiger, was Drag allein nicht bedienbar macht.

   Die Zeilenmaße werden beim Aufsetzen des Fingers einmal gemessen und
   während des Zugs nicht neu gelesen (Owner-Befund 2026-09-20: die Liste
   zitterte). Zwei Gründe: Die Zeilen wandern während des Zugs selbst — wer
   gegen die wandernden Kanten testet, tauscht in einer Rückkopplung hin und
   her —, und gleitende Nachbarn liefern ohnehin nur Zwischenstände. Getauscht
   wird erst, wenn die Mitte der gezogenen Zeile ein Viertel in den Nachbarslot
   hineinragt; zurück braucht es dieselbe Strecke, damit nichts flackert.

   Reines Melden — die Reihenfolge hält der Aufrufer. */

export interface DragReorderParams {
  /** Id der Zeile, an deren Griff die Action hängt */
  id: string;
  /** Container mit den `data-reorder-row`-Zeilen */
  list: () => HTMLElement | undefined;
  /** Zielposition melden (Index in der aktuellen Anzeige-Reihenfolge) */
  onReorder: (id: string, targetIndex: number) => void;
  /** true, während diese Zeile gezogen wird (für den Cursor-/Zustandsstil) */
  onDragChange?: (dragging: boolean) => void;
  /** Versatz der gezogenen Zeile zu ihrem Slot in px — damit sie am Finger hängt */
  onDragOffset?: (offset: number) => void;
  /** false = Griff inaktiv (Liste mit weniger als zwei Zeilen) */
  enabled?: boolean;
}

/* Wie weit die Mitte in den Nachbarslot muss, bevor getauscht wird. */
const SWAP_THRESHOLD = 0.25;

interface Slot { top: number; height: number }

export function dragreorder(node: HTMLElement, params: DragReorderParams) {
  let current = params;
  let dragging = false;
  let slots: Slot[] = [];
  let startIndex = 0;
  let slotIndex = 0;
  let startY = 0;

  const rows = (): HTMLElement[] => [
    ...(current.list()?.querySelectorAll<HTMLElement>('[data-reorder-row]') ?? []),
  ];

  const setDragging = (value: boolean) => {
    if (dragging === value) return;
    dragging = value;
    current.onDragChange?.(value);
    if (!value) current.onDragOffset?.(0);
  };

  const onDown = (event: PointerEvent) => {
    if (current.enabled === false || event.button !== 0) return;
    const list = rows();
    if (list.length < 2) return;
    startIndex = list.findIndex((row) => row.dataset.reorderRow === current.id);
    if (startIndex < 0) return;
    event.preventDefault();
    node.setPointerCapture(event.pointerId);
    slots = list.map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    slotIndex = startIndex;
    startY = event.clientY;
    setDragging(true);
    current.onDragOffset?.(0);
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    const start = slots[startIndex];
    if (!start) return;
    const travel = event.clientY - startY;
    const center = start.top + start.height / 2 + travel;
    let next = slotIndex;
    while (next > 0) {
      const above = slots[next - 1];
      if (center >= above.top + above.height * (1 - SWAP_THRESHOLD)) break;
      next -= 1;
    }
    while (next < slots.length - 1) {
      const below = slots[next + 1];
      if (center <= below.top + below.height * SWAP_THRESHOLD) break;
      next += 1;
    }
    if (next !== slotIndex) {
      slotIndex = next;
      current.onReorder(current.id, next);
    }
    /* Der Versatz zählt ab dem Slot, in dem die Zeile gerade steckt — sonst
       spränge sie bei jedem Tausch um eine Zeilenhöhe. */
    current.onDragOffset?.(start.top + travel - (slots[slotIndex]?.top ?? start.top));
  };

  const onUp = (event: PointerEvent) => {
    if (!dragging) return;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (current.enabled === false) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const index = rows().findIndex((row) => row.dataset.reorderRow === current.id);
    if (index < 0) return;
    event.preventDefault();
    current.onReorder(current.id, index + (event.key === 'ArrowUp' ? -1 : 1));
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  node.addEventListener('keydown', onKeydown);

  return {
    update(next: DragReorderParams) {
      current = next;
    },
    destroy() {
      setDragging(false);
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      node.removeEventListener('keydown', onKeydown);
    },
  };
}
