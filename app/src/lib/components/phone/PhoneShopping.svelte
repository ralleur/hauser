<script lang="ts">
  import Icon from '../Icon.svelte';
  import { prefersReducedMotion } from '../../motion/index.ts';
  import {
    shopping, refreshShopping, addShoppingItem, toggleShoppingItem,
  } from '../../state/shopping.svelte.ts';
  import { projectPhoneShoppingSections, type ShoppingItem, type StoreId } from '../../state/shopping.ts';
  import { m } from '../../../paraglide/messages.js';
  import { intlLocale } from '../../state/locale.svelte.ts';
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
  /* Erledigtes sammelt sich in einer Gruppe am Ende, der Laden steht klein daneben. */
  const doneEntries = $derived(sections.flatMap((section) =>
    section.done.map((item) => ({ store: section.id, storeTitle: section.title, item }))));

  const updatedLabel = $derived(shopping.updatedAt
    ? m.notes_shopping_updated({
        time: new Date(shopping.updatedAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }),
      })
    : m.notes_not_loaded());

  /* Abhaken: der Kreis füllt sich kurz, dann wandert die Zeile nach „Erledigt";
     fünf Sekunden lang steht ein Rückweg bereit. */
  const SETTLE_MS = prefersReducedMotion() ? 0 : 320;
  const UNDO_MS = 5000;
  let settlingId = $state<string | null>(null);
  let undo = $state<{ store: StoreId; item: ShoppingItem } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  function commitToggle(store: StoreId, item: ShoppingItem) {
    toggleError = null;
    void toggleShoppingItem(store, item).then(() => { now = Date.now(); }).catch((error) => {
      toggleError = error instanceof Error ? error.message : m.notes_refresh_error();
    });
  }

  function check(store: StoreId, item: ShoppingItem) {
    if (settlingId) return;
    settlingId = item.id;
    setTimeout(() => {
      settlingId = null;
      commitToggle(store, item);
      undo = { store, item: { ...item, checked: true, checkedAt: new Date().toISOString() } };
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { undo = null; }, UNDO_MS);
    }, SETTLE_MS);
  }

  function uncheck(store: StoreId, item: ShoppingItem) {
    if (undo?.item.id === item.id) dismissUndo();
    commitToggle(store, item);
  }

  function runUndo() {
    if (!undo) return;
    const { store, item } = undo;
    dismissUndo();
    commitToggle(store, item);
  }

  function dismissUndo() {
    clearTimeout(undoTimer);
    undo = null;
  }

  /* Hinzufügen: die letzte Zeile jeder Gruppe wird zum Eingabefeld und bleibt
     nach Enter für den nächsten Artikel offen. */
  let addTarget = $state<StoreId | null>(null);
  let draft = $state('');
  let addError = $state<string | null>(null);
  let addInput = $state<HTMLInputElement | null>(null);

  function openAdd(target: StoreId) {
    addTarget = target;
    draft = '';
    addError = null;
  }

  function closeAdd() {
    addTarget = null;
    draft = '';
  }

  function focusOnMount(el: HTMLInputElement) {
    el.focus();
  }

  function submitAdd(e: SubmitEvent) {
    e.preventDefault();
    const title = draft.trim();
    const target = addTarget;
    if (!title || !target) return;
    draft = '';
    addError = null;
    addInput?.focus();
    void addShoppingItem(target, title).catch((error) => {
      addError = error instanceof Error ? error.message : m.notes_save_error();
    });
  }

  function onAddKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); closeAdd(); }
  }

  function onAddBlur() {
    if (!draft.trim()) closeAdd();
  }
</script>

<main class="phone-notes-page phone-shopping" aria-labelledby="phone-target-title">
  <header class="phone-notes-head">
    <div class="shop-head-text">
      <h1 bind:this={titleAnchor} id="phone-target-title" tabindex="-1">{m.notes_shopping()}</h1>
      {#if shopping.error}
        <p class="shop-status is-error" role="status">{shopping.error}</p>
      {:else}
        <p class="shop-status">{updatedLabel}</p>
      {/if}
    </div>
    <div class="shop-tools">
      <button class="shop-tool pressable" class:is-active={shoppingSort.active} type="button"
              disabled={shoppingSort.loading}
              aria-label={shoppingSort.active ? m.shopping_undo_label() : m.shopping_sort_label()}
              onclick={() => shoppingSort.active ? undoShoppingSort() : sortShoppingList(shopping.sections)}>
        <Icon name={shoppingSort.active ? 'i-undo-variant' : 'i-sort-variant'} cls="icon icon-md" />
      </button>
      <button class="shop-tool pressable" type="button" aria-label={m.notes_shopping_refresh()}
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
      <header class="shop-section-head">
        <h3 class="shop-section-title">{section.title}</h3>
        {#if section.items.length}<span class="shop-section-count num">{section.items.length}</span>{/if}
      </header>
      <ul class="shop-items">
        {#each section.items as item (item.id)}
          <li class="shop-row" class:is-settling={settlingId === item.id}>
            <button class="shop-row-btn" type="button" aria-pressed="false"
                    aria-label={m.shopping_check_label({ title: item.title })}
                    onclick={() => check(section.id, item)}>
              <span class="shop-ring" aria-hidden="true"><Icon name="i-check" cls="icon" /></span>
              <span class="shop-row-title">{item.title}</span>
            </button>
          </li>
        {/each}
        {#if addTarget === section.id}
          <li class="shop-row">
            <form class="shop-add-form" onsubmit={submitAdd}>
              <span class="shop-ring is-plus" aria-hidden="true"><Icon name="i-plus" cls="icon" /></span>
              <input class="shop-add-input" type="text" maxlength="120"
                     placeholder={m.shopping_add_placeholder({ section: section.title })}
                     aria-label={m.notes_add_to_section({ section: section.title })}
                     bind:this={addInput} bind:value={draft} use:focusOnMount
                     onkeydown={onAddKeydown} onblur={onAddBlur}
                     enterkeyhint="done" autocomplete="off" />
            </form>
          </li>
        {:else}
          <li class="shop-row">
            <button class="shop-row-btn shop-add-row" type="button"
                    aria-label={m.notes_add_to_section({ section: section.title })}
                    onclick={() => openAdd(section.id)}>
              <span class="shop-ring is-plus" aria-hidden="true"><Icon name="i-plus" cls="icon" /></span>
              <span class="shop-row-title">{m.shopping_add_item()}</span>
            </button>
          </li>
        {/if}
      </ul>
    </section>
  {/each}

  {#if doneEntries.length}
    <section class="shop-section is-done-group">
      <header class="shop-section-head">
        <h3 class="shop-section-title">{m.shopping_done_title()}</h3>
        <span class="shop-section-count num">{doneEntries.length}</span>
      </header>
      <ul class="shop-items">
        {#each doneEntries as entry (entry.item.id)}
          <li class="shop-row is-done">
            <button class="shop-row-btn" type="button" aria-pressed="true"
                    aria-label={m.shopping_done_item_label({ title: entry.item.title })}
                    onclick={() => uncheck(entry.store, entry.item)}>
              <span class="shop-ring" aria-hidden="true"><Icon name="i-check" cls="icon" /></span>
              <span class="shop-row-title">{entry.item.title}</span>
              <span class="shop-row-meta">{entry.storeTitle}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if undo}
    <div class="shop-undo" role="status" aria-live="polite">
      <span class="shop-undo-label">{m.shopping_done_toast({ title: undo.item.title })}</span>
      <button class="shop-undo-btn pressable" type="button" onclick={runUndo}>{m.notes_undo()}</button>
    </div>
  {/if}
</main>
