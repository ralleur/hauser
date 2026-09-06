import { addItem, fetchSections, setItemChecked } from './shopping-lists.ts';
import { purgeDoneEntries, type ShoppingDoneEntry, type ShoppingItem, type ShoppingSection, type StoreId } from './shopping.ts';
import { shoppingConfig } from './shopping-settings.svelte.ts';
import type { ShoppingStoreConfig } from './shopping-config.ts';
import { createSnapshotStore } from '../data/query-cache.ts';
import { registerRevalidation } from '../data/revalidation.ts';

/* Die Quelle der Läden steht in der Konfiguration: Home-Assistant-Listen oder
   die gemeinsame Notion-Seite (shopping-lists.ts). Der lokale Cache sorgt nur
   für einen schnellen Start. */

const CACHE_KEY = 'hmi:shopping-cache';
const DONE_KEY = 'hmi:shopping-done-log.v1';
const REFRESH_MS = 5 * 60 * 1000;
const DONE_PURGE_MS = 60 * 1000;

interface ShoppingSnapshot {
  sections: ShoppingSection[];
}

function isShoppingSnapshot(value: unknown): value is ShoppingSnapshot {
  return Array.isArray((value as Partial<ShoppingSnapshot> | null)?.sections);
}

const snapshot = createSnapshotStore<ShoppingSnapshot>({
  key: CACHE_KEY,
  maxAgeMs: REFRESH_MS,
  validate: isShoppingSnapshot,
  migrateLegacy: (raw) => {
    const legacy = raw as (ShoppingSnapshot & { updatedAt?: number }) | null;
    return isShoppingSnapshot(legacy) && Number.isFinite(legacy.updatedAt)
      ? { v: 1, updatedAt: legacy.updatedAt as number, value: { sections: legacy.sections } }
      : null;
  },
});

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
  registerRevalidation({ name: 'shopping', isStale: () => snapshot.isStale(), revalidate: refreshShopping });
}

export async function refreshShopping(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/* Neues Item in die Liste des Ladens schreiben. */
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
    await addItem(shoppingConfig.provider, storeConfig(store), title);
    scheduleReconcile();
  } catch (error) {
    pendingAdds.delete(id);
    shopping.sections = shopping.sections.map((entry) => ({
      ...entry, items: entry.items.filter((item) => item.id !== id),
    }));
    throw error;
  }
}

/* Double-Tap schaltet sofort lokal um; bei einem Fehler wird zurückgerollt. */
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
    await setItemChecked(shoppingConfig.provider, storeConfig(store), item.id, checked);
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

function storeConfig(store: StoreId): ShoppingStoreConfig {
  return shoppingConfig.stores.find((entry) => entry.id === store)
    ?? { id: store, label: store, categories: [], entityId: null };
}

async function refresh(): Promise<void> {
  shopping.loading = true;
  try {
    const sections = await fetchSections(shoppingConfig.provider, shoppingConfig.stores);
    shopping.sections = mergePendingAdds(withCheckedAt(sections));
    shopping.updatedAt = Date.now();
    shopping.error = null;
    saveCache();
  } catch (error) {
    shopping.error = error instanceof Error ? error.message : 'Einkaufsliste konnte nicht geladen werden.';
  } finally {
    shopping.loading = false;
  }
}

/* HA-Listen kennen keinen Erledigt-Zeitpunkt, die Telefonansicht blendet
   Erledigte aber nach 24 h aus (shopping.ts). Bekannte Zeitpunkte bleiben
   deshalb erhalten, neu erledigte Einträge bekommen den aktuellen. */
function withCheckedAt(sections: ShoppingSection[]): ShoppingSection[] {
  const known = new Map(shopping.sections.flatMap((section) => section.items
    .map((item) => [item.id, item.checkedAt ?? null] as const)));
  const now = new Date().toISOString();
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      checkedAt: item.checked ? known.get(item.id) ?? now : null,
    })),
  }));
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
          void setItemChecked(shoppingConfig.provider, storeConfig(pending.store), remote.id, true)
            .then(scheduleReconcile);
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
  const restored = snapshot.restoreSync();
  if (!restored) return;
  shopping.sections = restored.value.sections;
  shopping.updatedAt = restored.updatedAt;
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
  void snapshot.save({ sections: shopping.sections }, shopping.updatedAt);
}
