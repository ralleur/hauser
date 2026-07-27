<script lang="ts">
  /* ── Inhalte · Einkaufsliste ──
     Läden und ihre individuelle Laufreihenfolge durch die Warengruppen.
     Rein lokale Sortierung, keine KI im Spiel. */
  import Icon from '../Icon.svelte';
  import { categoryLabel } from '../../state/shopping-config.ts';
  import {
    shoppingConfig, addShoppingStore, deleteShoppingStore, moveShoppingStore, moveShoppingCategory,
  } from '../../state/shopping-settings.svelte.ts';
  import { confirmThen, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  let shoppingDraft = $state('');
  let shoppingBusy = $state(false);
  let shoppingError = $state<string | null>(null);
  let expandedStore = $state<string | null>(shoppingConfig.stores[0]?.id ?? null);

  async function submitShoppingStore(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!shoppingDraft.trim() || shoppingBusy) return;
    shoppingBusy = true;
    shoppingError = null;
    try {
      const added = await addShoppingStore(shoppingDraft);
      if (added) {
        expandedStore = shoppingConfig.stores.at(-1)?.id ?? null;
        shoppingDraft = '';
      }
    } catch (error) {
      shoppingError = error instanceof Error ? error.message : m.sys_store_create_failed();
    } finally {
      shoppingBusy = false;
    }
  }

  async function removeShoppingStore(id: string): Promise<void> {
    if (shoppingBusy) return;
    shoppingBusy = true;
    shoppingError = null;
    try {
      await deleteShoppingStore(id);
      if (expandedStore === id) expandedStore = shoppingConfig.stores[0]?.id ?? null;
    } catch (error) {
      shoppingError = error instanceof Error ? error.message : m.sys_store_delete_failed();
    } finally {
      shoppingBusy = false;
    }
  }
</script>

<h3 class="caps-label settings-group-label">{m.sys_stores()}</h3>
<div class="settings-group" data-setting-id="shopping-stores">
  {#each shoppingConfig.stores as store, index (store.id)}
    <div class="settings-row shopping-store-row">
      <button class="shopping-expand pressable" type="button"
              aria-expanded={expandedStore === store.id}
              onclick={() => (expandedStore = expandedStore === store.id ? null : store.id)}>
        <Icon name={expandedStore === store.id ? 'i-chevron-down' : 'i-chevron-right'} cls="icon icon-sm" />
        <span>{store.label}</span>
      </button>
      <div class="shopping-order-actions" aria-label="Reihenfolge von {store.label}">
        <button class="secondary-btn pressable" type="button" disabled={index === 0}
                aria-label="{store.label} nach oben" onclick={() => moveShoppingStore(index, -1)}>↑</button>
        <button class="secondary-btn pressable" type="button" disabled={index === shoppingConfig.stores.length - 1}
                aria-label="{store.label} nach unten" onclick={() => moveShoppingStore(index, 1)}>↓</button>
        <button class="secondary-btn danger-btn pressable" type="button" disabled={shoppingBusy}
                onclick={() => confirmThen(`shopping-delete-${store.id}`, () => void removeShoppingStore(store.id))}>
          {isConfirming(`shopping-delete-${store.id}`) ? m.sys_delete_confirm() : m.sys_delete()}
        </button>
      </div>
    </div>
    {#if expandedStore === store.id}
      <div class="shopping-category-list" data-setting-id="shopping-categories">
        {#each store.categories as category, categoryIndex (category)}
          <div class="shopping-category-row">
            <span>{categoryLabel(category)}</span>
            <div class="shopping-order-actions">
              <button class="secondary-btn pressable" type="button" disabled={categoryIndex === 0}
                      aria-label="{categoryLabel(category)} nach oben"
                      onclick={() => moveShoppingCategory(store.id, categoryIndex, -1)}>↑</button>
              <button class="secondary-btn pressable" type="button" disabled={categoryIndex === store.categories.length - 1}
                      aria-label="{categoryLabel(category)} nach unten"
                      onclick={() => moveShoppingCategory(store.id, categoryIndex, 1)}>↓</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="settings-row"><span class="settings-row-sub">{m.sys_no_store()}</span></div>
  {/each}
  <form class="settings-row shopping-add-row" onsubmit={submitShoppingStore}>
    <input class="settings-input" type="text" maxlength="60" placeholder={m.sys_add_store()}
           aria-label={m.sys_new_store_name()} bind:value={shoppingDraft} disabled={shoppingBusy} />
    <button class="secondary-btn pressable" type="submit" disabled={shoppingBusy || !shoppingDraft.trim()}>{m.sys_create()}</button>
  </form>
</div>
{#if shoppingError}<p class="settings-form-msg is-error" role="alert">{shoppingError}</p>{/if}
<p class="settings-note">{m.sys_store_note()}</p>
