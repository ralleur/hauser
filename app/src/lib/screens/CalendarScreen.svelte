<script lang="ts">
  import { tick } from 'svelte';
  import { familyCalendar } from '../state/calendar.svelte.ts';
  import { projectCalendarWeeks, weekdayLabels } from '../state/calendar.ts';
  import { postitStyle } from '../state/reminder-persons.ts';

  import { m } from '../../paraglide/messages.js';
  /* Ein Blatt, keine Kopfzeile mit Steuerung (R17): Der Monat läuft mit, sonst
     nichts. Aktualisiert wird im Hintergrund (Intervall, Sichtbarkeit,
     Verbindung); eine Uhrzeit dazu und ein Knopf wären Steuerung auf Papier. */
  const weeks = $derived(projectCalendarWeeks(familyCalendar.events));

  /* Die Kopfzeile steht außerhalb des Scrollbereichs (R17): Der Sprung zur
     laufenden Woche rechnet dann nur mit dem Blatt selbst, nicht mit einer
     Kopfzeilenhöhe, die sich zwischen Aufbau und Schrift noch ändert. */
  let scrollEl = $state<HTMLElement>();
  /* Monat der obersten sichtbaren Woche — trägt die mitscrollende Überschrift.
     Startwert: der Monat der aktuellen Woche, bis der erste Scroll misst. */
  let currentMonth = $state('');

  /* Beim ersten Sichtbarwerden auf die aktuelle Woche springen (Vergangenheit
     liegt dann oberhalb, per Wischen nach unten erreichbar). Nur einmal — spätere
     5-Minuten-Refreshes sollen die Scrollposition nicht zurückreißen. Der Screen
     ist bis zum Tab-Wechsel `display:none`; erst dann sind Layoutmaße gültig,
     darum triggert ein IntersectionObserver statt eines Mount-Effects. */
  let centered = false;
  /* Seit die Zeilen nach Inhalt wachsen (R17), verschiebt sich die laufende
     Woche, sobald Termine nachkommen. Solange niemand das Blatt angefasst
     hat, zieht der Sprung nach; danach gehört die Position dem Menschen. */
  let touched = false;
  let programmatic = false;
  function centerOnCurrentWeek() {
    if (centered || !scrollEl) return;
    const current = scrollEl.querySelector<HTMLElement>('.cal-week.is-current');
    if (!current || !scrollEl.clientHeight) return;
    const next = current.offsetTop;
    if (scrollEl.scrollTop !== next) programmatic = true;
    scrollEl.scrollTop = next;
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
  $effect(() => {
    void weeks;
    if (touched) return;
    centered = false;
    void tick().then(centerOnCurrentWeek);
  });

  /* Scroll-Spy: die Woche direkt unter der klebenden Kopfzeile bestimmt den
     angezeigten Monat. offsetTop ist relativ zum positionierten Scroll-Container. */
  let raf = 0;
  function updateMonth() {
    if (!scrollEl) return;
    const line = scrollEl.scrollTop + 1;
    const rows = scrollEl.querySelectorAll<HTMLElement>('.cal-week');
    let label = rows[0]?.dataset.month ?? '';
    for (const row of rows) {
      if (row.offsetTop <= line) label = row.dataset.month ?? label;
      else break;
    }
    currentMonth = label;
  }
  function onScroll() {
    /* Der eigene Sprung zählt nicht als Berührung; alles andere schon. */
    if (programmatic) programmatic = false;
    else touched = true;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; updateMonth(); });
  }
</script>

<div class="calendar-screen">
  <header class="cal-header">
    <h1 class="cal-month">{currentMonth}</h1>
    <div class="cal-weekdays" aria-hidden="true">
      {#each weekdayLabels() as label}<span>{label}</span>{/each}
    </div>
  </header>

  {#if familyCalendar.error}
    <p class="calendar-error" role="status">{familyCalendar.error}</p>
  {/if}

  <div class="cal-scroll" bind:this={scrollEl} onscroll={onScroll}>
  <div class="cal-grid" aria-label={m.calendar_month_view()}>
    {#each weeks as week (week.key)}
      <section class="cal-week" class:is-current={week.isCurrent} class:is-empty={week.isEmpty} data-month={week.monthLabel}>
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
               style={postitStyle(bar.color ?? '')} title={bar.title}>
            <span class="cal-bar-title">{bar.title}</span>
          </div>
        {/each}
        <!-- Eintägige Termine je Spalte — unterhalb aller Balken-Lanes -->
        {#each week.days as day, col (day.key)}
          <div class="cal-day-events" class:is-past={day.isPast}
               style:grid-column={col + 1} style:grid-row={week.laneCount + 2}>
            <!-- Zwei Gewichte aus den Daten, nicht aus Heuristik (R17): Ein
                 ganztägiger Termin (Geburtstag, Ferien, Feiertag) ist ein
                 Zettel aus Papier; ein Termin mit Uhrzeit ist Tinte, seine
                 Uhrzeit trägt die Farbe der Quelle. -->
            {#each day.events as event (event.id)}
              {#if event.allDay}
                <div class="cal-event is-paper" class:is-now={event.now} style={postitStyle(event.color ?? '')}>
                  <span class="cal-event-title">{event.title}</span>
                </div>
              {:else}
                <div class="cal-event" class:is-accent={event.now || event.isNext} style={postitStyle(event.color ?? '')}>
                  {#if event.now}<span class="cal-event-time is-now num">{m.calendar_now()}</span>
                  {:else}<span class="cal-event-time num">{event.time}</span>{/if}
                  <span class="cal-event-title">{event.title}</span>
                </div>
              {/if}
            {/each}
            {#if day.more}<div class="cal-day-more num">+{day.more}</div>{/if}
          </div>
        {/each}
      </section>
    {/each}
  </div>
  </div>
</div>
