import {
  addLayoutSlot,
  loadLayoutConfig,
  removeSecondLayoutSlot,
  reconcileLayoutRooms,
  resetLayoutConfig,
  saveLayoutConfig,
  setHomeView,
  setPanelAutoHide,
  setPanelSize,
  setRoomsPerRow,
  setRoomsRows,
  setRoomsPerPageMax,
  setSlotRoom,
  setWidthPreset,
  type HomeViewId,
  type LayoutConfig,
  type LayoutSlotId,
  type WidthPresetId,
} from './layout-config.ts';
import { appState } from './app.svelte.ts';
import { roomLightPlacements } from './immersion-light.svelte.ts';
import { roomImageDevices } from './room-image-devices.ts';

/** Counts missing positions for the optional configuration notice. */
export function imageControlStatus() {
  const rooms = appState.rooms.map(room => {
    const placements = roomLightPlacements(room.id);
    const devices = roomImageDevices(room);
    const missing = devices.filter(device => !placements[device.entityId]);
    return { id: room.id, name: room.name, total: devices.length, placed: devices.length - missing.length, missing };
  });
  const total = rooms.reduce((sum, room) => sum + room.total, 0);
  const missing = rooms.reduce((sum, room) => sum + room.missing.length, 0);
  return { rooms, total, missing, ready: total > 0 && missing === 0 };
}

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
  setRoomsRows(value: number) { commit(setRoomsRows(applied, value)); },
  setRoomsPerPageMax(value: number) { commit(setRoomsPerPageMax(applied, value)); },
  setPanelAutoHide(enabled: boolean, seconds?: number) { commit(setPanelAutoHide(applied, enabled, seconds)); },
  setHomeView(value: HomeViewId) { commit(setHomeView(applied, value)); },
  /* Nur im Speicher, nie gespeichert: Die Startseite ruft das vor dem Abgleich
     mit dem Server auf. Mit leerem Browser-Speicher hätte der aufgefüllte
     Standard als eigene Änderung gegolten und die gespeicherte Breite und
     Spaltenzahl auf dem Server überschrieben (ralleur/hauser#28). */
  reconcileRooms(validRoomIds: readonly string[]) {
    const next = reconcileLayoutRooms(applied, validRoomIds);
    if (JSON.stringify(next) !== JSON.stringify(applied)) applied = next;
  },
};
