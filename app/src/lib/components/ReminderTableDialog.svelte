<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { intlLocale } from '../state/locale.svelte.ts';
  import Icon from './Icon.svelte';
  import { canDeleteReminder, deleteReminder, reminders } from '../state/reminders.svelte.ts';
  import { confirmThen, isConfirming } from '../state/settings-actions.svelte.ts';
  import { reminderDisplayTitle, reminderPerson, type Reminder } from '../state/reminders.ts';
  import { postitStyle } from '../state/reminder-persons.ts';
  import {
    personColorId, personDisplayLabel, reminderPersons,
  } from '../state/reminder-persons.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();

  const dateTimeFormatter = () => new Intl.DateTimeFormat(intlLocale(), {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const dateFormatter = () => new Intl.DateTimeFormat(intlLocale(), {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const persons = $derived(reminderPersons.list);
  const rows = $derived([...reminders.items].sort((a, b) => timestamp(b.created) - timestamp(a.created)));
  let deleting = $state(false);
  let deleteError = $state(false);

  async function remove(id: string): Promise<void> {
    deleting = true;
    deleteError = false;
    try { await deleteReminder(id); }
    catch { deleteError = true; }
    finally { deleting = false; }
  }

  function timestamp(value: string | null | undefined): number {
    const parsed = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDateTime(value: string | null | undefined): string {
    const parsed = timestamp(value);
    return parsed ? dateTimeFormatter().format(new Date(parsed)) : '—';
  }

  function formatDue(value: string | null): string {
    if (!value) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return dateFormatter().format(new Date(year, month - 1, day));
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
        <h2 id="rem-table-title">{m.rem_table_title()}</h2>
        <p>{rows.length === 1 ? m.rem_table_count_one({ count: rows.length }) : m.rem_table_count_other({ count: rows.length })}</p>
      </div>
      <button class="notes-refresh pressable" type="button" aria-label={m.rem_table_close()} onclick={onclose}>
        <Icon name="i-close" cls="icon icon-md" />
      </button>
    </header>

    {#if deleteError}<p class="phone-calendar-status is-error" role="alert">{m.rem_delete_error()}</p>{/if}
    <div class="rem-table-scroll">
      <table class="rem-table">
        <thead>
          <tr>
            <th scope="col">{m.rem_table_who()}</th>
            <th scope="col">{m.rem_table_what()}</th>
            <th scope="col">{m.rem_table_created()}</th>
            <th scope="col">{m.rem_table_closed()}</th>
            <th scope="col">{m.rem_table_due()}</th>
            <th scope="col"><span class="sr-only">{m.sys_delete()}</span></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as item (item.id)}
            {@const person = reminderPerson(item.title, persons)}
            <tr class:is-done={item.completed}>
              <td><span class="rem-table-person" style={postitStyle(personColorId(person))}>{personDisplayLabel(person)}</span></td>
              <td>{reminderDisplayTitle(item.title, persons)}</td>
              <td class="num">{formatDateTime(item.created)}</td>
              <td class="num">{closedAt(item)}</td>
              <td class="num">{formatDue(item.due)}</td>
              <td>
                {#if canDeleteReminder(item)}
                  {@const key = `reminder-delete-${item.id}`}
                  <button class="secondary-btn danger-btn pressable" type="button" disabled={deleting}
                          onclick={() => confirmThen(key, () => remove(item.id))}>
                    {isConfirming(key) ? m.sys_delete_confirm() : m.sys_delete()}
                  </button>
                {/if}
              </td>
            </tr>
          {:else}
            <tr><td class="rem-table-empty" colspan="6">{m.rem_table_empty()}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
