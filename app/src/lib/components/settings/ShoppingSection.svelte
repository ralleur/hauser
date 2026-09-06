<script lang="ts">
  /* ── Inhalte · Einkaufsliste ──
     Läden und ihre individuelle Laufreihenfolge durch die Warengruppen.
     Rein lokale Sortierung, keine KI im Spiel. */
  import Icon from '../Icon.svelte';
  import { categoryLabel } from '../../state/shopping-config.ts';
  import {
    shoppingConfig, addShoppingStore, deleteShoppingStore, moveShoppingStore, moveShoppingCategory,
    setShoppingStoreEntity, setShoppingProvider, createShoppingList, saveNotionAccess, notionAccess,
  } from '../../state/shopping-settings.svelte.ts';
  import { availableReminderLists, loadAvailableReminderLists } from '../../state/reminders.svelte.ts';
  import { refreshShopping } from '../../state/shopping.svelte.ts';
  import { confirmThen, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import SettingsCardHead from './SettingsCardHead.svelte';

  let shoppingDraft = $state('');
  let shoppingError = $state<string | null>(null);
  let expandedStore = $state<string | null>(shoppingConfig.stores[0]?.id ?? null);

  /* Die auswählbaren Listen sind dieselben `todo.*`-Entitäten wie bei den
     Erinnerungen — beim Öffnen der Sektion einmal frisch laden. */
  $effect(() => { void loadAvailableReminderLists(); });

  let creatingStore = $state<string | null>(null);
  let notionToken = $state(notionAccess.token);
  let notionPage = $state(notionAccess.page);
  let notionSaved = $state(false);

  function selectStoreList(id: string, entityId: string): void {
    setShoppingStoreEntity(id, entityId || null);
    void refreshShopping();
  }

  /* Wer noch keine Liste hat, soll dafür nicht nach Home Assistant wechseln
     müssen: der Server legt sie an und der Laden zeigt danach darauf. */
  async function createListFor(id: string, label: string): Promise<void> {
    creatingStore = id;
    shoppingError = null;
    try {
      await createShoppingList(label);
      const created = availableReminderLists.sources.find((source) => source.name === label);
      if (created) selectStoreList(id, created.entityId);
    } catch (error) {
      shoppingError = error instanceof Error ? error.message : m.sys_store_create_failed();
    } finally {
      creatingStore = null;
    }
  }

  function submitNotionAccess(event: SubmitEvent): void {
    event.preventDefault();
    saveNotionAccess(notionToken, notionPage);
    notionSaved = true;
    void refreshShopping();
  }

  function submitShoppingStore(event: SubmitEvent): void {
    event.preventDefault();
    if (!shoppingDraft.trim()) return;
    shoppingError = addShoppingStore(shoppingDraft) ? null : m.sys_store_create_failed();
    if (shoppingError) return;
    expandedStore = shoppingConfig.stores.at(-1)?.id ?? null;
    shoppingDraft = '';
  }

  function removeShoppingStore(id: string): void {
    deleteShoppingStore(id);
    if (expandedStore === id) expandedStore = shoppingConfig.stores[0]?.id ?? null;
    void refreshShopping();
  }
</script>

<div class="settings-group" data-setting-id="shopping-source">
  <SettingsCardHead icon="i-cart" tint="success" title={m.sys_shopping_source()} />
  <label class="settings-row">
    <span class="settings-row-text"><span class="settings-row-label">{m.sys_shopping_source()}</span></span>
    <select class="settings-input" value={shoppingConfig.provider}
            aria-label={m.sys_shopping_source()}
            onchange={(event) => {
              setShoppingProvider(event.currentTarget.value === 'notion' ? 'notion' : 'ha');
              void refreshShopping();
            }}>
      <option value="ha">{m.sys_shopping_source_ha()}</option>
      <option value="notion">{m.sys_shopping_source_notion()}</option>
    </select>
  </label>
  {#if shoppingConfig.provider === 'notion'}
    <form class="settings-row shopping-notion-form" onsubmit={submitNotionAccess}>
      <input class="settings-input" type="password" autocomplete="off" placeholder={m.sys_notion_token()}
             aria-label={m.sys_notion_token()} bind:value={notionToken} oninput={() => (notionSaved = false)} />
      <input class="settings-input" type="text" inputmode="url" autocapitalize="off" spellcheck="false"
             placeholder={m.sys_notion_page()}
             aria-label={m.sys_notion_page()} bind:value={notionPage} oninput={() => (notionSaved = false)} />
      <button class="secondary-btn pressable" type="submit"
              disabled={!notionToken.trim() || !notionPage.trim()}>{m.sys_apply()}</button>
    </form>
    {#if notionSaved}<p class="settings-form-msg" role="status">{m.sys_notion_saved()}</p>{/if}
    <p class="settings-note">{m.sys_notion_hint()}</p>
  {/if}
</div>

<div class="settings-group" data-setting-id="shopping-stores">
  <SettingsCardHead icon="i-cart" tint="success" title={m.sys_stores()} />
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
        <button class="secondary-btn danger-btn pressable" type="button"
                onclick={() => confirmThen(`shopping-delete-${store.id}`, () => removeShoppingStore(store.id))}>
          {isConfirming(`shopping-delete-${store.id}`) ? m.sys_delete_confirm() : m.sys_delete()}
        </button>
      </div>
    </div>
    {#if expandedStore === store.id}
      {#if shoppingConfig.provider === 'ha'}
        <div class="settings-row shopping-list-row">
          <span class="settings-row-text">
            <span class="settings-row-label">{m.sys_store_list()}</span>
            <span class="settings-row-sub">
              {availableReminderLists.sources.length ? (store.entityId ?? m.sys_store_list_none()) : m.sys_store_list_missing()}
            </span>
          </span>
          <select class="settings-input" value={store.entityId ?? ''}
                  aria-label="{m.sys_store_list()}: {store.label}"
                  onchange={(event) => selectStoreList(store.id, event.currentTarget.value)}>
            <option value="">{m.sys_store_list_none()}</option>
            {#each availableReminderLists.sources as source (source.entityId)}
              <option value={source.entityId}>{source.name}</option>
            {/each}
          </select>
          {#if !store.entityId}
            <button class="secondary-btn pressable" type="button" disabled={creatingStore === store.id}
                    onclick={() => createListFor(store.id, store.label)}>{m.sys_store_list_create()}</button>
          {/if}
        </div>
      {/if}
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
           aria-label={m.sys_new_store_name()} bind:value={shoppingDraft} />
    <button class="secondary-btn pressable" type="submit" disabled={!shoppingDraft.trim()}>{m.sys_create()}</button>
  </form>
</div>
{#if shoppingError}<p class="settings-form-msg is-error" role="alert">{shoppingError}</p>{/if}
<p class="settings-note">{m.sys_store_note()}</p>
