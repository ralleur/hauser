<script lang="ts">
  import Icon from './Icon.svelte';
  import { reminders } from '../state/reminders.svelte.ts';
  import {
    PERSON_LABELS, reminderDisplayTitle, reminderPerson, type Reminder,
  } from '../state/reminders.ts';

  let { onclose }: { onclose: () => void } = $props();

  const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const dateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const rows = $derived([...reminders.items].sort((a, b) => timestamp(b.created) - timestamp(a.created)));

  function timestamp(value: string | null | undefined): number {
    const parsed = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDateTime(value: string | null | undefined): string {
    const parsed = timestamp(value);
    return parsed ? dateTimeFormatter.format(new Date(parsed)) : '—';
  }

  function formatDue(value: string | null): string {
    if (!value) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return dateFormatter.format(new Date(year, month - 1, day));
    }
    return formatDateTime(value);
  }

  function closedAt(item: Reminder): string {
    return item.completed ? formatDateTime(item.edited) : '—';
  }

  function closeOnScrim(event: MouseEvent) {
    if (event.target === event.currentTarget) onclose();
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onclose(); }} />

<div class="rem-table-backdrop" role="presentation" onclick={closeOnScrim}>
  <div class="rem-table-dialog" role="dialog" aria-modal="true" aria-labelledby="rem-table-title" tabindex="-1">
    <header class="rem-table-head">
      <div>
        <h2 id="rem-table-title">Alle Erinnerungen</h2>
        <p>{rows.length} {rows.length === 1 ? 'Eintrag' : 'Einträge'}</p>
      </div>
      <button class="notes-refresh pressable" type="button" aria-label="Übersicht schließen" onclick={onclose}>
        <Icon name="i-close" cls="icon icon-md" />
      </button>
    </header>

    <div class="rem-table-scroll">
      <table class="rem-table">
        <thead>
          <tr>
            <th scope="col">Wer</th>
            <th scope="col">Was</th>
            <th scope="col">Erstellt</th>
            <th scope="col">Geschlossen</th>
            <th scope="col">Fällig</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as item (item.id)}
            {@const person = reminderPerson(item.title)}
            <tr class:is-done={item.completed}>
              <td><span class="rem-table-person postit-{person}">{PERSON_LABELS[person]}</span></td>
              <td>{reminderDisplayTitle(item.title)}</td>
              <td class="num">{formatDateTime(item.created)}</td>
              <td class="num">{closedAt(item)}</td>
              <td class="num">{formatDue(item.due)}</td>
            </tr>
          {:else}
            <tr><td class="rem-table-empty" colspan="5">Noch keine Erinnerungen vorhanden.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
