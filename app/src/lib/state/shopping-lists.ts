/* ============================================
   Woher die Einkaufsliste kommt (Einstellungen → Inhalte → Einkaufsliste):

   `ha`     — Standard. Jeder Laden ist eine `todo.*`-Entität (z. B. aus der
              Integration „Local To-do"). Damit liegt die Liste zentral beim
              Haus-Server und ist auch in der HA-App und per Sprachassistent
              bedienbar. Gelesen wird über denselben WS-Befehl wie die
              Erinnerungen, geschrieben über `todo.add_item`/`todo.update_item`.
   `notion` — Eine gemeinsame Notion-Seite: Läden sind Überschriften, Artikel
              `to_do`-Blöcke. Die Notion-API verträgt keinen Browseraufruf, der
              Hauser-Server übernimmt Lesen und Schreiben
              (`server/shopping-notion.mjs`).
   ============================================ */

import { m } from '../../paraglide/messages.js';
import { runtime } from '../adapter/runtime.svelte.ts';
import { apiRequest, type ApiResult } from '../api/client.ts';
import type { ShoppingProvider, ShoppingStoreConfig } from './shopping-config.ts';
import type { ShoppingSection } from './shopping.ts';

export class ShoppingListError extends Error {}

function failed(result: Extract<ApiResult<unknown>, { ok: false }>): ShoppingListError {
  const message = (result.data as { error?: string; message?: string } | null)?.error;
  return new ShoppingListError(message || result.error || 'Die Einkaufsliste hat nicht geantwortet.');
}

export async function fetchSections(
  provider: ShoppingProvider,
  stores: readonly ShoppingStoreConfig[],
): Promise<ShoppingSection[]> {
  if (provider === 'notion') {
    const result = await apiRequest('shoppingNotion', { cache: 'no-cache' });
    if (!result.ok) throw failed(result);
    return (result.data?.sections ?? []) as ShoppingSection[];
  }
  return Promise.all(stores
    .filter((store) => store.entityId)
    .map(async (store) => ({
      id: store.id,
      title: store.label,
      items: (await runtime.getReminders(store.entityId as string))
        .map((item) => ({ id: item.id, title: item.title, checked: item.completed })),
    })));
}

export async function addItem(
  provider: ShoppingProvider,
  store: ShoppingStoreConfig,
  title: string,
): Promise<void> {
  if (provider === 'notion') {
    const result = await apiRequest('shoppingNotionItems', { method: 'POST', body: { store: store.id, title } });
    if (!result.ok) throw failed(result);
    return;
  }
  try {
    await runtime.addTodoItem(requireEntity(store), title);
  } catch (error) {
    throw new ShoppingListError(error instanceof Error ? error.message : 'Eintrag konnte nicht gespeichert werden.');
  }
}

export async function setItemChecked(
  provider: ShoppingProvider,
  store: ShoppingStoreConfig,
  id: string,
  checked: boolean,
): Promise<void> {
  if (provider === 'notion') {
    const result = await apiRequest('shoppingNotionItemUpdate', {
      method: 'PATCH', params: { id }, body: { checked },
    });
    if (!result.ok) throw failed(result);
    return;
  }
  try {
    await runtime.setTodoItemStatus(requireEntity(store), id, checked);
  } catch (error) {
    throw new ShoppingListError(error instanceof Error ? error.message : m.shop_item_change_error());
  }
}

function requireEntity(store: ShoppingStoreConfig): string {
  if (!store.entityId) throw new ShoppingListError(`Dem Laden „${store.label}" ist keine Liste zugeordnet.`);
  return store.entityId;
}
