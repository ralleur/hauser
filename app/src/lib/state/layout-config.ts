import { sharedStorage } from './shared-config.ts';

import { m } from '../../paraglide/messages.js';
export type LayoutSlotId = 'slot-1' | 'slot-2';
export type WidthPresetId = 'compact' | 'balanced' | 'wide';

export interface LayoutSlot {
  id: LayoutSlotId;
  roomId: string | null;
}

export interface LayoutConfig {
  version: 1;
  widthPreset: WidthPresetId;
  slots: LayoutSlot[];
}

export interface WidthPreset {
  id: WidthPresetId;
  label: string;
  totalPercent: number;
  slotMinPx: number;
  heroMinPx: number;
}

export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LAYOUT_CONFIG_KEY = 'hmi:home-layout:v1';

export const WIDTH_PRESETS: readonly WidthPreset[] = [
  { id: 'compact', label: m.layout_compact(), totalPercent: 34, slotMinPx: 360, heroMinPx: 516 },
  { id: 'balanced', label: m.layout_balanced(), totalPercent: 44, slotMinPx: 378, heroMinPx: 480 },
  { id: 'wide', label: m.layout_wide(), totalPercent: 56, slotMinPx: 408, heroMinPx: 420 },
];

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  version: 1,
  widthPreset: 'compact',
  slots: [{ id: 'slot-1', roomId: null }],
};

export function cloneLayoutConfig(config: LayoutConfig): LayoutConfig {
  return { version: 1, widthPreset: config.widthPreset, slots: config.slots.map((slot) => ({ ...slot })) };
}

export function parseLayoutConfig(raw: string | null): LayoutConfig {
  if (!raw) return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || !isWidthPreset(candidate.widthPreset) || !Array.isArray(candidate.slots)) {
      return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
    }
    if (candidate.slots.length < 1 || candidate.slots.length > 2) return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
    const slots: LayoutSlot[] = [];
    for (let index = 0; index < candidate.slots.length; index++) {
      const value = candidate.slots[index];
      const expectedId: LayoutSlotId = index === 0 ? 'slot-1' : 'slot-2';
      if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
      const slot = value as Record<string, unknown>;
      if (slot.id !== expectedId || !(slot.roomId === null || isRoomId(slot.roomId))) {
        return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
      }
      slots.push({ id: expectedId, roomId: slot.roomId as string | null });
    }
    return { version: 1, widthPreset: candidate.widthPreset, slots };
  } catch {
    return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
  }
}

export function loadLayoutConfig(storage: LayoutStorage | undefined = browserStorage()): LayoutConfig {
  if (!storage) return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
  try { return parseLayoutConfig(storage.getItem(LAYOUT_CONFIG_KEY)); }
  catch { return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG); }
}

export function saveLayoutConfig(config: LayoutConfig, storage: LayoutStorage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LAYOUT_CONFIG_KEY, JSON.stringify(parseLayoutConfig(JSON.stringify(config))));
    return true;
  } catch { return false; }
}

export function resetLayoutConfig(storage: LayoutStorage | undefined = browserStorage()): LayoutConfig {
  if (storage) try { storage.removeItem(LAYOUT_CONFIG_KEY); } catch { /* preference reset must not block UI */ }
  return cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
}

export function addLayoutSlot(config: LayoutConfig, roomId: string | null): LayoutConfig {
  const next = cloneLayoutConfig(config);
  if (next.slots.length >= 2) return next;
  next.slots.push({ id: 'slot-2', roomId: isRoomId(roomId) ? roomId : null });
  return next;
}

export function removeSecondLayoutSlot(config: LayoutConfig): LayoutConfig {
  const next = cloneLayoutConfig(config);
  next.slots = next.slots.slice(0, 1);
  return next;
}

export function setSlotRoom(config: LayoutConfig, slotId: LayoutSlotId, roomId: string | null): LayoutConfig {
  const next = cloneLayoutConfig(config);
  const slot = next.slots.find((candidate) => candidate.id === slotId);
  if (slot) slot.roomId = isRoomId(roomId) ? roomId : null;
  return next;
}

export function setWidthPreset(config: LayoutConfig, widthPreset: WidthPresetId): LayoutConfig {
  const next = cloneLayoutConfig(config);
  if (isWidthPreset(widthPreset)) next.widthPreset = widthPreset;
  return next;
}

export function widthPreset(config: LayoutConfig): WidthPreset {
  return WIDTH_PRESETS.find((preset) => preset.id === config.widthPreset) ?? WIDTH_PRESETS[1];
}

export function reconcileLayoutRooms(config: LayoutConfig, validRoomIds: readonly string[]): LayoutConfig {
  const next = cloneLayoutConfig(config);
  const valid = new Set(validRoomIds);
  const fallback = validRoomIds[0] ?? null;
  for (const slot of next.slots) {
    if (slot.roomId === null || !valid.has(slot.roomId)) slot.roomId = fallback;
  }
  return next;
}

function isWidthPreset(value: unknown): value is WidthPresetId {
  return WIDTH_PRESETS.some((preset) => preset.id === value);
}

function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && /^[a-zA-Z0-9_-]+$/.test(value);
}

function browserStorage(): LayoutStorage | undefined {
  try { if (typeof localStorage === 'undefined') return undefined; } catch { return undefined; }
  const candidate = sharedStorage as Partial<LayoutStorage>;
  if (typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function' || typeof candidate.removeItem !== 'function') return undefined;
  return candidate as LayoutStorage;
}
