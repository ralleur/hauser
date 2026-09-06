import { m } from '../../paraglide/messages.js';
import { apiRequest } from '../api/client.ts';
import { sharedStorage } from './shared-config.ts';
import { loadAvailableReminderLists } from './reminders.svelte.ts';
import {
  SHOPPING_CATEGORIES,
  categoryLabel,
  createStore,
  loadShoppingConfig,
  moveItem,
  saveShoppingConfig,
  type ShoppingProvider,
  type ShoppingStoreConfig,
  type StoreId,
} from './shopping-config.ts';
import type { ShoppingSection } from './shopping.ts';

export const shoppingConfig = $state(loadShoppingConfig());

export function rehydrateShoppingConfig(): void {
  const loaded = loadShoppingConfig();
  shoppingConfig.version = loaded.version;
  shoppingConfig.provider = loaded.provider;
  shoppingConfig.stores = loaded.stores;
}

/* Zugang zur Notion-Seite: Token und Seiten-Adresse liegen in der geteilten
   Konfiguration, gelesen und geschrieben wird ausschließlich vom Server. */
const NOTION_TOKEN_KEY = 'hmi:notion-token';
const NOTION_PAGE_KEY = 'hmi:notion-page';

export const notionAccess = $state({
  token: sharedStorage.getItem(NOTION_TOKEN_KEY) ?? '',
  page: sharedStorage.getItem(NOTION_PAGE_KEY) ?? '',
});

export function saveNotionAccess(token: string, page: string): void {
  notionAccess.token = token.trim();
  notionAccess.page = page.trim();
  if (notionAccess.token) sharedStorage.setItem(NOTION_TOKEN_KEY, notionAccess.token);
  else sharedStorage.removeItem(NOTION_TOKEN_KEY);
  if (notionAccess.page) sharedStorage.setItem(NOTION_PAGE_KEY, notionAccess.page);
  else sharedStorage.removeItem(NOTION_PAGE_KEY);
}

export function setShoppingProvider(provider: ShoppingProvider): void {
  shoppingConfig.provider = provider;
  persist(shoppingConfig.stores);
}

/* Legt in Home Assistant eine „Local To-do"-Liste an. Geht nur im App-Modus,
   in dem der Server den internen Zugang hat — sonst legt man sie in Home
   Assistant selbst an und wählt sie hier aus. */
export async function createShoppingList(name: string): Promise<void> {
  const result = await apiRequest('shoppingHaList', { method: 'POST', body: { name } });
  if (!result.ok) {
    const payload = result.data as { message?: string; error?: string } | null;
    throw new Error(payload?.message || payload?.error || result.error);
  }
  await loadAvailableReminderLists();
}

export const shoppingSort = $state({
  active: false,
  loading: false,
  error: null as string | null,
  categoryByItem: {} as Record<string, string>,
});

function persist(stores: ShoppingStoreConfig[]): void {
  const saved = saveShoppingConfig({ version: 1, provider: shoppingConfig.provider, stores });
  shoppingConfig.provider = saved.provider;
  shoppingConfig.stores = saved.stores;
}

/* Läden sind eine reine HMI-Ansicht auf HA-Listen: Anlegen und Löschen
   verändert nur die Zuordnung, nie die `todo.*`-Entität selbst. */
export function addShoppingStore(label: string, entityId: string | null = null): boolean {
  const store = createStore(label, shoppingConfig.stores, entityId);
  if (!store) return false;
  persist([...shoppingConfig.stores, store]);
  return true;
}

export function deleteShoppingStore(id: StoreId): void {
  persist(shoppingConfig.stores.filter((entry) => entry.id !== id));
}

export function setShoppingStoreEntity(id: StoreId, entityId: string | null): void {
  persist(shoppingConfig.stores.map((store) => store.id === id ? { ...store, entityId } : store));
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
            content: `Ordne jeden Einkaufsartikel genau einer Kategorie zu. Antworte ausschließlich als JSON {"items":[{"id":"…","category":"…"}]}. Erlaubte Kategorien: ${SHOPPING_CATEGORIES.map((category) => `${category.id} (${categoryLabel(category.id)})`).join(', ')}.`, // i18n-ignore: Systemprompt an das Modell, keine Anzeige
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
    if (!Object.keys(classified).length) throw new Error(m.shop_ai_invalid_categories());
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
