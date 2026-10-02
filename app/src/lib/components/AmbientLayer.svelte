<script lang="ts">
  import { tick } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import { appState } from '../state/app.svelte.ts';
  import { ambientRequest, setAmbientActive } from '../state/ambient.svelte.ts';
  import { IS_DEMO } from '../demo/demo-mode.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { closeDeviceDetail } from '../state/overlay.svelte.ts';
  import { roomPresence, roomTemperature, roomWindowOpen } from '../state/commands.ts';
  import { fmtTemp } from '../format.ts';
  import { pluralCategory } from '../state/locale.svelte.ts';
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
  import { weatherConditionIcon, type TempTrend } from '../state/weather.ts';
  import Icon from './Icon.svelte';
  import { whenEditable } from '../state/edit-mode.svelte.ts';
  import {
    STANDBY_ANCHORS, STANDBY_ELEMENTS, STANDBY_SIZE_MAX, STANDBY_SIZE_MIN, STANDBY_SIZE_DEFAULT,
    anchorExtents, anchorPoint, clampStandbyAxis, loadStandbyLayout, placeStandbyMenu, saveStandbyLayout, standbyScale,
    type StandbyElement, type StandbyLayout, type StandbyPlacement,
  } from '../state/standby-layout.ts';

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

  /* Ruhebild anpassen (R63): gespeicherter Stand, Entwurf und Auswahl —
     die Funktionen dazu stehen unten beim Anordnen. */
  let layout = $state<StandbyLayout | null>(loadStandbyLayout());
  let editing = $state(false);
  let draft = $state<StandbyLayout | null>(null);
  let selected = $state<StandbyElement | null>(null);
  let dragging = $state(false);
  let ambientEl: HTMLElement;
  let menuEl = $state<HTMLElement | null>(null);
  let menuBox = $state({ left: 0, top: 0, flipped: false });

  function showAmbient(previewDeepNight = false, fromSettings = false, origin: { x: number; y: number } | null = null) {
    if (active) return;
    // Laufende Wiedergabe hemmt den Idle-Timeout — Film schauen ist kein
    // Leerlauf (Phase 4 übernimmt das die Player-Aktivität)
    if (!previewDeepNight && !fromSettings && appState.playback?.playing) { armIdleTimer(); return; }
    deepNightPreview = previewDeepNight;
    settingsPreview = fromSettings;
    settleFrom(origin);
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

  /* ── Aufwachen mit Welle (Owner-Idee 2026-09-12): kein harter Schnitt.
     Vom Finger läuft ein weicher Ring über das Glas, die Uhr hebt sich leicht
     an und wird unscharf, dann gibt die Scheibe den Blick frei. Nur Transform
     und Opacity plus ein einmaliger Blur — reiner Compositor-Job. ── */
  let waking = $state(false);
  let wakeX = $state(0);
  let wakeY = $state(0);
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  const WAKE_MS = 920;

  function rippleFrom(e: PointerEvent) {
    clearTimeout(settleTimer);
    settling = false;
    ring = 'out';
    wakeX = e.clientX;
    wakeY = e.clientY;
    waking = true;
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => { waking = false; ring = null; }, WAKE_MS);
  }

  /* Das Gegenstück beim Sperren: die Scheibe legt sich auf. Uhr, Band und
     Zettel kommen aus leichter Unschärfe scharf; beim Knopf zieht sich der
     Ring zum Knopf zusammen, der Timer legt die Scheibe nur still auf. */
  let settling = $state(false);
  let ring = $state<'out' | 'in' | null>(null);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const SETTLE_MS = 1000;

  function settleFrom(origin: { x: number; y: number } | null) {
    clearTimeout(wakeTimer);
    waking = false;
    if (origin) { wakeX = origin.x; wakeY = origin.y; ring = 'in'; } else ring = null;
    settling = true;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settling = false; ring = null; }, SETTLE_MS);
  }

  function wakeAmbient() {
    if (!active) return;
    active = false;
    setAmbientActive(false);
    deepNightPreview = false;
    settingsPreview = false;
    clearInterval(shiftTimer);
    contentEl.style.transform = '';
    /* Wer mitten im Anordnen geweckt wird (Bewegungsmelder), verliert nur den
       Entwurf — das gespeicherte Ruhebild bleibt, wie es war. */
    editing = false;
    draft = null;
    selected = null;
  }

  /* ── Touch-Zonen beim Entsperren: der Standby ist eine Wandtafel — wer auf
     das Wochenband tippt, will zum Kalender; wer auf Zettel (Post-its oder
     Einkaufsliste) tippt, zur Notizen-Seite; die freie Mitte führt nach Home
     mit dem Wohnzimmer als Default-Raum. ── */
  /* ── Langer Druck öffnet das Anordnen (R63) ──
     Der Tap weckt deshalb erst beim Loslassen, wie in der iOS-App; wer den
     Finger liegen lässt, kommt ins Anordnen — nur im Bearbeiten-Modus, sonst
     gilt derselbe Hinweis wie bei jeder Konfiguration. */
  const HOLD_MS = 500;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let holdFired = false;
  let holdX = 0;
  let holdY = 0;
  const openEditor = whenEditable(() => { void startEdit(); });

  function pressStart(e: PointerEvent) {
    if (!active || e.button !== 0) return;
    if (editing) { selected = null; return; }
    holdFired = false;
    holdX = e.clientX;
    holdY = e.clientY;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holdFired = true; openEditor(); }, HOLD_MS);
  }
  function pressMove(e: PointerEvent) {
    if (holdTimer === undefined) return;
    if (Math.abs(e.clientX - holdX) > 10 || Math.abs(e.clientY - holdY) > 10) pressCancel();
  }
  function pressCancel() {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  }
  function pressEnd(e: PointerEvent) {
    pressCancel();
    if (holdFired || editing) { holdFired = false; return; }
    wakeTo(e);
  }

  function wakeTo(e: PointerEvent) {
    if (!active) return;
    /* Beide Vorschauen wecken an Ort und Stelle: sie wurden aus den
       Einstellungen gestartet, dorthin gehört der Benutzer zurück. Nur der
       echte Standby führt in die getippte Zone. */
    rippleFrom(e);
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

  /* Demo (Owner-Wunsch 2026-09-14): der erste Aufruf im Browser-Tab beginnt
     im Standby — Uhr und Stadtplan sind die Begrüßung, nicht der Raum. Ein
     Neuladen im selben Tab startet wie gewohnt auf Home. Nur die Demo; im
     Haus entscheidet der Timer. Die Aufnahme setzt die Marke selbst, damit
     ihre Läufe weiter auf dem Home beginnen. */
  const DEMO_GREETED_KEY = 'hmi:demo-greeted';
  let greetWithStandby = (() => {
    if (!IS_DEMO) return false;
    try {
      if (sessionStorage.getItem(DEMO_GREETED_KEY) !== null) return false;
      sessionStorage.setItem(DEMO_GREETED_KEY, '1');
      return true;
    } catch { return false; }
  })();

  $effect(() => {
    if (greetWithStandby) {
      greetWithStandby = false;
      showAmbient();
    } else {
      armIdleTimer();
    }
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
    if (motion && !known && active && !editing && settingsValues.presenceWake) wakeAmbient();
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
      ambientRequest.mode === 'preview' || ambientRequest.mode === 'edit',
      ambientRequest.origin,
    );
    if (ambientRequest.mode === 'edit') void startEdit();
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
  /* Plusamorm je Sprache: Deutsch hat zwei, Polnisch vier. */
  const WINDOWS_OPEN = {
    one: m.status_window_open_one, two: m.status_window_open_two,
    few: m.status_window_open_few, many: m.status_window_open_many,
    other: m.status_window_open_other,
  };
  const openCount = $derived(appState.rooms.filter((r) => roomWindowOpen(r.id, r.windowOpen)).length);
  const safety = $derived(
    openCount === 0 ? null : openCount === 1 ? m.phone_room_window_open() : WINDOWS_OPEN[pluralCategory(openCount)]({ count: openCount }));

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
  /* Beim Anordnen steht das Band auch ohne Termine — sonst ließe es sich nicht setzen. */
  const weekHasEvents = $derived(editing || ambientWeek.some((day) => day.events.length > 0));
  const deepNight = $derived(
    !editing && (deepNightPreview
      || (settingsValues.ambientDeepNight && (forceDeepNight || isDeepNightHour(clock.hours)))),
  );
  /* Welche Plätze gelten: beim Anordnen der Entwurf, sonst der gespeicherte
     Stand. In tiefer Nacht gilt weiter nur die gedimmte Uhr in der Mitte —
     sie ist kein Element der Anordnung. */
  const placed = $derived(editing ? (draft ?? layout) : deepNight ? null : layout);

  /* ── Wetter über dem Lockscreen (B-01B, Paket 9) ──
     Hier statt über dem Raumbild: die Bühne zeigt einen Innenraum, und Regen
     über dem eigenen Sofa ergibt keinen Sinn. Der Standby ist eine Wandtafel
     — was dort zieht, zieht draußen. Die Lage kommt aus derselben Messung wie
     die Klimazeile darunter; `?weather=` friert sie für die Abnahme ein.
     Deep Night zeigt weiter ausschließlich die gedämpfte Uhr. */
  const weatherLayer = $derived.by(() => {
    if (!settingsValues.ambientWeather || deepNight) return null;
    return heroWeatherLayer(currentCondition, outdoor.windSpeed, prefersReducedMotion());
  });
  const currentCondition = $derived(resolvedWeatherCondition(simulation.weather, location.search, outdoor.condition));

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
    if (editing && !projected.items.length) {
      return { items: [{ id: 'standby-edit-sample', title: m.standby_edit_sample_note(), person: '', personLabel: '', color: null, dueLabel: null, overdue: false }], more: 0 };
    }
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
    /* Mit eigenem Platz entscheidet der Benutzer, was sich überlagert. */
    if (!list || !notes.length || placed?.postits) {
      for (const note of notes) note.classList.remove('is-clipped');
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
    void placed?.postits;
    fitPostits();
  });

  /* Zentrale Einkaufsliste: links als weißlicher Notizzettel-
     Streifen — nur Läden mit offenen Items, ohne Checkboxen. */
  const shoppingSections = $derived.by(() => {
    const sections = projectShoppingSections(shopping.sections, {
      stores: shoppingConfig.stores,
      itemOrder: shoppingItemOrder(shopping.sections),
    });
    if (editing && !sections.length) {
      return [{ id: 'standby-edit-sample', title: m.standby_edit_sample_store(), items: [{ id: 'standby-edit-sample', title: m.standby_edit_sample_item(), checked: false }] }];
    }
    return sections;
  });

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

  /* ── Ruhebild anpassen (R63) ──
     Ein Platz je Element (Mittelpunkt in Prozent, Größenstufe) — gerätelokal,
     ohne Eintrag bestimmt weiter das CSS. Beim Anordnen liegt ein Entwurf
     über dem gespeicherten Stand; erst „Fertig" schreibt ihn, „Zurücksetzen"
     löscht alles. Elemente ohne eigenen Platz werden beim Einstieg gemessen,
     damit der Entwurf dort beginnt, wo sie gerade stehen. */

  const ELEMENT_SELECTOR: Record<StandbyElement, string> = {
    clock: '.ambient-content', weather: '.ambient-status', week: '.ambient-week',
    shopping: '.ambient-shopping', postits: '.ambient-postits',
  };
  function elementBox(el: StandbyElement): DOMRect | null {
    const node = ambientEl?.querySelector<HTMLElement>(ELEMENT_SELECTOR[el]);
    if (!node) return null;
    if (el !== 'clock' || placed?.clock) return node.getBoundingClientRect();
    /* Der Uhrblock ohne eigenen Platz trägt die Wetterzeile noch in sich —
       gemessen wird nur Begrüßung, Uhr und Datum, das Wetter zählt für sich. */
    const parts = ['.ambient-greeting', '.ambient-clock', '.ambient-date']
      .map((sel) => node.querySelector<HTMLElement>(sel)?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r && r.height > 0);
    if (!parts.length) return node.getBoundingClientRect();
    const top = Math.min(...parts.map((r) => r.top));
    const bottom = Math.max(...parts.map((r) => r.bottom));
    const left = Math.min(...parts.map((r) => r.left));
    const right = Math.max(...parts.map((r) => r.right));
    return new DOMRect(left, top, right - left, bottom - top);
  }
  function measuredPlacement(el: StandbyElement): StandbyPlacement | null {
    const box = elementBox(el);
    const surface = ambientEl?.getBoundingClientRect();
    if (!box || !surface?.width || !surface.height) return null;
    const point = anchorPoint(box, STANDBY_ANCHORS[el]);
    return {
      x: Math.round(((point.x - surface.left) / surface.width) * 1000) / 10,
      y: Math.round(((point.y - surface.top) / surface.height) * 1000) / 10,
      size: STANDBY_SIZE_DEFAULT,
    };
  }

  async function startEdit(): Promise<void> {
    if (editing || !active) return;
    editing = true;
    selected = null;
    await tick();
    const next: StandbyLayout = {};
    for (const el of STANDBY_ELEMENTS) {
      const own = layout?.[el] ?? measuredPlacement(el);
      if (own) next[el] = { ...own };
    }
    draft = next;
    /* Ein gespeicherter Stand von fremder Hand kann Elemente aus dem Bild
       schieben; beim Anordnen kommen sie zurück, damit sie greifbar sind. */
    await tick();
    for (const el of STANDBY_ELEMENTS) if (draft?.[el]) await fit(el);
  }
  function finishEdit(): void {
    layout = draft && Object.keys(draft).length ? structuredClone($state.snapshot(draft)) : null;
    saveStandbyLayout(layout);
    editing = false;
    draft = null;
    selected = null;
  }
  function resetEdit(): void {
    layout = null;
    saveStandbyLayout(null);
    editing = false;
    draft = null;
    selected = null;
  }

  function placeStyle(el: StandbyElement): string | undefined {
    const p = placed?.[el];
    return p ? `left:${p.x}%;top:${p.y}%;--el-scale:${standbyScale(p.size)}` : undefined;
  }

  /* Sichtbare Ausdehnung vom Anker aus in Prozent der Fläche — damit ein
     Element beim Ziehen und beim Wachsen ganz im Bild bleibt. */
  function extents(el: StandbyElement): { left: number; right: number; top: number; bottom: number } {
    const box = elementBox(el);
    const surface = ambientEl.getBoundingClientRect();
    if (!box || !surface.width || !surface.height) return { left: 0, right: 0, top: 0, bottom: 0 };
    /* Ein Rand von 8 px: die enge Laufweite der Uhr schiebt die letzte Ziffer
       über ihren Kasten hinaus, sonst schnitte der Bildrand sie an. */
    const pad = 8;
    const e = anchorExtents(box, STANDBY_ANCHORS[el]);
    return {
      left: ((e.left + pad) / surface.width) * 100, right: ((e.right + pad) / surface.width) * 100,
      top: ((e.top + pad) / surface.height) * 100, bottom: ((e.bottom + pad) / surface.height) * 100,
    };
  }
  function clamped(el: StandbyElement, x: number, y: number, e = extents(el)): { x: number; y: number } {
    return { x: clampStandbyAxis(x, e.left, e.right), y: clampStandbyAxis(y, e.top, e.bottom) };
  }
  function grab(e: PointerEvent, el: StandbyElement): void {
    if (!editing || !draft?.[el] || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    selected = el;
    const node = e.currentTarget as HTMLElement;
    const origin = { ...draft[el] };
    const surface = ambientEl.getBoundingClientRect();
    const reach = extents(el);
    const startX = e.clientX;
    const startY = e.clientY;
    try { node.setPointerCapture(e.pointerId); } catch { /* alte WebViews ohne Capture */ }
    const move = (ev: PointerEvent) => {
      if (!draft?.[el]) return;
      dragging = true;
      const x = origin.x + ((ev.clientX - startX) / surface.width) * 100;
      const y = origin.y + ((ev.clientY - startY) / surface.height) * 100;
      draft[el] = { ...draft[el], ...clamped(el, x, y, reach) };
    };
    const stop = () => {
      dragging = false;
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', stop);
      node.removeEventListener('pointercancel', stop);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
  }
  async function resize(step: 1 | -1): Promise<void> {
    const el = selected;
    if (!el || !draft?.[el]) return;
    const size = Math.min(STANDBY_SIZE_MAX, Math.max(STANDBY_SIZE_MIN, draft[el].size + step));
    if (size === draft[el].size) return;
    draft[el] = { ...draft[el], size };
    await tick();
    await fit(el);
  }
  /* Größer als die Fläche darf nichts werden (Stresshaus #20: eine Uhr in
     Stufe 5 mit französischem Datum war breiter als 1280 px und stand dann
     mittig über beiden Rändern). Passt es nicht, eine Stufe kleiner, dann
     an den Rand holen. */
  async function fit(el: StandbyElement): Promise<void> {
    let e = extents(el);
    while (draft?.[el] && draft[el].size > STANDBY_SIZE_MIN && (e.left + e.right > 100 || e.top + e.bottom > 100)) {
      draft[el] = { ...draft[el], size: draft[el].size - 1 };
      await tick();
      e = extents(el);
    }
    if (draft?.[el]) draft[el] = { ...draft[el], ...clamped(el, draft[el].x, draft[el].y, e) };
  }

  /* Das Menü folgt dem gewählten Element und wechselt die Seite, sobald es
     rechts nicht mehr ins Bild passt — gemessen nach jedem Zug. */
  $effect(() => {
    const el = selected;
    const entry = el ? draft?.[el] : null;
    void entry?.x; void entry?.y; void entry?.size; void viewportTick;
    if (!el || !entry || !menuEl) return;
    const box = elementBox(el);
    const surface = ambientEl.getBoundingClientRect();
    if (!box) return;
    menuBox = placeStandbyMenu(
      { left: box.left - surface.left, top: box.top - surface.top, width: box.width, height: box.height },
      { width: menuEl.offsetWidth, height: menuEl.offsetHeight },
      { width: surface.width, height: surface.height },
    );
  });
  const selectedPlacement = $derived.by(() => { const el = selected; return el ? draft?.[el] ?? null : null; });
  const canGrow = $derived(!!selectedPlacement && selectedPlacement.size < STANDBY_SIZE_MAX);
  const canShrink = $derived(!!selectedPlacement && selectedPlacement.size > STANDBY_SIZE_MIN);
</script>

{#snippet statusRow()}
  {#if outdoor.temp !== null || refTemp !== null || safety || editing}
    <div class="ambient-status">
      {#if outdoor.temp !== null}
        {@const arrow = trendIcon(outdoor.trend)}
        <span class="ambient-temp" aria-label={m.ambient_temp_aria({ temp: fmtTemp(outdoor.temp), trend: trendLabel(outdoor.trend) })}>
          <Icon name={weatherConditionIcon(currentCondition)} cls="ambient-temp-icon" />
          <span class="num">{fmtTemp(outdoor.temp)}°</span>
          {#if arrow}<Icon name={arrow} cls="ambient-temp-trend" />{/if}
        </span>
      {:else if editing && refTemp === null && !safety}
        <span class="ambient-temp">
          <Icon name="i-sun-thermometer-outline" cls="ambient-temp-icon" />
          <span>{m.standby_edit_sample_weather()}</span>
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
{/snippet}

<!-- Der weckende Tap trifft nur den Ambient-Layer (liegt über allem) —
     keine versehentliche Bedienung des darunterliegenden Screens.
     Der globale Capture-Listener armiert den Idle-Timer bei jedem Touch. -->
<svelte:document onpointerdowncapture={armIdleTimer} />
<svelte:window onresize={() => (viewportTick += 1)} />

<!-- ── Ambient / Idle (docs/07 Screen 9): im Ruhezustand ist das Panel kein
     UI, sondern eine Uhr an der Wand. Statisch bis auf den Minutenwechsel.
     Der weckende Tap wählt nach Zone: Wochenband → Kalender, Zettel →
     Notizen, Mitte → Home (Wohnzimmer). ── -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ambient" class:is-on={active} aria-hidden={active ? 'false' : 'true'}
     class:has-side-notes={(shoppingSections.length > 0 || postits.items.length > 0) && !placed}
     class:deep-night={deepNight}
     class:is-away-dark={awayDark && !editing}
     class:is-waking={waking}
     class:is-settling={settling}
     class:is-editing={editing}
     class:is-dragging={dragging}
     style:--wake-x={`${wakeX}px`}
     style:--wake-y={`${wakeY}px`}
     bind:this={ambientEl}
     onpointerdown={pressStart}
     onpointermove={pressMove}
     onpointerup={pressEnd}
     onpointercancel={pressCancel}>
  {#if ring}
    <span class="ambient-wake-ripple" class:is-inward={ring === 'in'} aria-hidden="true"></span>
  {/if}
  <!-- Anordnen: die Fläche taucht ins Blau der Blaupause, der Stadtplan
       darunter bleibt als Zeichnung sichtbar. -->
  {#if editing}
    <div class="ambient-blueprint" aria-hidden="true"></div>
  {/if}
  <!-- Genau ein dekorativer Kartenlayer, ganz hinten: das fertige Serverasset
       dient als Maske über der primären Schriftfarbe. Kein Inline-SVG, keine
       Geometrie im Browser, kein Pointer-Ziel — Light und Dark teilen sich
       dasselbe Asset und ändern nur die CSS-Farbe (docs/18 §3.1, §8). -->
  {#if mapVisible}
    <div class="ambient-map" aria-hidden="true"
         style="--ambient-map-src: url('{ambientMap.assetUrl}')"></div>
  {/if}
  {#if weatherLayer && !editing}
    <HeroWeatherLayer layer={weatherLayer} />
  {/if}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ambient-el" class:is-placed={!!placed?.clock} class:is-selected={selected === 'clock'}
       data-standby-el="clock" data-anchor={STANDBY_ANCHORS.clock} style={placeStyle('clock')}
       onpointerdown={(e) => grab(e, 'clock')}>
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
         Sensor etwas meldet. Ganz leer → die Zeile entfällt. Mit eigenem
         Platz (R63) steht die Zeile für sich außerhalb des Uhrblocks. -->
    {#if !placed?.weather}
      {@render statusRow()}
    {/if}
    {/if}
  </div>
  </div>
  {#if placed?.weather && !deepNight}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ambient-el is-placed" class:is-selected={selected === 'weather'}
         data-standby-el="weather" data-anchor={STANDBY_ANCHORS.weather} style={placeStyle('weather')}
         onpointerdown={(e) => grab(e, 'weather')}>
      {@render statusRow()}
    </div>
  {/if}

  <!-- Wochenband: die kommenden 7 Tage als ruhige, gleichbreite Spalten — heute
       ganz links; leere Tage behalten ihre Spalte, damit die Woche als Raster
       lesbar bleibt. Bewusst außerhalb von .ambient-content: es sitzt fest am
       unteren Bildschirmrand, während Uhr & Begrüßung mittig zentriert bleiben. -->
  {#if weekHasEvents && !deepNight && settingsValues.ambientWeek}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ambient-el" class:is-placed={!!placed?.week} class:is-selected={selected === 'week'}
         data-standby-el="week" data-anchor={STANDBY_ANCHORS.week} style={placeStyle('week')}
         onpointerdown={(e) => grab(e, 'week')}>
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
    </div>
  {/if}

  <!-- Post-its: offene Erinnerungen als gelbe Notizzettel in der freien oberen
       rechten Ecke. Bewusst außerhalb von .ambient-content — sie liegen am Rand
       und überlagern die zentrale Information (Uhr, Begrüßung, Woche) nicht. -->
  {#if postits.items.length && !deepNight}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ambient-el" class:is-placed={!!placed?.postits} class:is-selected={selected === 'postits'}
         data-standby-el="postits" data-anchor={STANDBY_ANCHORS.postits} style={placeStyle('postits')}
         onpointerdown={(e) => grab(e, 'postits')}>
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
    </div>
  {/if}

  <!-- Einkaufsliste: ein langer, weißlicher Zettel in der freien oberen linken
       Ecke — das Gegenstück zu den Post-its rechts. Immer der Stand der
       zentralen Einkaufsliste, ohne Checkboxen, mit den Laden-Überschriften.
       Leicht gekippt wie angepinntes Papier; nachts gedämpft. -->
  {#if shoppingSections.length && !deepNight}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ambient-el" class:is-placed={!!placed?.shopping} class:is-selected={selected === 'shopping'}
         data-standby-el="shopping" data-anchor={STANDBY_ANCHORS.shopping} style={placeStyle('shopping')}
         onpointerdown={(e) => grab(e, 'shopping')}>
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
    </div>
  {/if}

  <!-- Anordnen (R63): neben dem gewählten Element die Größe, unten die
       Leiste wie beim Energie-Zettel — Zurücksetzen löscht den eigenen Stand. -->
  {#if editing && selected}
    <div class="ambient-edit-menu" class:is-flipped={menuBox.flipped} role="toolbar" tabindex="-1" aria-label={m.sys_standby_layout()}
         bind:this={menuEl} style="left:{menuBox.left}px;top:{menuBox.top}px"
         onpointerdown={(e) => e.stopPropagation()}>
      <button class="ambient-edit-size pressable" type="button" aria-label={m.standby_edit_bigger()}
              disabled={!canGrow} onclick={() => void resize(1)}>+</button>
      <button class="ambient-edit-size pressable" type="button" aria-label={m.standby_edit_smaller()}
              disabled={!canShrink} onclick={() => void resize(-1)}>−</button>
    </div>
  {/if}
  {#if editing}
    <div class="ambient-edit-bar" role="toolbar" tabindex="-1" aria-label={m.sys_standby_layout()}
         onpointerdown={(e) => e.stopPropagation()}>
      <span class="ambient-edit-hint">{m.standby_edit_hint()}</span>
      <button class="secondary-btn pressable" type="button" onclick={resetEdit}>{m.standby_edit_reset()}</button>
      <button class="primary-btn pressable" type="button" onclick={finishEdit}>{m.standby_edit_done()}</button>
    </div>
  {/if}

  <!-- B-27/AMBIENT-MAP: Die OSM-Namensnennung steht bewusst NICHT im Bild.
       Der Standby ist eine dekorative Flaeche ohne jede Bedienung; OpenStreetMaps
       Richtlinie erlaubt fuer solche nicht-interaktiven Werke, die Nennung dort
       zu fuehren, wo Credits ueblicherweise stehen. Sie steht deshalb sichtbar
       in den Einstellungen unter Ambient & Standby und im NOTICE. -->
</div>
