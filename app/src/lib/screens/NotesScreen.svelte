<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ReminderEditDialog from '../components/ReminderEditDialog.svelte';
  import ReminderTableDialog from '../components/ReminderTableDialog.svelte';
  import { doubletap } from '../actions/doubletap.ts';
  import { longpress } from '../actions/longpress.ts';
  import { shopping, addShoppingItem, toggleShoppingItem } from '../state/shopping.svelte.ts';
  import { refreshShopping } from '../state/shopping.svelte.ts';
  import { projectShoppingSections, type ShoppingItem, type StoreId } from '../state/shopping.ts';
  import { m } from '../../paraglide/messages.js';
  import {
    shoppingConfig, shoppingSort, shoppingItemOrder, sortShoppingList, undoShoppingSort,
  } from '../state/shopping-settings.svelte.ts';
  import {
    reminders, refreshReminders, addReminder, completeReminder, hmiReminderId,
  } from '../state/reminders.svelte.ts';
  import {
    reminderRowsByPerson, reminderDisplayTitle, postitDueLabel, reminderOverdue,
    PERSON_ORDER, PERSON_LABELS, type ReminderPerson,
  } from '../state/reminders.ts';

  /* Beide Wrapper spiegeln live die zentralen HMI-Daten: links Einkauf,
     rechts Erinnerungen nach Person gruppiert.
     Leere Sektionen bleiben sichtbar — dort sitzt der +-Button. */
  const shopSections = $derived(projectShoppingSections(shopping.sections, {
    keepEmpty: true,
    includeChecked: true,
    stores: shoppingConfig.stores,
    itemOrder: shoppingItemOrder(shopping.sections),
  }));
  const personRows = $derived(reminderRowsByPerson(reminders.items));

  const updatedLabel = $derived(shopping.updatedAt
    ? `Stand ${new Date(shopping.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    : m.notes_not_loaded());

  /* Add-Flow: pro Sektion ein +, das eine Inline-Zeile öffnet. */
  let addTarget = $state<string | null>(null);
  let draft = $state('');
  let reminderDate = $state('');
  let showReminderDate = $state(false);
  let busy = $state(false);
  let addError = $state<string | null>(null);

  function toggleAdd(target: string) {
    addTarget = addTarget === target ? null : target;
    draft = '';
    reminderDate = '';
    showReminderDate = false;
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
    const [kind, id] = target.split(':');
    const write = kind === 'shop'
      ? addShoppingItem(id as StoreId, title)
      : addReminder(id as ReminderPerson, title, reminderDate || null);
    void write.catch((error) => {
      addError = error instanceof Error ? error.message : m.notes_save_error();
    });
  }

  function togglePurchase(store: StoreId, item: ShoppingItem) {
    addError = null;
    void toggleShoppingItem(store, item).catch((error) => {
      addError = error instanceof Error ? error.message : m.notes_refresh_error();
    });
  }

  /* ── Erledigt-Popout: Tap auf einen offenen Zettel öffnet an der Tipp-Stelle
     einen kleinen „Erledigt ✓"-Knopf. Bestätigen setzt den Status zentral;
     der Zettel wandert ausgegraut ans Reihen-Ende und verschwindet
     beim nächsten Refresh vom Standby. Tap daneben schließt das Popout. ── */
  let popout = $state<{ id: string; x: number; y: number } | null>(null);
  let popoutBusy = $state(false);
  let popoutError = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let tableOpen = $state(false);

  function openPopout(e: MouseEvent, reminderId: string) {
    if (!hmiReminderId(reminderId)) return; // HA-Erinnerungen bleiben read-only
    popoutError = null;
    popout = popout?.id === reminderId ? null : {
      id: reminderId,
      /* an der Tipp-Stelle, aber im Viewport gehalten */
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 96),
    };
  }

  function closePopout(e: PointerEvent) {
    if (!popout || popoutBusy) return;
    const el = e.target as HTMLElement;
    if (el.closest('.rem-popout') || el.closest('.rem-card')) return;
    popout = null;
  }

  async function confirmComplete() {
    if (!popout || popoutBusy) return;
    popoutBusy = true;
    popoutError = null;
    try {
      await completeReminder(popout.id);
      popout = null;
    } catch (error) {
      popoutError = error instanceof Error ? error.message : m.notes_check_error();
    } finally {
      popoutBusy = false;
    }
  }

  function editSelected() {
    if (!popout) return;
    editingId = popout.id;
    popout = null;
  }
</script>

{#snippet addForm(target: string, placeholder: string)}
  {#if addTarget === target}
    <form class="notes-add-form" class:has-calendar={target.startsWith('rem:')} onsubmit={submitAdd}>
      <input class="notes-add-input" type="text" {placeholder} maxlength="120"
             bind:value={draft} use:focusOnMount disabled={busy}
             enterkeyhint="go" autocomplete="off" />
      <button class="notes-add-confirm pressable" type="submit" disabled={busy || !draft.trim()}
              aria-label={m.notes_save_entry()}>
        <Icon name="i-check" cls="icon icon-md" />
      </button>
      {#if target.startsWith('rem:')}
        <button class="notes-add-calendar pressable" class:is-active={showReminderDate} type="button"
                aria-label={m.notes_set_date()} aria-pressed={showReminderDate}
                onclick={() => { showReminderDate = !showReminderDate; if (!showReminderDate) reminderDate = ''; }}>
          <Icon name="i-calendar" cls="icon icon-md" />
        </button>
        {#if showReminderDate}
          <label class="notes-add-date">
            <span>{m.notes_show_on_lockscreen()}</span>
            <input type="date" bind:value={reminderDate} required />
          </label>
        {/if}
      {/if}
      {#if addError}<p class="notes-add-error" role="alert">{addError}</p>{/if}
    </form>
  {/if}
{/snippet}

<svelte:document onpointerdown={closePopout} />

<!-- ── Notizen-Seite: die Pinnwand der Familie. Vollbild-Hintergrund (Day/
     Night via Theme), darauf zwei Kontrollflächen im Stil der Home-Panels:
     links die Einkaufsliste, rechts die Erinnerungen als Post-its. ── -->
<div class="notes-screen">
  {#if addError}<p class="notes-add-error" role="alert">{addError}</p>{/if}
  {#if shoppingSort.error}<p class="notes-add-error" role="alert">{shoppingSort.error}</p>{/if}
  <div class="notes-panels">
    <aside class="notes-panel" aria-label={m.notes_shopping()}>
      <header class="panel-head">
        <h2 class="panel-title">{m.notes_shopping()}</h2>
        <div class="notes-head-meta">
          <span class="notes-updated">{updatedLabel}</span>
          <button class="secondary-btn pressable" type="button" disabled={shoppingSort.loading}
                  onclick={() => shoppingSort.active ? undoShoppingSort() : sortShoppingList(shopping.sections)}>
            {shoppingSort.loading ? 'Sortiert …' : shoppingSort.active ? m.notes_undo() : m.notes_sort_by_category()}
          </button>
          <button class="notes-refresh pressable" type="button" aria-label={m.notes_shopping_refresh()}
                  disabled={shopping.loading} onclick={() => refreshShopping()}>
            <Icon name="i-refresh" cls="icon icon-md" />
          </button>
        </div>
      </header>
      <div class="notes-body">
        {#each shopSections as section (section.id)}
          <section class="shop-section">
            <header class="notes-section-head">
              <h3 class="notes-section-title">{section.title}</h3>
              <span class="notes-section-count num">{section.items.filter((item) => !item.checked).length || ''}</span>
              <button class="notes-add-btn pressable" type="button"
                      aria-label="Eintrag bei {section.title} hinzufügen"
                      onclick={() => toggleAdd(`shop:${section.id}`)}>
                <Icon name="i-plus" cls="icon icon-md" />
              </button>
            </header>
            <ul class="shop-items">
              {#each section.items as item (item.id)}
                <li class="shop-item" class:is-done={item.checked}>
                  <button class="shop-toggle" type="button" aria-pressed={item.checked}
                          use:doubletap={{ onDoubleTap: () => togglePurchase(section.id, item) }}
                          onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); togglePurchase(section.id, item); } }}>
                    {item.title}
                  </button>
                </li>
              {:else}
                <li class="shop-item is-empty">{m.notes_nothing_to_buy()}</li>
              {/each}
            </ul>
            {@render addForm(`shop:${section.id}`, `Bei ${section.title} besorgen …`)}
          </section>
        {/each}
      </div>
    </aside>

    <aside class="notes-panel" aria-label={m.notes_reminders()}>
      <header class="panel-head">
        <h2 class="panel-title">{m.notes_reminders()}</h2>
        <div class="notes-head-meta">
          <button class="notes-refresh pressable" type="button" aria-label={m.notes_reminders_table()}
                  onclick={() => { tableOpen = true; }}>
            <Icon name="i-table" cls="icon icon-md" />
          </button>
          <button class="notes-refresh pressable" type="button" aria-label={m.notes_reminders_refresh()}
                  disabled={reminders.loading} onclick={() => refreshReminders()}>
            <Icon name="i-refresh" cls="icon icon-md" />
          </button>
        </div>
      </header>
      <div class="notes-body">
        {#each PERSON_ORDER as person (person)}
          {@const row = personRows[person]}
          <section class="rem-section">
            <header class="notes-section-head">
              <h3 class="notes-section-title">{PERSON_LABELS[person]}</h3>
              <span class="rem-swatch postit-{person}" aria-hidden="true"></span>
              <span class="notes-section-count num">{row.open.length || ''}</span>
              <button class="notes-add-btn pressable" type="button"
                      aria-label="Erinnerung für {PERSON_LABELS[person]} hinzufügen"
                      onclick={() => toggleAdd(`rem:${person}`)}>
                <Icon name="i-plus" cls="icon icon-md" />
              </button>
            </header>
            <!-- EINE Reihe pro Person, horizontal scrollbar: offene Zettel links
                 (älteste zuerst), erledigte ausgegraut rechts daneben. -->
            <div class="rem-cards">
              {#each row.open as item (item.id)}
                <button class="rem-card pressable postit-{person}" type="button"
                        class:is-selected={popout?.id === item.id}
                        aria-label="{reminderDisplayTitle(item.title)} — Kontextmenü öffnen"
                        use:longpress={{ onLongPress: () => { if (hmiReminderId(item.id)) popout = { id: item.id, x: window.innerWidth / 2 - 90, y: window.innerHeight / 2 - 48 }; } }}
                        onclick={(e) => openPopout(e, item.id)}>
                  <p class="rem-card-title">{reminderDisplayTitle(item.title)}</p>
                  {#if postitDueLabel(item)}
                    <span class="rem-card-due num" class:is-overdue={reminderOverdue(item)}>{postitDueLabel(item)}</span>
                  {/if}
                </button>
              {:else}
                <p class="rem-empty">{m.notes_nothing_open()}</p>
              {/each}
              {#if row.done.length}
                <span class="rem-done-sep" aria-hidden="true"></span>
                {#each row.done as item (item.id)}
                  <div class="rem-card is-done postit-{person}" aria-label="Erledigt: {reminderDisplayTitle(item.title)}">
                    <p class="rem-card-title">{reminderDisplayTitle(item.title)}</p>
                    <span class="rem-card-due">Erledigt ✓</span>
                  </div>
                {/each}
              {/if}
            </div>
            {@render addForm(`rem:${person}`, `Erinnerung für ${PERSON_LABELS[person]} …`)}
          </section>
        {/each}
      </div>
    </aside>
  </div>

  <!-- Kontextmenü für zentral gespeicherte Erinnerungen. -->
  {#if popout}
    <div class="rem-popout" style="left: {popout.x}px; top: {popout.y}px" role="dialog"
         aria-label={m.notes_reminder_menu()}>
      <button class="rem-popout-btn secondary pressable" type="button" disabled={popoutBusy}
              onclick={editSelected}>{m.notes_edit()}</button>
      <button class="rem-popout-btn pressable" type="button" disabled={popoutBusy}
              onclick={confirmComplete}>
        {popoutBusy ? 'Wird abgehakt …' : 'Erledigt ✓'}
      </button>
      {#if popoutError}<p class="rem-popout-error" role="alert">{popoutError}</p>{/if}
    </div>
  {/if}
  {#if editingId}
    <ReminderEditDialog reminderId={editingId} onclose={() => { editingId = null; }} />
  {/if}
  {#if tableOpen}
    <ReminderTableDialog onclose={() => { tableOpen = false; }} />
  {/if}
</div>
