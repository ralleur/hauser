<script lang="ts">
  import Icon from '../Icon.svelte';
  import ReminderEditDialog from '../ReminderEditDialog.svelte';
  import ReminderTableDialog from '../ReminderTableDialog.svelte';
  import { longpress } from '../../actions/longpress.ts';
  import { m } from '../../../paraglide/messages.js';
  import {
    reminders, refreshReminders, addReminder, completeReminder, hmiReminderId,
  } from '../../state/reminders.svelte.ts';
  import {
    reminderRowsByPerson, reminderDisplayTitle, postitDueLabel, reminderOverdue,
    type ReminderPerson,
  } from '../../state/reminders.ts';
  import { postitStyle } from '../../state/reminder-persons.ts';
  import {
    personColorId, personDisplayLabel, reminderPersons,
  } from '../../state/reminder-persons.svelte.ts';

  let { titleAnchor = $bindable() }: { titleAnchor?: HTMLHeadingElement } = $props();
  /* Die Bewohner werden auf dem Panel gepflegt; das Handy zeigt dieselbe
     Liste in derselben Reihenfolge. */
  const persons = $derived(reminderPersons.list);
  const PERSON_ORDER = $derived(persons.map((person) => person.id));
  const personRows = $derived(reminderRowsByPerson(reminders.items, undefined, persons));

  let addTarget = $state<ReminderPerson | null>(null);
  let draft = $state('');
  let reminderDate = $state('');
  let showReminderDate = $state(false);
  let busy = $state(false);
  let addError = $state<string | null>(null);

  function toggleAdd(target: ReminderPerson) {
    addTarget = addTarget === target ? null : target;
    draft = '';
    reminderDate = '';
    showReminderDate = false;
    addError = null;
  }

  function focusOnMount(el: HTMLInputElement) { el.focus(); }

  function submitAdd(e: SubmitEvent) {
    e.preventDefault();
    const title = draft.trim();
    const target = addTarget;
    if (!title || !target) return;
    addTarget = null;
    draft = '';
    addError = null;
    void addReminder(target, title, reminderDate || null).catch((error: unknown) => {
      addError = error instanceof Error ? error.message : m.notes_save_error();
    });
  }

  let popout = $state<{ id: string; x: number; y: number } | null>(null);
  let popoutBusy = $state(false);
  let popoutError = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let tableOpen = $state(false);

  function openPopout(e: MouseEvent, reminderId: string) {
    if (!hmiReminderId(reminderId)) return;
    popoutError = null;
    popout = popout?.id === reminderId ? null : {
      id: reminderId,
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 96),
    };
  }

  function openPopoutCentered(reminderId: string) {
    if (!hmiReminderId(reminderId)) return;
    popout = { id: reminderId, x: window.innerWidth / 2 - 90, y: window.innerHeight / 2 - 48 };
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

<svelte:document onpointerdown={closePopout} />

<main class="phone-notes-page" aria-labelledby="phone-target-title">
  <header class="phone-notes-head">
    <h1 bind:this={titleAnchor} id="phone-target-title" tabindex="-1">{m.notes_reminders()}</h1>
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

  {#if addError}<p class="notes-add-error" role="alert">{addError}</p>{/if}

  {#if reminders.error}
    <p class="phone-calendar-status is-error" role="status">{m.phone_reminders_stale()}</p>
  {/if}

  {#each PERSON_ORDER as person (person)}
    {@const row = personRows[person]}
    <section class="rem-section">
      <header class="notes-section-head">
        <h3 class="notes-section-title">{personDisplayLabel(person)}</h3>
        <span class="rem-swatch" style={postitStyle(personColorId(person))} aria-hidden="true"></span>
        <span class="notes-section-count num">{row.open.length || ''}</span>
        <button class="notes-add-btn pressable" type="button"
                aria-label={m.notes_add_reminder_for({ person: personDisplayLabel(person) })}
                onclick={() => toggleAdd(person)}>
          <Icon name="i-plus" cls="icon icon-md" />
        </button>
      </header>
      <div class="rem-cards">
        {#each row.open as item (item.id)}
          <button class="rem-card pressable" type="button" style={postitStyle(personColorId(person))}
                  class:is-selected={popout?.id === item.id}
                  aria-label="{reminderDisplayTitle(item.title, persons)} — Kontextmenü öffnen"
                  use:longpress={{ onLongPress: () => openPopoutCentered(item.id) }}
                  onclick={(e) => openPopout(e, item.id)}>
            <p class="rem-card-title">{reminderDisplayTitle(item.title, persons)}</p>
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
            <div class="rem-card is-done" style={postitStyle(personColorId(person))}
                 aria-label="Erledigt: {reminderDisplayTitle(item.title, persons)}">
              <p class="rem-card-title">{reminderDisplayTitle(item.title, persons)}</p>
              <span class="rem-card-due">{m.phone_done_check()}</span>
            </div>
          {/each}
        {/if}
      </div>
      {#if addTarget === person}
        <form class="notes-add-form has-calendar" onsubmit={submitAdd}>
          <input class="notes-add-input" type="text" placeholder={m.notes_add_reminder_placeholder({ person: personDisplayLabel(person) })} maxlength="120"
                 bind:value={draft} use:focusOnMount disabled={busy}
                 enterkeyhint="go" autocomplete="off" />
          <button class="notes-add-confirm pressable" type="submit" disabled={busy || !draft.trim()}
                  aria-label={m.notes_save_entry()}>
            <Icon name="i-check" cls="icon icon-md" />
          </button>
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
          {#if addError}<p class="notes-add-error" role="alert">{addError}</p>{/if}
        </form>
      {/if}
    </section>
  {/each}

  {#if popout}
    <div class="rem-popout" style="left: {popout.x}px; top: {popout.y}px" role="dialog"
         aria-label={m.notes_reminder_menu()}>
      <button class="rem-popout-btn secondary pressable" type="button" disabled={popoutBusy}
              onclick={editSelected}>{m.notes_edit()}</button>
      <button class="rem-popout-btn pressable" type="button" disabled={popoutBusy}
              onclick={confirmComplete}>
        {popoutBusy ? m.phone_marking_done() : m.phone_done_check()}
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
</main>
