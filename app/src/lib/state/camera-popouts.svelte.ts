export type CameraPopoutMode = 'room' | 'always';

export interface CameraPopout {
  entityId: string;
  label: string;
  roomId: string;
  mode: CameraPopoutMode;
  size: number;
  x: number | null;
  y: number | null;
}

let popouts = $state<CameraPopout[]>([]);
let hiddenTitlebars = $state<string[]>([]);

export const cameraPopouts = {
  get items() { return popouts; },
  has(entityId: string) { return popouts.some((item) => item.entityId === entityId); },
  titlebarVisible(entityId: string) { return !hiddenTitlebars.includes(entityId); },
  open(entityId: string, label: string, roomId: string) {
    const current = popouts.find((item) => item.entityId === entityId);
    popouts = current
      ? popouts.map((item) => item.entityId === entityId ? { ...item, label, roomId } : item)
      : [...popouts, { entityId, label, roomId, mode: 'room', size: 25, x: null, y: null }];
  },
  dock(entityId: string) {
    popouts = popouts.filter((item) => item.entityId !== entityId);
  },
  setMode(entityId: string, mode: CameraPopoutMode) {
    popouts = popouts.map((item) => item.entityId === entityId ? { ...item, mode } : item);
  },
  setSize(entityId: string, size: number) {
    popouts = popouts.map((item) => item.entityId === entityId ? { ...item, size } : item);
  },
  setPosition(entityId: string, x: number, y: number) {
    popouts = popouts.map((item) => item.entityId === entityId ? { ...item, x, y } : item);
  },
  toggleTitlebar(entityId: string) {
    hiddenTitlebars = hiddenTitlebars.includes(entityId)
      ? hiddenTitlebars.filter((id) => id !== entityId)
      : [...hiddenTitlebars, entityId];
  },
};
