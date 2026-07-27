import { hmiDataRequest } from './hmi-data.ts';
import { purgeDoneEntries, type ShoppingDoneEntry, type ShoppingFile, type ShoppingItem, type ShoppingSection, type StoreId } from './shopping.ts';
import { shoppingConfig } from './shopping-settings.svelte.ts';

/* Zentrale HMI-Einkaufsliste mit lokalem Cache für einen schnellen Start. */

const CACHE_KEY = 'hmi:shopping-cache';
const DONE_KEY = 'hmi:shopping-done-log.v1';
const REFRESH_MS = 5 * 60 * 1000;
const DONE_PURGE_MS = 60 * 1000;

export const shopping = $state({
  sections: [] as ShoppingSection[],
  updatedAt: 0,
  loading: false,
  error: null as string | null,
  initialized: false,
  /* Per Swipe erledigte Einträge: bleiben eine Stunde sichtbar (shopping.ts). */
  doneLog: [] as ShoppingDoneEntry[],
});

let refreshPromise: Promise<void> | null = null;
let optimisticSequence = 0;
const pendingAdds = new Map<string, { store: StoreId; title: string; expectedCount: number; checked: boolean }>();
const pendingToggles = new Map<string, boolean>();

export function initShopping(): void {
  if (shopping.initialized) return;
  shopping.initialized = true;
  restoreCache();
  restoreDoneLog();
  void refreshShopping();
  setInterval(() => void refreshShopping(), REFRESH_MS);
  setInterval(purgeDoneLog, DONE_PURGE_MS);
}

export async function refreshShopping(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/* Neues Item zentral speichern und optimistisch anzeigen. */
export async function addShoppingItem(store: StoreId, title: string): Promise<void> {
  const id = `optimistic-shopping-${Date.now()}-${optimisticSequence++}`;
  const expectedCount = (shopping.sections.find((section) => section.id === store)?.items
    .filter((item) => item.title === title).length ?? 0) + 1;
  pendingAdds.set(id, { store, title, expectedCount, checked: false });
  const section = shopping.sections.find((entry) => entry.id === store);
  shopping.sections = section
    ? shopping.sections.map((entry) => entry.id === store
      ? { ...entry, items: [...entry.items, { id, title, checked: false }] }
      : entry)
    : [...shopping.sections, {
      id: store,
      title: shoppingConfig.stores.find((entry) => entry.id === store)?.label ?? store,
      items: [{ id, title, checked: false }],
    }];
  try {
    await hmiDataRequest('/api/shopping/items', 'POST', { store, title });
    scheduleReconcile();
  } catch (error) {
    pendingAdds.delete(id);
    shopping.sections = shopping.sections.map((entry) => ({
      ...entry, items: entry.items.filter((item) => item.id !== id),
    }));
    throw error;
  }
}

/* Double-Tap schaltet sofort lokal um; bei Backend-Fehler wird zurückgerollt. */
export async function toggleShoppingItem(store: StoreId, item: ShoppingItem): Promise<void> {
  const checked = !item.checked;
  const checkedAt = checked ? new Date().toISOString() : null;
  shopping.sections = updateItem(item.id, (current) => ({ ...current, checked, checkedAt }));

  const pendingAdd = pendingAdds.get(item.id);
  if (pendingAdd) {
    pendingAdd.checked = checked;
    return;
  }

  pendingToggles.set(item.id, checked);
  try {
    await hmiDataRequest(`/api/shopping/items/${encodeURIComponent(item.id)}`, 'PATCH', { checked });
    scheduleReconcile();
  } catch (error) {
    pendingToggles.delete(item.id);
    shopping.sections = updateItem(item.id, (current) => ({
      ...current, checked: item.checked, checkedAt: item.checkedAt ?? null,
    }));
    throw error;
  }
}

export function purgeDoneLog(): void {
  const purged = purgeDoneEntries(shopping.doneLog, Date.now());
  if (purged.length === shopping.doneLog.length) return;
  shopping.doneLog = purged;
  saveDoneLog();
}

async function refresh(): Promise<void> {
  shopping.loading = true;
  try {
    const resp = await fetch('/api/shopping', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json() as ShoppingFile;
    shopping.sections = mergePendingAdds(data.sections ?? []);
    shopping.updatedAt = Date.now();
    shopping.error = null;
    saveCache();
  } catch (error) {
    shopping.error = error instanceof Error ? error.message : 'Einkaufsliste konnte nicht geladen werden.';
  } finally {
    shopping.loading = false;
  }
}

function mergePendingAdds(sections: ShoppingSection[]): ShoppingSection[] {
  let merged = sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const desired = pendingToggles.get(item.id);
      if (desired === undefined) return item;
      if (item.checked === desired) {
        pendingToggles.delete(item.id);
        return item;
      }
      return { ...item, checked: desired, checkedAt: desired ? new Date().toISOString() : null };
    }),
  }));
  for (const [id, pending] of pendingAdds) {
    const remoteMatches = merged.find((section) => section.id === pending.store)?.items
      .filter((item) => item.title === pending.title) ?? [];
    if (remoteMatches.length >= pending.expectedCount) {
      pendingAdds.delete(id);
      if (pending.checked) {
        const remote = remoteMatches.at(-1);
        if (remote && !remote.checked) {
          merged = merged.map((section) => ({
            ...section,
            items: section.items.map((item) => item.id === remote.id
              ? { ...item, checked: true, checkedAt: new Date().toISOString() }
              : item),
          }));
          pendingToggles.set(remote.id, true);
          void hmiDataRequest(`/api/shopping/items/${encodeURIComponent(remote.id)}`, 'PATCH', { checked: true }).then(scheduleReconcile);
        }
      }
      continue;
    }
    const optimistic = {
      id, title: pending.title, checked: pending.checked,
      checkedAt: pending.checked ? new Date().toISOString() : null,
    };
    const section = merged.find((entry) => entry.id === pending.store);
    merged = section
      ? merged.map((entry) => entry.id === pending.store
        ? { ...entry, items: [...entry.items, optimistic] }
        : entry)
      : [...merged, {
        id: pending.store,
        title: shoppingConfig.stores.find((entry) => entry.id === pending.store)?.label ?? pending.store,
        items: [optimistic],
      }];
  }
  return merged;
}

function updateItem(id: string, update: (item: ShoppingItem) => ShoppingItem): ShoppingSection[] {
  return shopping.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => item.id === id ? update(item) : item),
  }));
}

function scheduleReconcile(): void {
  setTimeout(() => void refreshShopping(), 500);
  setTimeout(() => void refreshShopping(), 2_000);
}

function restoreCache(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as
      { sections: ShoppingSection[]; updatedAt: number } | null;
    if (!Array.isArray(parsed?.sections) || !Number.isFinite(parsed.updatedAt)) return;
    shopping.sections = parsed.sections;
    shopping.updatedAt = parsed.updatedAt;
  } catch { /* Cache ist best-effort. */ }
}

function restoreDoneLog(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(DONE_KEY) ?? 'null') as ShoppingDoneEntry[] | null;
    if (!Array.isArray(parsed)) return;
    shopping.doneLog = purgeDoneEntries(
      parsed.filter((entry) => entry && typeof entry.id === 'string' && Number.isFinite(entry.doneAt)),
      Date.now(),
    );
  } catch { /* Log ist best-effort. */ }
}

function saveDoneLog(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(shopping.doneLog));
  } catch { /* Storage blockiert/voll: Log gilt für die Sitzung. */ }
}

function saveCache(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      sections: shopping.sections,
      updatedAt: shopping.updatedAt,
    }));
  } catch { /* Storage blockiert/voll: Live-Daten funktionieren weiter. */ }
}
