<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { familyCalendar, refreshFamilyCalendar } from '../state/calendar.svelte.ts';
  import { projectCalendarWeeks, WEEKDAY_LABELS } from '../state/calendar.ts';

  import { m } from '../../paraglide/messages.js';
  const weeks = $derived(projectCalendarWeeks(familyCalendar.events));
  const updatedLabel = $derived(familyCalendar.updatedAt
    ? `Aktualisiert ${new Date(familyCalendar.updatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    : m.calendar_not_updated());

  let scrollEl = $state<HTMLElement>();
  let headerEl = $state<HTMLElement>();
  /* Monat der obersten sichtbaren Woche — trägt die mitscrollende Überschrift.
     Startwert: der Monat der aktuellen Woche, bis der erste Scroll misst. */
  let currentMonth = $state('');

  /* Beim ersten Sichtbarwerden auf die aktuelle Woche springen (Vergangenheit
     liegt dann oberhalb, per Wischen nach unten erreichbar). Nur einmal — spätere
     5-Minuten-Refreshes sollen die Scrollposition nicht zurückreißen. Der Screen
     ist bis zum Tab-Wechsel `display:none`; erst dann sind Layoutmaße gültig,
     darum triggert ein IntersectionObserver statt eines Mount-Effects. */
  let centered = false;
  function centerOnCurrentWeek() {
    if (centered || !scrollEl || !headerEl) return;
    const current = scrollEl.querySelector<HTMLElement>('.cal-week.is-current');
    if (!current || !scrollEl.clientHeight) return;
    scrollEl.scrollTop = current.offsetTop - headerEl.offsetHeight;
    centered = true;
    updateMonth();
  }
  $effect(() => {
    if (!scrollEl) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) centerOnCurrentWeek();
    });
    io.observe(scrollEl);
    return () => io.disconnect();
  });

  /* Scroll-Spy: die Woche direkt unter der klebenden Kopfzeile bestimmt den
     angezeigten Monat. offsetTop ist relativ zum positionierten Scroll-Container. */
  let raf = 0;
  function updateMonth() {
    if (!scrollEl || !headerEl) return;
    const line = scrollEl.scrollTop + headerEl.offsetHeight + 1;
    const rows = scrollEl.querySelectorAll<HTMLElement>('.cal-week');
    let label = rows[0]?.dataset.month ?? '';
    for (const row of rows) {
      if (row.offsetTop <= line) label = row.dataset.month ?? label;
      else break;
    }
    currentMonth = label;
  }
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; updateMonth(); });
  }
</script>

<div class="calendar-screen" bind:this={scrollEl} onscroll={onScroll}>
  <header class="cal-header" bind:this={headerEl}>
    <div class="cal-titlebar">
      <h1 class="cal-month">{currentMonth}</h1>
      <div class="cal-actions">
        <span class="cal-updated">{updatedLabel}</span>
        <button class="calendar-refresh pressable" type="button" aria-label={m.calendar_refresh()}
                disabled={familyCalendar.loading} onclick={() => refreshFamilyCalendar()}>
          <Icon name="i-refresh" cls="icon icon-md" />
        </button>
      </div>
    </div>
    <div class="cal-weekdays" aria-hidden="true">
      {#each WEEKDAY_LABELS as label}<span>{label}</span>{/each}
    </div>
  </header>

  {#if familyCalendar.error}
    <p class="calendar-error" role="status">Letzte bekannte Termine · {familyCalendar.error}</p>
  {/if}

  <div class="cal-grid" aria-label={m.calendar_month_view()}>
    {#each weeks as week (week.key)}
      <section class="cal-week" class:is-current={week.isCurrent} data-month={week.monthLabel}>
        <!-- Tageskopf (Zahl + Monatskürzel am Ersten) — Grid-Reihe 1 -->
        {#each week.days as day, col (day.key)}
          <header class="cal-day-head" class:is-past={day.isPast} style:grid-column={col + 1}>
            {#if day.monthShort}<span class="cal-day-month">{day.monthShort}</span>{/if}
            <span class="cal-day-num num" class:is-today={day.isToday}>{day.dayOfMonth}</span>
          </header>
        {/each}
        <!-- Mehrtägige Termine als gespannte Balken — Reihen 2 … 1+laneCount -->
        {#each week.bars as bar (bar.id)}
          <div class="cal-bar" class:is-now={bar.now} class:is-past={bar.isPast}
               class:continues-left={bar.continuesLeft} class:continues-right={bar.continuesRight}
               style:grid-column="{bar.startCol + 1} / span {bar.span}" style:grid-row={bar.lane + 2}
               style:--bar-color={bar.color ?? undefined} title={bar.title}>
            <span class="cal-bar-title">{bar.title}</span>
          </div>
        {/each}
        <!-- Eintägige Termine je Spalte — unterhalb aller Balken-Lanes -->
        {#each week.days as day, col (day.key)}
          <div class="cal-day-events" class:is-past={day.isPast}
               style:grid-column={col + 1} style:grid-row={week.laneCount + 2}>
            {#each day.events as event (event.id)}
              <div class="cal-event" class:is-accent={event.now || event.isNext}>
                <span class="cal-event-mark" style:background={event.color ?? undefined}></span>
                <span class="cal-event-body">
                  {#if event.now}<span class="cal-event-time is-now num">{m.calendar_now()}</span>
                  {:else if event.time}<span class="cal-event-time num">{event.time}</span>{/if}
                  <span class="cal-event-title">{event.title}</span>
                </span>
              </div>
            {/each}
            {#if day.more}<div class="cal-day-more num">+{day.more}</div>{/if}
          </div>
        {/each}
      </section>
    {/each}
  </div>
</div>
