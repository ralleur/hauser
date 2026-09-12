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
  import SettingsCardHead from './SettingsCardHead.svelte';
  import {
    MOMENT_HOLIDAY_KEYS,
    selectedMomentHolidays,
    setSelectedMomentHolidays,
    type MomentHolidayKey,
  } from '../../state/moment-holidays.ts';
  import { momentHolidayLabel } from '../../state/moment-copy.ts';
  import { openSetting } from '../../state/settings.svelte.ts';

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

  /* Feste Tage der Kalendermomente: die Auswahl gilt für den ganzen Haushalt. */
  let holidaySelection = $state<MomentHolidayKey[]>(selectedMomentHolidays());

  function toggleHoliday(key: MomentHolidayKey): void {
    const next = holidaySelection.includes(key)
      ? holidaySelection.filter((entry) => entry !== key)
      : MOMENT_HOLIDAY_KEYS.filter((entry) => entry === key || holidaySelection.includes(entry));
    holidaySelection = next;
    setSelectedMomentHolidays(next);
  }

  function toggleReminderList(entityId: string): void {
    const next = reminderSelection.includes(entityId)
      ? reminderSelection.filter((id) => id !== entityId)
      : [...reminderSelection, entityId];
    reminderSelection = next;
    setSelectedReminderListIds(next);
  }
</script>

<div class="settings-group" data-setting-id="calendar-selection">
  <SettingsCardHead icon="i-calendar" tint="cool" title={m.sys_shown_calendars()} />
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
    <!-- Abkürzung: das iCloud-Konto wird unter Verbindungen · Dienste
         angelegt — hier sucht man es sonst vergeblich (Owner 2026-09-12). -->
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-cloud-outline" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{m.settings_entry_icloud_setup_label()}</span>
        <span class="settings-row-sub">{m.sys_calendar_icloud_shortcut_hint()}</span>
      </div>
      <button class="secondary-btn pressable" type="button" onclick={() => openSetting('icloud-setup')}>{m.sys_calendar_icloud_shortcut_open()}</button>
    </div>
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

<div class="settings-group" data-setting-id="reminders-selection">
  <SettingsCardHead icon="i-check-circle-outline" tint="cool" title={m.sys_shown_reminders()} />
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

<div class="settings-group" data-setting-id="moment-holidays">
  <SettingsCardHead icon="i-calendar" tint="warm" title={m.sys_moment_days()} />
  {#each MOMENT_HOLIDAY_KEYS as key (key)}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-calendar" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{momentHolidayLabel(key)}</span>
      </div>
      <button class="settings-switch pressable" type="button" role="switch"
              aria-checked={holidaySelection.includes(key)}
              aria-label={momentHolidayLabel(key)}
              onclick={() => toggleHoliday(key)}>
        <span class="settings-switch-knob"></span>
      </button>
    </div>
  {/each}
</div>
<p class="settings-note">{m.sys_moment_days_note()}</p>
