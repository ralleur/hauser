import { isKnownIcon } from './icon-catalog.ts';

export const ICON_RECENT_STORAGE_KEY = 'hmi:recent-icons:v1';
const MAX_RECENT_ICONS = 10;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function loadRecentIcons(storage: StorageLike | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(ICON_RECENT_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === 'string' && isKnownIcon(id)).slice(0, MAX_RECENT_ICONS);
  } catch {
    return [];
  }
}

export function rememberRecentIcon(id: string, storage: StorageLike | null = browserStorage()): string[] {
  if (!isKnownIcon(id)) return loadRecentIcons(storage);
  const recent = [id, ...loadRecentIcons(storage).filter((current) => current !== id)].slice(0, MAX_RECENT_ICONS);
  if (storage) {
    try { storage.setItem(ICON_RECENT_STORAGE_KEY, JSON.stringify(recent)); } catch { /* UI preference only */ }
  }
  return recent;
}
