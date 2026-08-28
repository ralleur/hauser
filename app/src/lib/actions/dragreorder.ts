/* Drag-Reorder-Action für Konfigurations-Overlays: hängt an den Neun-Punkte-
   Griff einer Listenzeile (`.cfg-handle`) und meldet die Zielposition, sobald
   der Zeiger über einer anderen Zeile steht. Die Zeilen tragen dafür
   `data-reorder-row="<id>"`; der Container wird über `list` benannt.

   Muster stammt aus RoomListEditor (Einstellungen → Räume & Geräte) und ist
   hier herausgelöst, damit jedes weitere Konfig-Overlay dieselbe Geste und
   dieselbe Tastaturbedienung bekommt (docs/07): Pfeil hoch/runter verschiebt
   ohne Zeiger, was Drag allein nicht bedienbar macht.

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
  /** false = Griff inaktiv (Liste mit weniger als zwei Zeilen) */
  enabled?: boolean;
}

export function dragreorder(node: HTMLElement, params: DragReorderParams) {
  let current = params;
  let dragging = false;

  const rows = (): HTMLElement[] => [
    ...(current.list()?.querySelectorAll<HTMLElement>('[data-reorder-row]') ?? []),
  ];

  const setDragging = (value: boolean) => {
    if (dragging === value) return;
    dragging = value;
    current.onDragChange?.(value);
  };

  const onDown = (event: PointerEvent) => {
    if (current.enabled === false || event.button !== 0 || rows().length < 2) return;
    event.preventDefault();
    node.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    const list = rows();
    const target = list.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (target < 0 || list[target]?.dataset.reorderRow === current.id) return;
    current.onReorder(current.id, target);
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
