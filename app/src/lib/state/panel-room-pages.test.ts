import { describe, expect, it } from 'vitest';
import {
  PANEL_ROOMS_PER_PAGE_DEFAULT,
  clampPanelRoomPage,
  normalizeRoomsPerPage,
  panelRoomColumns,
  panelRoomPageCount,
  panelRoomPageForSelection,
  panelRoomPages,
} from './panel-room-pages.ts';

const rooms = Array.from({ length: 20 }, (_, index) => ({ id: `room_${index + 1}` }));

describe('panel room pages', () => {
  it('shows every room on one page while they fit under the limit (#40)', () => {
    expect(PANEL_ROOMS_PER_PAGE_DEFAULT).toBe(8);
    expect(panelRoomPageCount(0)).toBe(1);
    expect(panelRoomPageCount(6)).toBe(1);
    expect(panelRoomPageCount(8)).toBe(1);
    expect(panelRoomPageCount(9)).toBe(2);
    expect(panelRoomPages(rooms.slice(0, 11)).map((page) => page.length)).toEqual([8, 3]);
  });

  it('picks columns from the number of rooms on a page', () => {
    expect([1, 4, 6, 8].map((count) => panelRoomColumns(count, 16))).toEqual([2, 2, 2, 2]);
    expect([9, 12].map((count) => panelRoomColumns(count, 16))).toEqual([3, 3]);
    expect(panelRoomColumns(16, 16)).toBe(4);
    /* Über der Obergrenze zählt die volle Seite, auch für die letzte. */
    expect(panelRoomColumns(20, 9)).toBe(3);
    expect(panelRoomColumns(20, 6)).toBe(2);
  });

  it('pages by the chosen limit and keeps it within bounds', () => {
    expect(panelRoomPages(rooms.slice(0, 8), 6).map((page) => page.length)).toEqual([6, 2]);
    expect(panelRoomPages(rooms, 16).map((page) => page.length)).toEqual([16, 4]);
    expect(normalizeRoomsPerPage(2)).toBe(4);
    expect(normalizeRoomsPerPage(99)).toBe(16);
    expect(normalizeRoomsPerPage('viele')).toBe(PANEL_ROOMS_PER_PAGE_DEFAULT);
    expect(normalizeRoomsPerPage(Number.NaN)).toBe(PANEL_ROOMS_PER_PAGE_DEFAULT);
  });

  it('clamps stale pages and opens the page containing an externally selected room', () => {
    expect(clampPanelRoomPage(-4, 12)).toBe(0);
    expect(clampPanelRoomPage(8, 12)).toBe(1);
    expect(panelRoomPageForSelection(rooms.slice(0, 12), 'room_9', 0)).toBe(1);
    expect(panelRoomPageForSelection(rooms.slice(0, 12), 'room_7', 0, 6)).toBe(1);
    expect(panelRoomPageForSelection(rooms, 'missing', 1)).toBe(1);
    expect(panelRoomPageForSelection([], null, 4)).toBe(0);
  });
});
