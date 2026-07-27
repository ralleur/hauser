<script lang="ts">
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
      error = caught instanceof Error ? caught.message : 'Fehler beim Speichern';
    } finally {
      busy = false;
    }
  }
</script>

<div class="rem-edit-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
  <div role="dialog" aria-modal="true" aria-labelledby="rem-edit-title">
  <form class="rem-edit-dialog" onsubmit={save}>
    <h2 id="rem-edit-title">Erinnerung bearbeiten</h2>
    <label>
      <span>Erinnerung</span>
      <input type="text" maxlength="120" bind:value={title} disabled={busy} autocomplete="off" />
    </label>
    <label>
      <span>Auf dem Lockscreen anzeigen ab</span>
      <input type="date" bind:value={due} disabled={busy} />
    </label>
    <p class="rem-edit-hint">Ohne Datum erscheint der Zettel sofort.</p>
    {#if error}<p class="notes-add-error" role="alert">{error}</p>{/if}
    <div class="rem-edit-actions">
      <button class="secondary-btn pressable" type="button" disabled={busy} onclick={onclose}>Abbrechen</button>
      <button class="primary-btn pressable" type="submit" disabled={busy || !title.trim()}>
        {busy ? 'Speichert …' : 'Speichern'}
      </button>
    </div>
  </form>
  </div>
</div>
