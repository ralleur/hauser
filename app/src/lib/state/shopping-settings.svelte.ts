import { hmiDataRequest } from './hmi-data.ts';
import {
  SHOPPING_CATEGORIES,
  categoryLabel,
  createStore,
  loadShoppingConfig,
  moveItem,
  saveShoppingConfig,
  type ShoppingStoreConfig,
  type StoreId,
} from './shopping-config.ts';
import type { ShoppingSection } from './shopping.ts';

export const shoppingConfig = $state(loadShoppingConfig());

export const shoppingSort = $state({
  active: false,
  loading: false,
  error: null as string | null,
  categoryByItem: {} as Record<string, string>,
});

function persist(stores: ShoppingStoreConfig[]): void {
  const saved = saveShoppingConfig({ version: 1, stores });
  shoppingConfig.stores = saved.stores;
}

export async function addShoppingStore(label: string): Promise<boolean> {
  const store = createStore(label, shoppingConfig.stores);
  if (!store) return false;
  await hmiDataRequest('/api/shopping/stores', 'POST', { id: store.id, label: store.label });
  persist([...shoppingConfig.stores, store]);
  return true;
}

export async function deleteShoppingStore(id: StoreId): Promise<void> {
  const store = shoppingConfig.stores.find((entry) => entry.id === id);
  if (!store) return;
  await hmiDataRequest(`/api/shopping/stores/${encodeURIComponent(id)}`, 'DELETE');
  persist(shoppingConfig.stores.filter((entry) => entry.id !== id));
}

export function moveShoppingStore(index: number, delta: -1 | 1): void {
  persist(moveItem(shoppingConfig.stores, index, index + delta));
}

export function moveShoppingCategory(storeId: StoreId, index: number, delta: -1 | 1): void {
  persist(shoppingConfig.stores.map((store) => store.id === storeId
    ? { ...store, categories: moveItem(store.categories, index, index + delta) }
    : store));
}

function parseClassification(raw: string, validItems: Set<string>): Record<string, string> {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(clean) as { items?: Array<{ id?: unknown; category?: unknown }> };
  const validCategories = new Set(SHOPPING_CATEGORIES.map((category) => category.id));
  const result: Record<string, string> = {};
  for (const entry of parsed.items ?? []) {
    if (typeof entry.id === 'string' && validItems.has(entry.id)
        && typeof entry.category === 'string' && validCategories.has(entry.category)) {
      result[entry.id] = entry.category;
    }
  }
  return result;
}

export async function sortShoppingList(sections: readonly ShoppingSection[]): Promise<void> {
  if (shoppingSort.loading) return;
  const items = sections.flatMap((section) => section.items
    .filter((item) => !item.checked && item.title.trim())
    .map((item) => ({ id: item.id, store: section.id, title: item.title })));
  if (!items.length) return;
  shoppingSort.loading = true;
  shoppingSort.error = null;
  try {
    const response = await fetch('/shopping-llm/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        stream: false,
        reasoning_effort: 'none',
        messages: [
          {
            role: 'system',
            content: `Ordne jeden Einkaufsartikel genau einer Kategorie zu. Antworte ausschließlich als JSON {"items":[{"id":"…","category":"…"}]}. Erlaubte Kategorien: ${SHOPPING_CATEGORIES.map((category) => `${category.id} (${categoryLabel(category.id)})`).join(', ')}.`,
          },
          { role: 'user', content: JSON.stringify(items) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Sortierung fehlgeschlagen (${response.status})`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Luna hat keine Sortierung geliefert.');
    const classified = parseClassification(content, new Set(items.map((item) => item.id)));
    if (!Object.keys(classified).length) throw new Error('Luna hat keine gültigen Kategorien geliefert.');
    shoppingSort.categoryByItem = classified;
    shoppingSort.active = true;
  } catch (error) {
    shoppingSort.error = error instanceof Error ? error.message : 'Einkaufsliste konnte nicht sortiert werden.';
  } finally {
    shoppingSort.loading = false;
  }
}

export function undoShoppingSort(): void {
  shoppingSort.active = false;
  shoppingSort.categoryByItem = {};
  shoppingSort.error = null;
}

export function shoppingItemOrder(sections: readonly ShoppingSection[]): ReadonlyMap<string, number> | undefined {
  if (!shoppingSort.active) return undefined;
  const ranks = new Map<string, number>();
  for (const section of sections) {
    const store = shoppingConfig.stores.find((entry) => entry.id === section.id);
    if (!store) continue;
    const categoryRank = new Map(store.categories.map((category, index) => [category, index]));
    section.items.forEach((item, sequence) => {
      const category = shoppingSort.categoryByItem[item.id];
      ranks.set(item.id, (categoryRank.get(category) ?? store.categories.length) * 10_000 + sequence);
    });
  }
  return ranks;
}
