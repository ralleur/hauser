/* Raumauswahl am Panel (`ralleur/hauser#40`, Owner 2026-10-19): so viele Räume
   auf einer Seite, wie es gut aussieht — die Spalten folgen der Zahl —, aber
   nie mehr als die Obergrenze aus dem Layout-Menü, sonst würden die Kacheln
   winzig. Was darüber hinausgeht, kommt auf die nächste Seite. */
export const PANEL_ROOMS_PER_PAGE_DEFAULT = 8;
export const PANEL_ROOMS_PER_PAGE_MIN = 4;
export const PANEL_ROOMS_PER_PAGE_MAX = 16;

export function normalizeRoomsPerPage(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : PANEL_ROOMS_PER_PAGE_DEFAULT;
  return Math.min(PANEL_ROOMS_PER_PAGE_MAX, Math.max(PANEL_ROOMS_PER_PAGE_MIN, n));
}

/** Räume je Seite: alle, solange sie unter die Obergrenze passen. */
export function panelRoomPageSize(roomCount: number, maxPerPage = PANEL_ROOMS_PER_PAGE_DEFAULT): number {
  return Math.max(1, Math.min(normalizeRoomsPerPage(maxPerPage), Math.max(0, roomCount)));
}

/** Spalten für so viele Räume auf einer Seite: bis acht zwei (höchstens 2×4),
    bis zwölf drei (3×4), darüber vier. Jede Seite nutzt dieselben Spalten. */
export function panelRoomColumns(roomCount: number, maxPerPage = PANEL_ROOMS_PER_PAGE_DEFAULT): number {
  const perPage = panelRoomPageSize(roomCount, maxPerPage);
  return perPage <= 8 ? 2 : perPage <= 12 ? 3 : 4;
}

export function panelRoomPageCount(roomCount: number, maxPerPage = PANEL_ROOMS_PER_PAGE_DEFAULT): number {
  return Math.max(1, Math.ceil(Math.max(0, roomCount) / panelRoomPageSize(roomCount, maxPerPage)));
}

export function clampPanelRoomPage(page: number, roomCount: number, maxPerPage = PANEL_ROOMS_PER_PAGE_DEFAULT): number {
  const lastPage = panelRoomPageCount(roomCount, maxPerPage) - 1;
  return Math.min(lastPage, Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0));
}

export function panelRoomPages<T>(rooms: readonly T[], maxPerPage = PANEL_ROOMS_PER_PAGE_DEFAULT): T[][] {
  if (rooms.length === 0) return [[]];
  const size = panelRoomPageSize(rooms.length, maxPerPage);
  return Array.from(
    { length: panelRoomPageCount(rooms.length, maxPerPage) },
    (_, page) => rooms.slice(page * size, (page + 1) * size),
  );
}

export function panelRoomPageForSelection<T extends { id: string }>(
  rooms: readonly T[],
  selectedRoomId: string | null | undefined,
  fallbackPage: number,
  maxPerPage = PANEL_ROOMS_PER_PAGE_DEFAULT,
): number {
  const selectedIndex = selectedRoomId
    ? rooms.findIndex(({ id }) => id === selectedRoomId)
    : -1;
  return selectedIndex >= 0
    ? Math.floor(selectedIndex / panelRoomPageSize(rooms.length, maxPerPage))
    : clampPanelRoomPage(fallbackPage, rooms.length, maxPerPage);
}
