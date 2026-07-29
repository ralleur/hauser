import { describe, expect, it } from 'vitest';
import {
  PANEL_ROOMS_PER_PAGE,
  clampPanelRoomPage,
  panelRoomPageCount,
  panelRoomPageForSelection,
  panelRoomPages,
} from './panel-room-pages.ts';

const rooms = Array.from({ length: 12 }, (_, index) => ({ id: `room_${index + 1}` }));

describe('panel room pages', () => {
  it('keeps the existing six-room contract and creates bounded 2x3 pages afterwards', () => {
    expect(PANEL_ROOMS_PER_PAGE).toBe(6);
    expect(panelRoomPageCount(0)).toBe(1);
    expect(panelRoomPageCount(1)).toBe(1);
    expect(panelRoomPageCount(6)).toBe(1);
    expect(panelRoomPageCount(7)).toBe(2);
    expect(panelRoomPageCount(12)).toBe(2);
    expect(panelRoomPages(rooms.slice(0, 7)).map((page) => page.length)).toEqual([6, 1]);
  });

  it('clamps stale pages and opens the page containing an externally selected room', () => {
    expect(clampPanelRoomPage(-4, 12)).toBe(0);
    expect(clampPanelRoomPage(8, 12)).toBe(1);
    expect(panelRoomPageForSelection(rooms, 'room_7', 0)).toBe(1);
    expect(panelRoomPageForSelection(rooms, 'missing', 1)).toBe(1);
    expect(panelRoomPageForSelection([], null, 4)).toBe(0);
  });
});