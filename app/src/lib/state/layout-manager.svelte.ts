import {
  DEFAULT_LAYOUT_CONFIG,
  addLayoutSlot,
  cloneLayoutConfig,
  loadLayoutConfig,
  removeSecondLayoutSlot,
  reconcileLayoutRooms,
  resetLayoutConfig,
  saveLayoutConfig,
  setPanelSize,
  setRoomsPerRow,
  setSlotRoom,
  setWidthPreset,
  type LayoutConfig,
  type LayoutScope,
  type LayoutSlotId,
  type WidthPresetId,
} from './layout-config.ts';

const initial = loadLayoutConfig();
let applied = $state<LayoutConfig>(initial);
let draft = $state<LayoutConfig>(cloneLayoutConfig(initial));
let open = $state(false);
/* Welche Kontrollfläche der Dialog gerade breit macht — Home oder Energie. */
let scope = $state<LayoutScope>('home');

export function rehydrateLayoutManager(): void {
  applied = loadLayoutConfig();
  draft = cloneLayoutConfig(applied);
  open = false;
}

export const layoutManager = {
  get applied() { return applied; },
  get preview() { return open ? draft : applied; },
  get draft() { return draft; },
  get open() { return open; },
  get scope() { return scope; },
  show(target: LayoutScope = 'home') {
    draft = cloneLayoutConfig(applied);
    scope = target;
    open = true;
  },
  cancel() {
    draft = cloneLayoutConfig(applied);
    open = false;
  },
  apply() {
    applied = cloneLayoutConfig(draft);
    saveLayoutConfig(applied);
    open = false;
  },
  reset() { draft = cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG); },
  resetAndApply() {
    applied = resetLayoutConfig();
    draft = cloneLayoutConfig(applied);
    open = false;
  },
  addSlot(roomId: string | null) { draft = addLayoutSlot(draft, roomId); },
  removeSlot() { draft = removeSecondLayoutSlot(draft); },
  setRoom(slotId: LayoutSlotId, roomId: string | null) { draft = setSlotRoom(draft, slotId, roomId); },
  setAppliedRoom(slotId: LayoutSlotId, roomId: string | null) {
    applied = setSlotRoom(applied, slotId, roomId);
    saveLayoutConfig(applied);
  },
  setWidth(preset: WidthPresetId) { draft = setWidthPreset(draft, preset); },
  setPanelSize(value: number) { draft = setPanelSize(draft, value, scope); },
  setRoomsPerRow(value: number) { draft = setRoomsPerRow(draft, value); },
  reconcileRooms(validRoomIds: readonly string[]) {
    const nextApplied = reconcileLayoutRooms(applied, validRoomIds);
    if (JSON.stringify(nextApplied) !== JSON.stringify(applied)) {
      applied = nextApplied;
      saveLayoutConfig(applied);
    }
    draft = reconcileLayoutRooms(draft, validRoomIds);
  },
};
