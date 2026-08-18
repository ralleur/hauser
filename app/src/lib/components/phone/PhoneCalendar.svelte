<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { intlLocale } from '../../state/locale.svelte.ts';
  import { familyCalendar, refreshFamilyCalendar } from '../../state/calendar.svelte.ts';
  import { projectPhoneAgenda } from '../../state/phone-calendar.ts';

  const days = $derived(projectPhoneAgenda(familyCalendar.events));
  const updatedLabel = $derived(familyCalendar.updatedAt
    ? m.phone_updated_at({
      time: new Date(familyCalendar.updatedAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }),
    })
    : m.phone_not_updated_yet());

  let { titleAnchor = $bindable() }: { titleAnchor?: HTMLHeadingElement } = $props();
</script>

<main class="phone-calendar" aria-labelledby="phone-calendar-title">
  <header class="phone-calendar-header">
    <div>
      <h1 bind:this={titleAnchor} id="phone-calendar-title" tabindex="-1">{m.phone_calendar_title()}</h1>
      <p>{updatedLabel}{familyCalendar.loading ? ` · ${m.phone_updating()}` : ''}</p>
    </div>
    <button type="button" aria-label={m.phone_calendar_refresh()} disabled={familyCalendar.loading} onclick={() => refreshFamilyCalendar()}>
      {familyCalendar.loading ? m.phone_loading_short() : m.phone_refresh()}
    </button>
  </header>

  {#if familyCalendar.error}
    <p class="phone-calendar-status is-error" role="status">{m.phone_calendar_stale()}</p>
  {/if}

  {#if days.length === 0}
    <p class="phone-calendar-empty">{m.phone_calendar_empty()}</p>
  {:else}
    <div class="phone-calendar-days">
      {#each days as day (day.key)}
        <section aria-labelledby={`phone-calendar-day-${day.key}`}>
          <h2 id={`phone-calendar-day-${day.key}`}>{day.today ? m.phone_today_prefix({ label: day.label }) : day.label}</h2>
          <ul>
            {#each day.events as event (event.renderKey)}
              <li class:is-running={event.running}>
                <p class="phone-calendar-time">
                  {#if event.running}<strong>{m.phone_event_running()}</strong><span aria-hidden="true"> · </span>{/if}{event.time}
                  {#if event.span}<span> · {event.span}</span>{/if}
                </p>
                <p class="phone-calendar-title">{event.title}</p>
                {#if event.location}<p class="phone-calendar-location">{event.location}</p>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</main>
