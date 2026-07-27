<script lang="ts">
  import { familyCalendar, refreshFamilyCalendar } from '../../state/calendar.svelte.ts';
  import { projectPhoneAgenda } from '../../state/phone-calendar.ts';

  const days = $derived(projectPhoneAgenda(familyCalendar.events));
  const updatedLabel = $derived(familyCalendar.updatedAt
    ? `Aktualisiert ${new Date(familyCalendar.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    : 'Noch nicht aktualisiert');

  let { titleAnchor = $bindable() }: { titleAnchor?: HTMLHeadingElement } = $props();
</script>

<main class="phone-calendar" aria-labelledby="phone-calendar-title">
  <header class="phone-calendar-header">
    <div>
      <h1 bind:this={titleAnchor} id="phone-calendar-title" tabindex="-1">Kalender</h1>
      <p>{updatedLabel}{familyCalendar.loading ? ' · Wird aktualisiert' : ''}</p>
    </div>
    <button type="button" aria-label="Kalender aktualisieren" disabled={familyCalendar.loading} onclick={() => refreshFamilyCalendar()}>
      {familyCalendar.loading ? 'Lädt …' : 'Aktualisieren'}
    </button>
  </header>

  {#if familyCalendar.error}
    <p class="phone-calendar-status is-error" role="status">Letzte bekannte Termine</p>
  {/if}

  {#if days.length === 0}
    <p class="phone-calendar-empty">Keine kommenden Termine</p>
  {:else}
    <div class="phone-calendar-days">
      {#each days as day (day.key)}
        <section aria-labelledby={`phone-calendar-day-${day.key}`}>
          <h2 id={`phone-calendar-day-${day.key}`}>{day.today ? `Heute · ${day.label}` : day.label}</h2>
          <ul>
            {#each day.events as event (event.renderKey)}
              <li class:is-running={event.running}>
                <p class="phone-calendar-time">
                  {#if event.running}<strong>Läuft jetzt</strong><span aria-hidden="true"> · </span>{/if}{event.time}
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
