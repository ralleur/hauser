<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { reminders, updateReminder } from '../state/reminders.svelte.ts';
  import { reminderDisplayTitle } from '../state/reminders.ts';

  let { reminderId, onclose }: { reminderId: string; onclose: () => void } = $props();
  const item = $derived(reminders.items.find((entry) => entry.id === reminderId));
  let title = $state('');
  let due = $state('');
  let initialized = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!item || initialized) return;
    title = reminderDisplayTitle(item.title);
    due = item.due ?? '';
    initialized = true;
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    busy = true;
    error = null;
    try {
      await updateReminder(reminderId, title, due || null);
      onclose();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : m.rem_edit_save_error();
    } finally {
      busy = false;
    }
  }
</script>

<div class="rem-edit-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
  <div role="dialog" aria-modal="true" aria-labelledby="rem-edit-title">
  <form class="rem-edit-dialog" onsubmit={save}>
    <h2 id="rem-edit-title">{m.rem_edit_title()}</h2>
    <label>
      <span>{m.rem_edit_field()}</span>
      <input type="text" maxlength="120" bind:value={title} disabled={busy} autocomplete="off" />
    </label>
    <label>
      <span>{m.rem_edit_show_from()}</span>
      <input type="date" bind:value={due} disabled={busy} />
    </label>
    <p class="rem-edit-hint">{m.rem_edit_no_date()}</p>
    {#if error}<p class="notes-add-error" role="alert">{error}</p>{/if}
    <div class="rem-edit-actions">
      <button class="secondary-btn pressable" type="button" disabled={busy} onclick={onclose}>{m.rem_edit_cancel()}</button>
      <button class="primary-btn pressable" type="submit" disabled={busy || !title.trim()}>
        {busy ? m.rem_edit_saving() : m.rem_edit_save()}
      </button>
    </div>
  </form>
  </div>
</div>
