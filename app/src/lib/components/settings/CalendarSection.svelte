<script lang="ts">
  /* ── Inhalte · Kalender & Erinnerungen ──
     Nur noch die Auswahl: was wird aus den angebundenen Quellen angezeigt.
     Die iCloud-Kontoeinrichtung ist bewusst nach „Verbindungen · Dienste“
     gewandert — Konto anlegen ist eine einmalige Integrationsaufgabe, die
     Auswahl der Kalender eine laufende Inhaltsentscheidung. */
  import Icon from '../Icon.svelte';
  import {
    availableCalendars,
    loadAvailableCalendars,
    selectedCalendarIds,
    setSelectedCalendarIds,
  } from '../../state/calendar.svelte.ts';
  import { selectFamilyCalendar } from '../../state/calendar.ts';
  import {
    availableReminderLists,
    loadAvailableReminderLists,
    selectedReminderListIds,
    setSelectedReminderListIds,
  } from '../../state/reminders.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  let calSelection = $state<string[] | null>(selectedCalendarIds());
  let reminderSelection = $state<string[]>(selectedReminderListIds() ?? []);

  /* Beim Öffnen der Sektion einmal frisch laden. */
  $effect(() => {
    void loadAvailableCalendars();
    void loadAvailableReminderLists();
  });

  /* Wirksame Auswahl: explizit gespeichert oder die Automatik „Familie“. */
  const effectiveCalendarIds = $derived(
    calSelection
      ?? (selectFamilyCalendar(availableCalendars.sources) ? [selectFamilyCalendar(availableCalendars.sources)!.entityId] : []),
  );

  function toggleCalendar(entityId: string): void {
    const next = effectiveCalendarIds.includes(entityId)
      ? effectiveCalendarIds.filter((id) => id !== entityId)
      : [...effectiveCalendarIds, entityId];
    calSelection = next;
    setSelectedCalendarIds(next);
  }

  function resetCalendarSelection(): void {
    calSelection = null;
    setSelectedCalendarIds(null);
  }

  function toggleReminderList(entityId: string): void {
    const next = reminderSelection.includes(entityId)
      ? reminderSelection.filter((id) => id !== entityId)
      : [...reminderSelection, entityId];
    reminderSelection = next;
    setSelectedReminderListIds(next);
  }
</script>

<h3 class="caps-label settings-group-label">{m.sys_shown_calendars()}</h3>
<div class="settings-group" data-setting-id="calendar-selection">
  {#if availableCalendars.sources.length === 0}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-calendar" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{availableCalendars.loading ? m.sys_calendars_loading() : m.sys_calendars_none()}</span>
        <span class="settings-row-sub">{availableCalendars.loading ? '' : m.sys_calendars_hint()}</span>
      </div>
    </div>
  {:else}
    {#each availableCalendars.sources as source (source.entityId)}
      <div class="settings-row">
        <span class="settings-cal-dot" style:background={source.color ?? 'var(--color-text-tertiary)'}></span>
        <div class="settings-row-text">
          <span class="settings-row-label">{source.name}</span>
          <span class="settings-row-sub num">{source.entityId}</span>
        </div>
        <button class="settings-switch pressable" type="button" role="switch"
                aria-checked={effectiveCalendarIds.includes(source.entityId)}
                aria-label="Kalender {source.name} anzeigen"
                onclick={() => toggleCalendar(source.entityId)}>
          <span class="settings-switch-knob"></span>
        </button>
      </div>
    {/each}
    {#if calSelection !== null}
      <div class="settings-row">
        <span class="settings-row-icon"><Icon name="i-restore" cls="icon icon-md" /></span>
        <div class="settings-row-text">
          <span class="settings-row-label">{m.sys_auto()}</span>
          <span class="settings-row-sub">{m.sys_calendar_preselect()}</span>
        </div>
        <button class="secondary-btn pressable" type="button" onclick={resetCalendarSelection}>{m.sys_apply()}</button>
      </div>
    {/if}
  {/if}
</div>
<p class="settings-note">{m.sys_calendar_note()}</p>

<h3 class="caps-label settings-group-label">{m.sys_shown_reminders()}</h3>
<div class="settings-group" data-setting-id="reminders-selection">
  {#if availableReminderLists.sources.length === 0}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-check-circle-outline" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{availableReminderLists.loading ? m.sys_reminder_lists_loading() : m.sys_reminder_lists_none()}</span>
        <span class="settings-row-sub">{availableReminderLists.loading ? '' : m.sys_reminder_lists_hint()}</span>
      </div>
    </div>
  {:else}
    {#each availableReminderLists.sources as list (list.entityId)}
      <div class="settings-row">
        <span class="settings-cal-dot" style:background={list.color ?? 'var(--color-text-tertiary)'}></span>
        <div class="settings-row-text">
          <span class="settings-row-label">{list.name}</span>
          <span class="settings-row-sub num">{list.entityId}</span>
        </div>
        <button class="settings-switch pressable" type="button" role="switch"
                aria-checked={reminderSelection.includes(list.entityId)}
                aria-label="Erinnerungsliste {list.name} anzeigen"
                onclick={() => toggleReminderList(list.entityId)}>
          <span class="settings-switch-knob"></span>
        </button>
      </div>
    {/each}
  {/if}
</div>
<p class="settings-note">{m.sys_reminder_note()}</p>
