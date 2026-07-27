import { sharedStorage } from './shared-config.ts';

export type StoreId = string;

export interface ShoppingCategory {
  id: string;
  label: string;
}

export interface ShoppingStoreConfig {
  id: StoreId;
  label: string;
  categories: string[];
}

export interface ShoppingConfig {
  version: 1;
  stores: ShoppingStoreConfig[];
}

export const SHOPPING_CONFIG_KEY = 'hmi:shopping-config:v1';

export const SHOPPING_CATEGORIES: readonly ShoppingCategory[] = [
  { id: 'frische', label: '🥦 Frische' },
  { id: 'fleisch-fisch', label: '🥩 Fleisch & Fisch' },
  { id: 'kuehlung', label: '🥛 Kühlung' },
  { id: 'tiefkuehlung', label: '❄️ Tiefkühlung' },
  { id: 'backwaren', label: '🍞 Backwaren' },
  { id: 'vorratsschrank', label: '🍝 Vorratsschrank' },
  { id: 'kochen-wuerzen', label: '🌶️ Kochen & Würzen' },
  { id: 'snacks-suesses', label: '🍫 Snacks & Süßes' },
  { id: 'fruehstueck', label: '🥣 Frühstück' },
  { id: 'getraenke', label: '🥤 Getränke' },
  { id: 'drogerie', label: '🧴 Drogerie' },
  { id: 'haushalt', label: '🧹 Haushalt' },
  { id: 'haustiere', label: '🐶 Haustiere' },
  { id: 'baby', label: '👶 Baby' },
  { id: 'saison-angebote', label: '🎉 Saison & Angebote' },
] as const;

export const DEFAULT_CATEGORY_ORDER = SHOPPING_CATEGORIES.map((category) => category.id);

export const DEFAULT_SHOPPING_CONFIG: ShoppingConfig = {
  version: 1,
  stores: ['aldi', 'rewe', 'dm'].map((id) => ({
    id,
    label: id === 'dm' ? 'dm' : `${id[0].toUpperCase()}${id.slice(1)}`,
    categories: [...DEFAULT_CATEGORY_ORDER],
  })),
};

function slugify(label: string): string {
  return label.trim().toLocaleLowerCase('de-DE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalize(raw: unknown): ShoppingConfig {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as ShoppingConfig).stores)) {
    return structuredClone(DEFAULT_SHOPPING_CONFIG);
  }
  const validCategories = new Set(DEFAULT_CATEGORY_ORDER);
  const seen = new Set<string>();
  const stores = (raw as ShoppingConfig).stores.flatMap((store) => {
    if (!store || typeof store.label !== 'string') return [];
    const label = store.label.trim().slice(0, 60);
    const id = typeof store.id === 'string' ? slugify(store.id) : slugify(label);
    if (!id || !label || seen.has(id)) return [];
    seen.add(id);
    const supplied = Array.isArray(store.categories)
      ? store.categories.filter((id): id is string => typeof id === 'string' && validCategories.has(id))
      : [];
    const categories = [...new Set([...supplied, ...DEFAULT_CATEGORY_ORDER])];
    return [{ id, label, categories }];
  });
  return { version: 1, stores };
}

export function loadShoppingConfig(): ShoppingConfig {
  try { return normalize(JSON.parse(sharedStorage.getItem(SHOPPING_CONFIG_KEY) ?? 'null')); }
  catch { return structuredClone(DEFAULT_SHOPPING_CONFIG); }
}

export function saveShoppingConfig(config: ShoppingConfig): ShoppingConfig {
  const normalized = normalize(config);
  sharedStorage.setItem(SHOPPING_CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createStore(label: string, existing: readonly ShoppingStoreConfig[]): ShoppingStoreConfig | null {
  const clean = label.trim().slice(0, 60);
  const base = slugify(clean);
  if (!clean || !base) return null;
  let id = base;
  let suffix = 2;
  const ids = new Set(existing.map((store) => store.id));
  while (ids.has(id)) id = `${base}-${suffix++}`;
  return { id, label: clean, categories: [...DEFAULT_CATEGORY_ORDER] };
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function categoryLabel(id: string): string {
  return SHOPPING_CATEGORIES.find((category) => category.id === id)?.label ?? id;
}
