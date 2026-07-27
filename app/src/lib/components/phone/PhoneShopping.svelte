<script lang="ts">
  import Icon from '../Icon.svelte';
  import { doubletap } from '../../actions/doubletap.ts';
  import {
    shopping, refreshShopping, addShoppingItem, toggleShoppingItem,
  } from '../../state/shopping.svelte.ts';
  import { projectPhoneShoppingSections, type ShoppingItem, type StoreId } from '../../state/shopping.ts';
  import { m } from '../../../paraglide/messages.js';
  import {
    shoppingConfig, shoppingSort, shoppingItemOrder, sortShoppingList, undoShoppingSort,
  } from '../../state/shopping-settings.svelte.ts';

  let { titleAnchor = $bindable() }: { titleAnchor?: HTMLHeadingElement } = $props();

  /* Minuten-Ticker, damit Erledigt-Einträge nach ihrem Tag auch ohne
     Refresh aus der Ansicht fallen. */
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => { now = Date.now(); }, 60 * 1000);
    return () => clearInterval(timer);
  });

  let toggleError = $state<string | null>(null);
  const sections = $derived(projectPhoneShoppingSections(
    shopping.sections, shopping.doneLog, now, shoppingConfig.stores, shoppingItemOrder(shopping.sections),
  ));

  const updatedLabel = $derived(shopping.updatedAt
    ? `Stand ${new Date(shopping.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    : m.notes_not_loaded());

  function toggle(store: StoreId, item: ShoppingItem) {
    toggleError = null;
    void toggleShoppingItem(store, item).then(() => { now = Date.now(); }).catch((error) => {
      toggleError = error instanceof Error ? error.message : m.notes_refresh_error();
    });
  }

  /* Add-Flow wie auf der Tablet-Notizen-Seite: pro Laden ein +. */
  let addTarget = $state<StoreId | null>(null);
  let draft = $state('');
  let busy = $state(false);
  let addError = $state<string | null>(null);

  function toggleAdd(target: StoreId) {
    addTarget = addTarget === target ? null : target;
    draft = '';
    addError = null;
  }

  function focusOnMount(el: HTMLInputElement) {
    el.focus();
  }

  function submitAdd(e: SubmitEvent) {
    e.preventDefault();
    const title = draft.trim();
    const target = addTarget;
    if (!title || !target) return;
    addTarget = null;
    draft = '';
    addError = null;
    void addShoppingItem(target, title).catch((error) => {
      addError = error instanceof Error ? error.message : m.notes_save_error();
    });
  }
</script>

<main class="phone-notes-page" aria-labelledby="phone-target-title">
  <header class="phone-notes-head">
    <h1 bind:this={titleAnchor} id="phone-target-title" tabindex="-1">{m.notes_shopping()}</h1>
    <div class="notes-head-meta">
      <span class="notes-updated">{updatedLabel}</span>
      <button class="secondary-btn pressable" type="button" disabled={shoppingSort.loading}
              aria-label={shoppingSort.active ? m.shopping_undo_label() : m.shopping_sort_label()}
              onclick={() => shoppingSort.active ? undoShoppingSort() : sortShoppingList(shopping.sections)}>
        {shoppingSort.loading ? 'Sortiert …' : shoppingSort.active ? m.notes_undo() : m.shopping_sort()}
      </button>
      <button class="notes-refresh pressable" type="button" aria-label={m.notes_shopping_refresh()}
              disabled={shopping.loading} onclick={() => refreshShopping()}>
        <Icon name="i-refresh" cls="icon icon-md" />
      </button>
    </div>
  </header>

  {#if toggleError}<p class="notes-add-error" role="alert">{toggleError}</p>{/if}
  {#if shoppingSort.error}<p class="notes-add-error" role="alert">{shoppingSort.error}</p>{/if}
  {#if addError}<p class="notes-add-error" role="alert">{addError}</p>{/if}

  {#each sections as section (section.id)}
    <section class="shop-section">
      <header class="notes-section-head">
        <h3 class="notes-section-title">{section.title}</h3>
        <span class="notes-section-count num">{section.items.length || ''}</span>
        <button class="notes-add-btn pressable" type="button"
                aria-label="Eintrag bei {section.title} hinzufügen"
                onclick={() => toggleAdd(section.id)}>
          <Icon name="i-plus" cls="icon icon-md" />
        </button>
      </header>
      <ul class="shop-items">
        {#each section.items as item (item.id)}
          <li class="shop-item phone-shop-item">
            <button class="shop-toggle" type="button" aria-pressed="false"
                    use:doubletap={{ onDoubleTap: () => toggle(section.id, item) }}
                    onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(section.id, item); } }}>{item.title}</button>
          </li>
        {:else}
          {#if section.done.length === 0}<li class="shop-item is-empty">{m.notes_nothing_to_buy()}</li>{/if}
        {/each}
        {#each section.done as entry (entry.id)}
          <li class="shop-item phone-shop-item is-done">
            <button class="shop-toggle" type="button" aria-pressed="true" aria-label="Erledigt: {entry.title}"
                    use:doubletap={{ onDoubleTap: () => toggle(section.id, entry) }}
                    onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(section.id, entry); } }}>{entry.title}</button>
          </li>
        {/each}
      </ul>
      {#if addTarget === section.id}
        <form class="notes-add-form" onsubmit={submitAdd}>
          <input class="notes-add-input" type="text" placeholder="Bei {section.title} besorgen …" maxlength="120"
                 bind:value={draft} use:focusOnMount disabled={busy}
                 enterkeyhint="go" autocomplete="off" />
          <button class="notes-add-confirm pressable" type="submit" disabled={busy || !draft.trim()}
                  aria-label={m.notes_save_entry()}>
            <Icon name="i-check" cls="icon icon-md" />
          </button>
          {#if addError}<p class="notes-add-error" role="alert">{addError}</p>{/if}
        </form>
      {/if}
    </section>
  {/each}
</main>
