export const PANEL_ROOMS_PER_PAGE = 6;

export function panelRoomPageCount(roomCount: number): number {
  return Math.max(1, Math.ceil(Math.max(0, roomCount) / PANEL_ROOMS_PER_PAGE));
}

export function clampPanelRoomPage(page: number, roomCount: number): number {
  const lastPage = panelRoomPageCount(roomCount) - 1;
  return Math.min(lastPage, Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0));
}

export function panelRoomPages<T>(rooms: readonly T[]): T[][] {
  if (rooms.length === 0) return [[]];
  return Array.from(
    { length: panelRoomPageCount(rooms.length) },
    (_, page) => rooms.slice(page * PANEL_ROOMS_PER_PAGE, (page + 1) * PANEL_ROOMS_PER_PAGE),
  );
}

export function panelRoomPageForSelection<T extends { id: string }>(
  rooms: readonly T[],
  selectedRoomId: string | null | undefined,
  fallbackPage: number,
): number {
  const selectedIndex = selectedRoomId
    ? rooms.findIndex(({ id }) => id === selectedRoomId)
    : -1;
  return selectedIndex >= 0
    ? Math.floor(selectedIndex / PANEL_ROOMS_PER_PAGE)
    : clampPanelRoomPage(fallbackPage, rooms.length);
}
