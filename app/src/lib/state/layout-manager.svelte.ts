import {
  addLayoutSlot,
  loadLayoutConfig,
  removeSecondLayoutSlot,
  reconcileLayoutRooms,
  resetLayoutConfig,
  saveLayoutConfig,
  setHomeView,
  setPanelSize,
  setRoomsPerRow,
  setSlotRoom,
  setWidthPreset,
  type HomeViewId,
  type LayoutConfig,
  type LayoutSlotId,
  type WidthPresetId,
} from './layout-config.ts';

/* Owner-Entscheidung 2026-09-11: Es gibt keinen Entwurf mehr — jede
   Einstellung im Layout-Dialog gilt sofort und wird sofort gespeichert. Der
   Dialog kennt nur noch Auf und Zu; `closing` trägt den Ausflug, bis die
   Animation zu Ende ist. */
let applied = $state<LayoutConfig>(loadLayoutConfig());
let open = $state(false);
let closing = $state(false);

export function rehydrateLayoutManager(): void {
  applied = loadLayoutConfig();
  open = false;
  closing = false;
}

function commit(next: LayoutConfig): void {
  applied = next;
  saveLayoutConfig(applied);
}

export const layoutManager = {
  get applied() { return applied; },
  get preview() { return applied; },
  get open() { return open; },
  get closing() { return closing; },
  show() {
    open = true;
    closing = false;
  },
  /** Leitet den Ausflug ein; `finishHide()` schließt nach der Animation. */
  hide() {
    if (!open) return;
    closing = true;
  },
  finishHide() {
    open = false;
    closing = false;
  },
  reset() { commit(resetLayoutConfig()); },
  resetAndApply() {
    commit(resetLayoutConfig());
    open = false;
    closing = false;
  },
  addSlot(roomId: string | null) { commit(addLayoutSlot(applied, roomId)); },
  removeSlot() { commit(removeSecondLayoutSlot(applied)); },
  setRoom(slotId: LayoutSlotId, roomId: string | null) { commit(setSlotRoom(applied, slotId, roomId)); },
  setAppliedRoom(slotId: LayoutSlotId, roomId: string | null) { commit(setSlotRoom(applied, slotId, roomId)); },
  setWidth(preset: WidthPresetId) { commit(setWidthPreset(applied, preset)); },
  setPanelSize(value: number) { commit(setPanelSize(applied, value)); },
  setRoomsPerRow(value: number) { commit(setRoomsPerRow(applied, value)); },
  setHomeView(value: HomeViewId) { commit(setHomeView(applied, value)); },
  reconcileRooms(validRoomIds: readonly string[]) {
    const next = reconcileLayoutRooms(applied, validRoomIds);
    if (JSON.stringify(next) !== JSON.stringify(applied)) commit(next);
  },
};
