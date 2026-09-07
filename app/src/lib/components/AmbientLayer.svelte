<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { appState } from '../state/app.svelte.ts';
  import { ambientRequest, setAmbientActive } from '../state/ambient.svelte.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { closeDeviceDetail } from '../state/overlay.svelte.ts';
  import { roomPresence, roomTemperature, roomWindowOpen } from '../state/commands.ts';
  import { fmtTemp } from '../format.ts';
  import { familyCalendar, refreshFamilyCalendar } from '../state/calendar.svelte.ts';
  import { projectAmbientWeek } from '../state/calendar.ts';
  import { reminders, refreshReminders } from '../state/reminders.svelte.ts';
  import { projectPostits } from '../state/reminders.ts';
  import { postitStyle } from '../state/reminder-persons.ts';
  import { personColorId, personDisplayLabel, reminderPersons } from '../state/reminder-persons.svelte.ts';
  import { everyoneOut, greetedPersonId, watchPresence } from '../state/presence.svelte.ts';
  import { shopping, refreshShopping } from '../state/shopping.svelte.ts';
  import { projectShoppingSections } from '../state/shopping.ts';
  import { shoppingConfig, shoppingItemOrder } from '../state/shopping-settings.svelte.ts';
  import { nav, showScreen, type ScreenId } from '../state/nav.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { generateAmbientCopy } from '../state/ambient-copy.ts';
  import { ambientCopy, refreshAmbientCopy } from '../state/ambient-copy.svelte.ts';
  import { currentMoment, initMoments } from '../state/moments.svelte.ts';
  import { momentLine } from '../state/moment-copy.ts';
  import { outdoor, indoor, refreshWeather, recordIndoorTemp } from '../state/weather.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { ambientMap, ensureAmbientMapStatus } from '../state/ambient-map.svelte.ts';
  import { localeState } from '../state/locale.svelte.ts';
  import { isDeepNightHour } from '../state/ambient-deep-night.ts';
  import HeroWeatherLayer from './HeroWeatherLayer.svelte';
  import { heroWeatherLayer, resolvedWeatherCondition } from '../state/hero-weather.ts';
  import { simulation } from '../state/simulation.svelte.ts';
  import { prefersReducedMotion } from '../motion/index.ts';
  import type { TempTrend } from '../state/weather.ts';
  import Icon from './Icon.svelte';

  /* Trend → Pfeil (oben = steigt, rechts = gleich, unten = fällt) und
     Vorlese-Label. null, solange kein Vergleichswert vorliegt → kein Pfeil. */
  function trendIcon(t: TempTrend | null): string | null {
    return t === 'rising' ? 'i-arrow-up' : t === 'falling' ? 'i-arrow-down'
      : t === 'steady' ? 'i-arrow-right' : null;
  }
  function trendLabel(t: TempTrend | null): string {
    return t === 'rising' ? m.ambient_trend_rising() : t === 'falling' ? m.ambient_trend_falling()
      : t === 'steady' ? m.ambient_trend_steady() : '';
  }

  /* Aktivierung nach Timeout ohne Touch (Wartezeit aus den Einstellungen,
     Test-Override ?idle=<Sekunden>), Touch weckt zurück zum letzten Screen
     (Fade ≤300 ms). `null` heißt: kein automatischer Standby — dann führt nur
     noch der Knopf in den Einstellungen dorthin. */
  const idleParam = parseFloat(new URLSearchParams(location.search).get('idle') ?? '');
  const idleTimeoutMs = $derived(
    idleParam > 0
      ? idleParam * 1000
      : settingsValues.standbyAfterMinutes === null
        ? null
        : settingsValues.standbyAfterMinutes * 60_000,
  );
  const forceDeepNight = new URLSearchParams(location.search).get('deepnight') === '1';

  let active = $state(false);
  let deepNightPreview = $state(false);
  /* Vorschau aus den Einstellungen: zeigt den Stadtplan auch bei ausgeschaltetem
     Schalter und weckt an Ort und Stelle zurück, statt nach Home zu navigieren. */
  let settingsPreview = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let shiftTimer: ReturnType<typeof setInterval> | undefined;
  let contentEl: HTMLElement;
  let clockEl = $state<HTMLElement>();

  function showAmbient(previewDeepNight = false, fromSettings = false) {
    if (active) return;
    // Laufende Wiedergabe hemmt den Idle-Timeout — Film schauen ist kein
    // Leerlauf (Phase 4 übernimmt das die Player-Aktivität)
    if (!previewDeepNight && !fromSettings && appState.playback?.playing) { armIdleTimer(); return; }
    deepNightPreview = previewDeepNight;
    settingsPreview = fromSettings;
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
    settingsPreview = false;
    clearInterval(shiftTimer);
    contentEl.style.transform = '';
  }

  /* ── Touch-Zonen beim Entsperren: der Standby ist eine Wandtafel — wer auf
     das Wochenband tippt, will zum Kalender; wer auf Zettel (Post-its oder
     Einkaufsliste) tippt, zur Notizen-Seite; die freie Mitte führt nach Home
     mit dem Wohnzimmer als Default-Raum. ── */
  function wakeTo(e: PointerEvent) {
    if (!active) return;
    /* Beide Vorschauen wecken an Ort und Stelle: sie wurden aus den
       Einstellungen gestartet, dorthin gehört der Benutzer zurück. Nur der
       echte Standby führt in die getippte Zone. */
    if (deepNightPreview || settingsPreview) {
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
    if (idleTimeoutMs === null) return;
    idleTimer = setTimeout(showAmbient, idleTimeoutMs);
  }

  $effect(() => {
    armIdleTimer();
    return () => { clearTimeout(idleTimer); clearInterval(shiftTimer); setAmbientActive(false); };
  });

  /* ── Präsenz und Person (Paket 8) ──
     Die Melder aus „Fenster & Bewegung" wecken das Panel; ein leeres Haus
     lässt es ganz dunkel werden; wer heimkommt, wird begrüßt. Alle drei
     Funktionen sind Opt-in, und der Auslöser bleibt bei Home Assistant —
     hier wird nur gelesen. */
  const presenceWatched = $derived(
    settingsValues.presenceAwayDark || settingsValues.presenceGreeting,
  );
  $effect(() => {
    if (!presenceWatched) return;
    return watchPresence();
  });

  const motionSomewhere = $derived(appState.rooms.some((room) => roomPresence(room.id)));
  let motionSeen = false;
  $effect(() => {
    const motion = motionSomewhere;
    const known = motionSeen;
    motionSeen = motion;
    // Erst die Flanke weckt — der erste Messwert nach dem Abo tut es nicht.
    if (motion && !known && active && settingsValues.presenceWake) wakeAmbient();
  });

  /* Leeres Haus: der Standby fällt auf Schwarz zurück. Der Tap weckt wie
     immer — nur zu sehen gibt es bis dahin nichts. */
  const awayDark = $derived(settingsValues.presenceAwayDark && everyoneOut());

  /* Begrüßung: gilt dem, der ein leeres Haus wieder gefüllt hat, und bringt
     dessen Zettel nach vorn. */
  const greetedPerson = $derived(settingsValues.presenceGreeting ? greetedPersonId() : null);
  const greetingLine = $derived(greetedPerson
    ? m.ambient_welcome_home({ name: personDisplayLabel(greetedPerson) })
    : null);

  /* Manueller Standby (B-06): der Status-Bar-Button erhöht ambientRequest.seq —
     gleicher Pfad wie der Timeout (inkl. Playback-Hemmung und Pixel-Shift). */
  let seenStandbySeq = 0;
  $effect(() => {
    if (ambientRequest.seq <= seenStandbySeq) return;
    seenStandbySeq = ambientRequest.seq;
    showAmbient(
      ambientRequest.mode === 'deep-night-preview',
      ambientRequest.mode === 'preview',
    );
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
  const openCount = $derived(appState.rooms.filter((r) => roomWindowOpen(r.id, r.windowOpen)).length);
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

  /* ── Wetter über dem Lockscreen (B-01B, Paket 9) ──
     Hier statt über dem Raumbild: die Bühne zeigt einen Innenraum, und Regen
     über dem eigenen Sofa ergibt keinen Sinn. Der Standby ist eine Wandtafel
     — was dort zieht, zieht draußen. Die Lage kommt aus derselben Messung wie
     die Klimazeile darunter; `?weather=` friert sie für die Abnahme ein.
     Deep Night zeigt weiter ausschließlich die gedämpfte Uhr. */
  const weatherLayer = $derived.by(() => {
    if (!settingsValues.ambientWeather || deepNight) return null;
    const condition = resolvedWeatherCondition(simulation.weather, location.search, outdoor.condition);
    return heroWeatherLayer(condition, outdoor.windSpeed, prefersReducedMotion());
  });

  /* ── Stadtplan-Hintergrund (docs/18 §8): rein dekorativ, gerätelokal
     eingeschaltet und nur mit fertigem Serverasset. Deep Night zeigt weiter
     ausschließlich die gedämpfte rote Uhr — dort entfällt der Layer samt
     Attribution ersatzlos. ── */
  const mapVisible = $derived(
    (settingsValues.ambientCityMap || settingsPreview)
    && !deepNight && ambientMap.assetUrl !== null,
  );

  /* Statusabruf nur bei eingeschaltetem Schalter: nach First Paint in einer
     Idle-Phase, beim Standby-Eintritt sofort. Gewartet wird nie — fehlt oder
     lädt das Asset, bleibt der Ambient-Screen exakt der bisherige (docs/18 §7.1). */
  $effect(() => {
    if (!settingsValues.ambientCityMap) return;
    ensureAmbientMapStatus({ immediate: active });
  });

  /* iPadOS malt die Fläche außerhalb seines dynamischen Viewports aus dem
     Dokument-Hintergrund. Während Deep Night muss deshalb auch diese Unterlage
     schwarz sein, nicht nur der fixed Ambient-Layer. */
  $effect(() => {
    document.documentElement.dataset.ambientDeepNight = String(active && deepNight);
    return () => { delete document.documentElement.dataset.ambientDeepNight; };
  });

  /* Offene iCloud-Erinnerungen als Notizzettel — bewusst in der freien oberen
     rechten Ecke, außerhalb des zentrierten Inhalts, damit sie Uhr, Begrüßung
     und Wochenband nicht überlagern. Wie viele Zettel hängen, entscheidet der
     Platz bis zum Wochenband, nicht eine feste Zahl: die Höhe eines Zettels
     hängt an der Titellänge, der Platz am Panelformat. */
  const POSTIT_CEILING = 12;
  let postitsEl = $state<HTMLElement | null>(null);
  let weekEl = $state<HTMLElement | null>(null);
  let postitHidden = $state(0);
  let viewportTick = $state(0);

  const postits = $derived.by(() => {
    void clock.time;
    const projected = projectPostits(reminders.items, new Date(), POSTIT_CEILING, reminderPersons.list);
    if (!greetedPerson) return projected;
    /* Wer gerade heimkommt, sieht zuerst seine eigenen Zettel — die der
       anderen rutschen dahinter, verschwinden aber nicht. */
    const own = projected.items.filter((note) => note.person === greetedPerson);
    const rest = projected.items.filter((note) => note.person !== greetedPerson);
    return { items: [...own, ...rest], more: projected.more };
  });

  /* Gemessen statt geraten: gehängt wird, was bis zum Wochenband passt. Die
     Zettel stehen alle im DOM; überzählige werden nach der Messung ausgeblendet
     — sie hängen unten, ändern also die Lage der sichtbaren darüber nicht, und
     eine einzige Messung genügt. Bleibt etwas übrig, ist der Platz für die
     Zeile „+n weitere" vorher reserviert. */
  function fitPostits(): void {
    const list = postitsEl;
    const notes = list ? [...list.querySelectorAll<HTMLElement>('.ambient-postit')] : [];
    if (!list || !notes.length) {
      postitHidden = 0;
      return;
    }
    for (const note of notes) note.classList.remove('is-clipped');
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const floor = (weekEl?.getBoundingClientRect().top ?? window.innerHeight) - gap;
    const chip = list.querySelector<HTMLElement>('.ambient-postit-more')?.getBoundingClientRect().height
      ?? (Number.parseFloat(getComputedStyle(list).fontSize) || 16);

    let shown = notes.length;
    for (const [index, note] of notes.entries()) {
      const rest = notes.length - index - 1 + postits.more;
      const reserve = rest > 0 ? gap + chip : 0;
      if (note.getBoundingClientRect().bottom + reserve > floor) {
        shown = Math.max(1, index);
        break;
      }
    }
    for (const note of notes.slice(shown)) note.classList.add('is-clipped');
    postitHidden = notes.length - shown + postits.more;
  }

  $effect(() => {
    void reminders.items;
    void clock.time;
    void localeState.current;
    void viewportTick;
    void deepNight;
    void active;
    void weekHasEvents;
    fitPostits();
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

  /* Ein Moment hat Vorrang vor der formulierten Zeile — und erscheint auch,
     wenn der Hero-Text sonst abgeschaltet ist: er gilt nur für heute. */
  initMoments();
  const heroLines = $derived.by(() => {
    void clock.time;
    void localeState.current;
    // Die Begrüßung hat Vorrang: sie gilt genau jetzt, der Moment gilt heute.
    if (greetingLine) return [greetingLine];
    const moment = momentLine(currentMoment());
    return moment ? [moment] : heroCopy;
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
<svelte:window onresize={() => (viewportTick += 1)} />

<!-- ── Ambient / Idle (docs/07 Screen 9): im Ruhezustand ist das Panel kein
     UI, sondern eine Uhr an der Wand. Statisch bis auf den Minutenwechsel.
     Der weckende Tap wählt nach Zone: Wochenband → Kalender, Zettel →
     Notizen, Mitte → Home (Wohnzimmer). ── -->
<div class="ambient" class:is-on={active} aria-hidden={active ? 'false' : 'true'}
     class:has-side-notes={shoppingSections.length > 0 || postits.items.length > 0}
     class:deep-night={deepNight}
     class:is-away-dark={awayDark}
     onpointerdown={wakeTo}>
  <!-- Genau ein dekorativer Kartenlayer, ganz hinten: das fertige Serverasset
       dient als Maske über der primären Schriftfarbe. Kein Inline-SVG, keine
       Geometrie im Browser, kein Pointer-Ziel — Light und Dark teilen sich
       dasselbe Asset und ändern nur die CSS-Farbe (docs/18 §3.1, §8). -->
  {#if mapVisible}
    <div class="ambient-map" aria-hidden="true"
         style="--ambient-map-src: url('{ambientMap.assetUrl}')"></div>
  {/if}
  {#if weatherLayer}
    <HeroWeatherLayer layer={weatherLayer} />
  {/if}
  <div class="ambient-content" class:without-hero={!settingsValues.ambientHeroText && !deepNight}
       class:deep-night-content={deepNight} bind:this={contentEl}>
    {#if deepNight}
      <div class="ambient-clock num" bind:this={clockEl}>{clock.time}</div>
    {:else}
    <!-- Hero-Zeile: höchstens zwei bewusst getrennte Kommentarzeilen. Sie steht
         auch leer im Layout, solange der Text noch formuliert wird — sonst
         rutscht die Uhr nach unten, sobald er eintrifft. -->
    {#if heroLines.length > 0 || settingsValues.ambientHeroText}
      <p class="ambient-greeting ambient-copy"
         aria-label={heroLines.length ? 'Kommentar zum heutigen Tag' : undefined}
         aria-hidden={heroLines.length ? undefined : 'true'}>
        {#each heroLines as line, index}
          {#if index > 0}<br />{/if}{line}
        {/each}
      </p>
    {/if}
    <div class="ambient-clock num" bind:this={clockEl}>{clock.time}</div>
    <div class="ambient-date">{clock.date}</div>

    <!-- Klima-/Statuszeile: Außentemp Köln + Innentemp, je mit Piktogramm
         (Sonne = außen, Haus = innen) und Trendpfeil (oben/rechts/unten =
         steigt/gleich/fällt). Die Sensormeldung tritt nur hinzu, wenn ein
         Sensor etwas meldet. Ganz leer → die Zeile entfällt. -->
    {#if outdoor.temp !== null || refTemp !== null || safety}
      <div class="ambient-status">
        {#if outdoor.temp !== null}
          {@const arrow = trendIcon(outdoor.trend)}
          <span class="ambient-temp" aria-label={m.ambient_temp_aria({ temp: fmtTemp(outdoor.temp), trend: trendLabel(outdoor.trend) })}>
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
    <section class="ambient-week" bind:this={weekEl} aria-label="Familientermine der kommenden Tage">
      {#each ambientWeek as day (day.key)}
        <div class="ambient-week-day">
          <header class="ambient-week-head">
            <span class="ambient-week-name">{day.weekday}</span>
            <span class="ambient-week-num num">{day.dayOfMonth}</span>
          </header>
          {#each day.events as event (event.id)}
            <div class="ambient-week-event" style={event.color ? postitStyle(event.color) : ''}>
              <span class="ambient-week-time num" class:is-accent={event.emphasis !== null}>
                {event.emphasis === 'now' ? `Jetzt · ${event.time}` : event.time}
              </span>
              <span class="ambient-week-title">{event.title}</span>
            </div>
          {/each}
          {#if day.more}<div class="ambient-week-more">{m.ambient_more_count({ count: day.more })}</div>{/if}
        </div>
      {/each}
    </section>
  {/if}

  <!-- Post-its: offene Erinnerungen als gelbe Notizzettel in der freien oberen
       rechten Ecke. Bewusst außerhalb von .ambient-content — sie liegen am Rand
       und überlagern die zentrale Information (Uhr, Begrüßung, Woche) nicht. -->
  {#if postits.items.length && !deepNight}
    <aside class="ambient-postits" bind:this={postitsEl} aria-label="Offene Erinnerungen">
      {#each postits.items as note (note.id)}
        <div class="ambient-postit" style={postitStyle(personColorId(note.person))} class:is-overdue={note.overdue}>
          <span class="ambient-postit-person">{note.personLabel}</span>
          <p class="ambient-postit-title">{note.title}</p>
          {#if note.dueLabel}
            <span class="ambient-postit-due num">{note.dueLabel}</span>
          {/if}
        </div>
      {/each}
      {#if postitHidden}
        <div class="ambient-postit-more num">{m.ambient_more_count({ count: postitHidden })}</div>
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

  <!-- B-27/AMBIENT-MAP: Die OSM-Namensnennung steht bewusst NICHT im Bild.
       Der Standby ist eine dekorative Flaeche ohne jede Bedienung; OpenStreetMaps
       Richtlinie erlaubt fuer solche nicht-interaktiven Werke, die Nennung dort
       zu fuehren, wo Credits ueblicherweise stehen. Sie steht deshalb sichtbar
       in den Einstellungen unter Ambient & Standby und im NOTICE. -->
</div>
