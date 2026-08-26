<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { appState } from '../state/app.svelte.ts';
  import { ambientRequest, setAmbientActive } from '../state/ambient.svelte.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { closeDeviceDetail } from '../state/overlay.svelte.ts';
  import { roomTemperature } from '../state/commands.ts';
  import { fmtTemp } from '../format.ts';
  import { familyCalendar, refreshFamilyCalendar } from '../state/calendar.svelte.ts';
  import { projectAmbientWeek } from '../state/calendar.ts';
  import { reminders, refreshReminders } from '../state/reminders.svelte.ts';
  import { projectPostits } from '../state/reminders.ts';
  import { shopping, refreshShopping } from '../state/shopping.svelte.ts';
  import { projectShoppingSections } from '../state/shopping.ts';
  import { shoppingConfig, shoppingItemOrder } from '../state/shopping-settings.svelte.ts';
  import { nav, showScreen, type ScreenId } from '../state/nav.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { generateAmbientCopy } from '../state/ambient-copy.ts';
  import { ambientCopy, refreshAmbientCopy } from '../state/ambient-copy.svelte.ts';
  import { outdoor, indoor, refreshWeather, recordIndoorTemp } from '../state/weather.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { localeState } from '../state/locale.svelte.ts';
  import { isDeepNightHour } from '../state/ambient-deep-night.ts';
  import type { TempTrend } from '../state/weather.ts';
  import Icon from './Icon.svelte';

  /* Trend → Pfeil (Wunsch: oben = steigt, rechts = gleich, links = fällt) und
     Vorlese-Label. null, solange kein Vergleichswert vorliegt → kein Pfeil. */
  function trendIcon(t: TempTrend | null): string | null {
    return t === 'rising' ? 'i-arrow-up' : t === 'falling' ? 'i-arrow-left'
      : t === 'steady' ? 'i-arrow-right' : null;
  }
  function trendLabel(t: TempTrend | null): string {
    return t === 'rising' ? ', steigt' : t === 'falling' ? ', fällt'
      : t === 'steady' ? ', gleichbleibend' : '';
  }

  /* Aktivierung nach Timeout ohne Touch (Startwert 3 min; Test-Override
     ?idle=<Sekunden>), Touch weckt zurück zum letzten Screen (Fade ≤300 ms). */
  const idleParam = parseFloat(new URLSearchParams(location.search).get('idle') ?? '');
  const idleTimeoutMs = idleParam > 0 ? idleParam * 1000 : 3 * 60 * 1000;
  const forceDeepNight = new URLSearchParams(location.search).get('deepnight') === '1';

  let active = $state(false);
  let deepNightPreview = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let shiftTimer: ReturnType<typeof setInterval> | undefined;
  let contentEl: HTMLElement;
  let clockEl = $state<HTMLElement>();

  function showAmbient(previewDeepNight = false) {
    if (active) return;
    // Laufende Wiedergabe hemmt den Idle-Timeout — Film schauen ist kein
    // Leerlauf (Phase 4 übernimmt das die Player-Aktivität)
    if (!previewDeepNight && appState.playback?.playing) { armIdleTimer(); return; }
    deepNightPreview = previewDeepNight;
    active = true;
    setAmbientActive(true);
    void refreshFamilyCalendar();
    void refreshReminders();
    void refreshShopping();
    void refreshWeather();
    closeDeviceDetail(true);  // Detail-Kontext verfällt im Ruhezustand

    // LCD-Schonung: Pixel-Shift alle 2,5 min (transform-only, ±8px)
    shiftTimer = setInterval(() => {
      const x = Math.round(Math.random() * 16 - 8);
      const y = Math.round(Math.random() * 16 - 8);
      contentEl.style.transform = `translate(${x}px, ${y}px)`;
    }, 150_000);
  }

  function wakeAmbient() {
    if (!active) return;
    active = false;
    setAmbientActive(false);
    deepNightPreview = false;
    clearInterval(shiftTimer);
    contentEl.style.transform = '';
  }

  /* ── Touch-Zonen beim Entsperren: der Standby ist eine Wandtafel — wer auf
     das Wochenband tippt, will zum Kalender; wer auf Zettel (Post-its oder
     Einkaufsliste) tippt, zur Notizen-Seite; die freie Mitte führt nach Home
     mit dem Wohnzimmer als Default-Raum. ── */
  function wakeTo(e: PointerEvent) {
    if (!active) return;
    if (deepNightPreview) {
      wakeAmbient();
      return;
    }
    const hit = e.target as HTMLElement;
    const target: ScreenId = hit.closest('.ambient-week') ? 'calendar'
      : hit.closest('.ambient-postits, .ambient-shopping') ? 'notes'
      : 'home';

    if (target === 'home' && appState.rooms.some((room) => room.id === 'wohnzimmer')) {
      appState.currentRoom = 'wohnzimmer';
      const slot = layoutManager.preview.slots[0];
      if (slot) layoutManager.setAppliedRoom(slot.id, 'wohnzimmer');
    }
    if (nav.screen !== target) showScreen(target);
    wakeAmbient();
  }

  function armIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(showAmbient, idleTimeoutMs);
  }

  $effect(() => {
    armIdleTimer();
    return () => { clearTimeout(idleTimer); clearInterval(shiftTimer); setAmbientActive(false); };
  });

  /* Manueller Standby (B-06): der Status-Bar-Button erhöht ambientRequest.seq —
     gleicher Pfad wie der Timeout (inkl. Playback-Hemmung und Pixel-Shift). */
  let seenStandbySeq = 0;
  $effect(() => {
    if (ambientRequest.seq <= seenStandbySeq) return;
    seenStandbySeq = ambientRequest.seq;
    showAmbient(ambientRequest.mode === 'deep-night-preview');
  });

  /* Minutenwechsel ist der einzige Motion-Moment (Fade --duration-normal) —
     auch beim Einschalten des Ambient-Screens einmal ausgelöst */
  $effect(() => {
    void clock.time;
    if (!active || !clockEl) return;
    clockEl.classList.remove('is-tick');
    void clockEl.offsetWidth;
    clockEl.classList.add('is-tick');
  });

  /* Kerndaten: Referenzraum-Temperatur (Innen, live, Fallback-Kette) +
     Sicherheitsstatus (docs/07). Die Sensormeldung erscheint NUR, wenn ein
     zugewiesener Sensor etwas meldet — kein „Alles ruhig" mehr im Ruhezustand. */
  const refTemp = $derived(roomTemperature('wohnzimmer'));
  const openCount = $derived(appState.rooms.filter((r) => r.windowOpen).length);
  const safety = $derived(
    openCount === 0 ? null : openCount === 1 ? 'Fenster offen' : `${openCount} Fenster offen`);

  /* Außentemperatur Köln (Open-Meteo): beim Mount holen und alle 15 min auffrischen. */
  $effect(() => {
    void refreshWeather();
    const id = setInterval(() => void refreshWeather(), 15 * 60 * 1000);
    return () => clearInterval(id);
  });

  /* Innen-Trend aus der Live-Raumtemperatur sampeln (HA liefert keinen Trend). */
  $effect(() => { recordIndoorTemp(refTemp); });
  const ambientWeek = $derived.by(() => {
    void clock.time;
    return projectAmbientWeek(familyCalendar.events);
  });
  const weekHasEvents = $derived(ambientWeek.some((day) => day.events.length > 0));
  const deepNight = $derived(
    deepNightPreview
      || (settingsValues.ambientDeepNight && (forceDeepNight || isDeepNightHour(clock.hours))),
  );

  /* iPadOS malt die Fläche außerhalb seines dynamischen Viewports aus dem
     Dokument-Hintergrund. Während Deep Night muss deshalb auch diese Unterlage
     schwarz sein, nicht nur der fixed Ambient-Layer. */
  $effect(() => {
    document.documentElement.dataset.ambientDeepNight = String(active && deepNight);
    return () => { delete document.documentElement.dataset.ambientDeepNight; };
  });

  /* Offene iCloud-Erinnerungen als Notizzettel — bewusst in der freien oberen
     rechten Ecke, außerhalb des zentrierten Inhalts, damit sie Uhr, Begrüßung
     und Wochenband nicht überlagern. */
  const postits = $derived.by(() => {
    void clock.time;
    return projectPostits(reminders.items);
  });

  /* Zentrale Einkaufsliste: links als weißlicher Notizzettel-
     Streifen — nur Läden mit offenen Items, ohne Checkboxen. */
  const shoppingSections = $derived(projectShoppingSections(shopping.sections, {
    stores: shoppingConfig.stores,
    itemOrder: shoppingItemOrder(shopping.sections),
  }));

  /* Hybride Hero-Zeile: sofort lokaler Fallback bzw. Cache, während Ollama nur
     bei relevanten Kontextänderungen best-effort im Hintergrund formuliert. */
  const heroCopy = $derived.by(() => {
    if (!settingsValues.ambientHeroText) return [];
    void clock.time;
    void localeState.current;
    return ambientCopy.locale === localeState.current && ambientCopy.lines.length
      ? ambientCopy.lines
      : generateAmbientCopy(familyCalendar.events, outdoor, new Date(), localeState.current).lines;
  });
  $effect(() => {
    if (!settingsValues.ambientHeroText) return;
    void clock.time;
    void familyCalendar.events;
    void outdoor.temp;
    void outdoor.condition;
    void outdoor.tempDelta;
    void outdoor.windSpeed;
    refreshAmbientCopy(familyCalendar.events, outdoor, new Date());
  });
</script>

<!-- Der weckende Tap trifft nur den Ambient-Layer (liegt über allem) —
     keine versehentliche Bedienung des darunterliegenden Screens.
     Der globale Capture-Listener armiert den Idle-Timer bei jedem Touch. -->
<svelte:document onpointerdowncapture={armIdleTimer} />

<!-- ── Ambient / Idle (docs/07 Screen 9): im Ruhezustand ist das Panel kein
     UI, sondern eine Uhr an der Wand. Statisch bis auf den Minutenwechsel.
     Der weckende Tap wählt nach Zone: Wochenband → Kalender, Zettel →
     Notizen, Mitte → Home (Wohnzimmer). ── -->
<div class="ambient" class:is-on={active} aria-hidden={active ? 'false' : 'true'}
     class:has-side-notes={shoppingSections.length > 0 || postits.items.length > 0}
     class:deep-night={deepNight}
     onpointerdown={wakeTo}>
  <div class="ambient-content" class:without-hero={!settingsValues.ambientHeroText && !deepNight}
       class:deep-night-content={deepNight} bind:this={contentEl}>
    {#if deepNight}
      <div class="ambient-clock num" bind:this={clockEl}>{clock.time}</div>
    {:else}
    <!-- Hero-Zeile: höchstens zwei bewusst getrennte Kommentarzeilen. -->
    {#if settingsValues.ambientHeroText}
      <p class="ambient-greeting ambient-copy" aria-label="Kommentar zum heutigen Tag">
        {#each heroCopy as line, index}
          {#if index > 0}<br />{/if}{line}
        {/each}
      </p>
    {/if}
    <div class="ambient-clock num" bind:this={clockEl}>{clock.time}</div>
    <div class="ambient-date">{clock.date}</div>

    <!-- Klima-/Statuszeile: Außentemp Köln + Innentemp, je mit Piktogramm
         (Sonne = außen, Haus = innen) und Trendpfeil (oben/rechts/links =
         steigt/gleich/fällt). Die Sensormeldung tritt nur hinzu, wenn ein
         Sensor etwas meldet. Ganz leer → die Zeile entfällt. -->
    {#if outdoor.temp !== null || refTemp !== null || safety}
      <div class="ambient-status">
        {#if outdoor.temp !== null}
          {@const arrow = trendIcon(outdoor.trend)}
          <span class="ambient-temp" aria-label={`Außen Köln ${fmtTemp(outdoor.temp)} Grad${trendLabel(outdoor.trend)}`}>
            <Icon name="i-sun-thermometer-outline" cls="ambient-temp-icon" />
            <span class="num">{fmtTemp(outdoor.temp)}°</span>
            {#if arrow}<Icon name={arrow} cls="ambient-temp-trend" />{/if}
          </span>
        {/if}
        {#if refTemp !== null}
          {@const arrow = trendIcon(indoor.trend)}
          <span class="ambient-temp" aria-label={`Innen ${fmtTemp(refTemp)} Grad${trendLabel(indoor.trend)}`}>
            <Icon name="i-thermometer" cls="ambient-temp-icon" />
            <span class="num">{fmtTemp(refTemp)}°</span>
            {#if arrow}<Icon name={arrow} cls="ambient-temp-trend" />{/if}
          </span>
        {/if}
        {#if safety}
          <span class="ambient-status-msg">{safety}</span>
        {/if}
      </div>
    {/if}
    {/if}
  </div>

  <!-- Wochenband: die kommenden 7 Tage als ruhige, gleichbreite Spalten — heute
       ganz links; leere Tage behalten ihre Spalte, damit die Woche als Raster
       lesbar bleibt. Bewusst außerhalb von .ambient-content: es sitzt fest am
       unteren Bildschirmrand, während Uhr & Begrüßung mittig zentriert bleiben. -->
  {#if weekHasEvents && !deepNight}
    <section class="ambient-week" aria-label="Familientermine der kommenden Tage">
      {#each ambientWeek as day (day.key)}
        <div class="ambient-week-day">
          <header class="ambient-week-head">
            <span class="ambient-week-name">{day.weekday}</span>
            <span class="ambient-week-num num">{day.dayOfMonth}</span>
          </header>
          {#each day.events as event (event.id)}
            <div class="ambient-week-event">
              <span class="ambient-week-time num" class:is-accent={event.emphasis !== null}>
                {event.emphasis === 'now' ? `Jetzt · ${event.time}` : event.time}
              </span>
              <span class="ambient-week-title">{event.title}</span>
            </div>
          {/each}
          {#if day.more}<div class="ambient-week-more">{m.ambient_more_count({ count: day.more })}</div>{/if}
          {#if !day.events.length}<div class="ambient-week-empty" aria-hidden="true">—</div>{/if}
        </div>
      {/each}
    </section>
  {/if}

  <!-- Post-its: offene Erinnerungen als gelbe Notizzettel in der freien oberen
       rechten Ecke. Bewusst außerhalb von .ambient-content — sie liegen am Rand
       und überlagern die zentrale Information (Uhr, Begrüßung, Woche) nicht. -->
  {#if postits.items.length && !deepNight}
    <aside class="ambient-postits" aria-label="Offene Erinnerungen">
      {#each postits.items as note (note.id)}
        <div class="ambient-postit postit-{note.person}" class:is-overdue={note.overdue}>
          <span class="ambient-postit-person">{note.personLabel}</span>
          <p class="ambient-postit-title">{note.title}</p>
          {#if note.dueLabel}
            <span class="ambient-postit-due num">{note.dueLabel}</span>
          {/if}
        </div>
      {/each}
      {#if postits.more}
        <div class="ambient-postit-more num">{m.ambient_more_count({ count: postits.more })}</div>
      {/if}
    </aside>
  {/if}

  <!-- Einkaufsliste: ein langer, weißlicher Zettel in der freien oberen linken
       Ecke — das Gegenstück zu den Post-its rechts. Immer der Stand der
       zentralen Einkaufsliste, ohne Checkboxen, mit den Laden-Überschriften.
       Leicht gekippt wie angepinntes Papier; nachts gedämpft. -->
  {#if shoppingSections.length && !deepNight}
    <aside class="ambient-shopping" aria-label={m.ambient_shopping_title()}>
      <div class="ambient-shopping-paper">
        <h3 class="ambient-shopping-title">{m.ambient_shopping_title()}</h3>
        {#each shoppingSections as section (section.id)}
          <div class="ambient-shopping-store">{section.title}</div>
          <ul class="ambient-shopping-items">
            {#each section.items as item (item.id)}
              <li>{item.title}</li>
            {/each}
          </ul>
        {/each}
      </div>
    </aside>
  {/if}
</div>
