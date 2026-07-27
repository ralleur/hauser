/* Einkaufsliste — pures Datenmodell und konfigurierbare Projektion. */

import { DEFAULT_SHOPPING_CONFIG, type ShoppingStoreConfig, type StoreId } from './shopping-config.ts';
export type { StoreId } from './shopping-config.ts';

export interface ShoppingItem {
  id: string;
  title: string;
  checked: boolean;
  checkedAt?: string | null;
}

export interface ShoppingSection {
  id: StoreId;
  title: string;
  items: ShoppingItem[];
}

export interface ShoppingFile {
  updated_at: string;
  source_name: string;
  sections: ShoppingSection[];
}

export function projectShoppingSections(
  sections: readonly ShoppingSection[],
  {
    keepEmpty = false,
    includeChecked = false,
    stores = DEFAULT_SHOPPING_CONFIG.stores,
    itemOrder,
  }: {
    keepEmpty?: boolean;
    includeChecked?: boolean;
    stores?: readonly ShoppingStoreConfig[];
    itemOrder?: ReadonlyMap<string, number>;
  } = {},
): ShoppingSection[] {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const projected = stores.map((store) => {
    const section = byId.get(store.id);
    return {
      id: store.id,
      title: store.label,
      items: (section?.items ?? [])
        .filter((item) => (includeChecked || !item.checked) && item.title.trim())
        .sort((a, b) => Number(a.checked) - Number(b.checked)
          || (itemOrder?.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (itemOrder?.get(b.id) ?? Number.MAX_SAFE_INTEGER)),
    };
  });
  return keepEmpty ? projected : projected.filter((section) => section.items.length > 0);
}

export function totalOpenItems(sections: readonly ShoppingSection[], stores = DEFAULT_SHOPPING_CONFIG.stores): number {
  return projectShoppingSections(sections, { stores }).reduce((sum, section) => sum + section.items.length, 0);
}

export const DONE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface ShoppingDoneEntry {
  id: string;
  store: StoreId;
  title: string;
  doneAt: number;
}

export function purgeDoneEntries(entries: readonly ShoppingDoneEntry[], now: number): ShoppingDoneEntry[] {
  return entries.filter((entry) => now - entry.doneAt < DONE_RETENTION_MS && entry.doneAt <= now);
}

export function projectPhoneShoppingSections(
  sections: readonly ShoppingSection[],
  _doneLog: readonly ShoppingDoneEntry[],
  now: number,
  stores = DEFAULT_SHOPPING_CONFIG.stores,
  itemOrder?: ReadonlyMap<string, number>,
): (ShoppingSection & { done: ShoppingItem[] })[] {
  return projectShoppingSections(sections, { keepEmpty: true, includeChecked: true, stores, itemOrder }).map((section) => {
    const visible = section.items.filter((item) => {
      if (!item.checked || !item.checkedAt) return true;
      const checkedAt = new Date(item.checkedAt).getTime();
      return Number.isFinite(checkedAt) && now - checkedAt < DONE_RETENTION_MS;
    });
    return {
      ...section,
      items: visible.filter((item) => !item.checked),
      done: visible.filter((item) => item.checked),
    };
  });
}
