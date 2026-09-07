<script lang="ts">
  import { SUN_ENTITY, appState } from '../state/app.svelte.ts';
  import { energyCurve, energyPeriodTotals, initEnergyHistory } from '../state/energy-history.svelte.ts';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import { energyView, loadBreakdown } from '../state/energy.svelte.ts';
  import EnergyLoadOverlay from '../components/EnergyLoadOverlay.svelte';
  import {
    ENERGY_HERO_DEFAULT_RATIO,
    energyAssetUrl,
    energyFrameUrl,
    exteriorAssetUrl,
    exteriorHeroFrame,
    loadEnergyHeroFrame,
    placeFrame,
    selectEnergyVariant,
    type PlacementBounds,
    type EnergyHeroFrame,
    type EnergyMarkAnchor,
    type EnergyVariant,
  } from '../components/energy-hero-assets.ts';
  import { EXTERIOR_HERO_ID } from '../config/household-config.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { loadRoomRegionsOnce, roomRegions } from '../state/room-regions.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { whenEditable } from '../state/edit-mode.svelte.ts';
  import { createRetryableLazyLoader } from '../state/lazy-loader.ts';
  import { showScreen } from '../state/nav.svelte.ts';
  import { jumpToSetting } from '../state/settings.svelte.ts';
  import { energyMarks, saveEnergyMarks } from '../state/energy-marks.svelte.ts';
  import Icon from '../components/Icon.svelte';
  import { ENERGY_PERIODS, energyPanelData, type EnergyPeriod } from '../state/energy-periods.ts';
  import type { SunValue } from '../adapter/types.ts';
  import { fmtKw } from '../format.ts';

  import { m } from '../../paraglide/messages.js';
  let period = $state<EnergyPeriod>('today');

  /* Live-Sicht aus realen HA-Sensoren (ADR-018); null = nicht konfiguriert
     bzw. unavailable → die Marke entfällt, das Bild bleibt (R3). */
  const e = $derived(energyView());

  /* Last-Overlay (B-19): eigene hidden→open→closing-Zustandsmaschine (Muster
     wie DeviceDetail). Trigger ist die Haus-Marke, wenn es Last gibt. */
  let loadOverlay = $state<'hidden' | 'open' | 'closing'>('hidden');
  const breakdown = $derived(loadBreakdown());
  function openLoadOverlay() {
    loadOverlay = 'open';
  }
  function closeLoadOverlay() {
    if (loadOverlay === 'open') loadOverlay = 'closing';
  }

  /* Sonne und Dämmerung kommen aus derselben Quelle wie beim Raum (theme.svelte.ts):
     der Simulator und `?dusk=` greifen dort ein, und der Energie-Screen folgt —
     Tag- und Nachtbild blenden über das Dämmerungsband ineinander, statt
     umzuklappen (R20, „Nichts springt, alles blendet"). */
  const sun = $derived((appState.heroSun ?? (SUN_ENTITY ? runtime.merged(SUN_ENTITY) as SunValue | undefined : undefined)));
  const variant = $derived(selectEnergyVariant(sun, appState.theme));
  const dusk = $derived(appState.heroDusk);
  const counterVariant = $derived<EnergyVariant>(variant === 'day' ? 'night' : 'day');
  const counterOpacity = $derived(Math.min(1, Math.max(0, variant === 'day' ? 1 - dusk : dusk)));
  const isNight = $derived(counterOpacity > 0.5 ? counterVariant === 'night' : variant === 'night');
  /* Das eigene Haus (R14b): Hat der Haushalt dem Ziel „Draußen" ein Bildset
     zugewiesen, ist es die Bühne; sonst der Platzhalter. */
  const exteriorAssetId = $derived(roomHeroConfig(EXTERIOR_HERO_ID)?.assetId ?? null);
  const energyHeroUrl = $derived(exteriorAssetId
    ? exteriorAssetUrl(exteriorAssetId, variant)
    : energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun, fallbackTheme: appState.theme }));
  const counterHeroUrl = $derived(exteriorAssetId
    ? exteriorAssetUrl(exteriorAssetId, counterVariant)
    : energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun: { day: counterVariant === 'day' }, fallbackTheme: appState.theme }));
  /* Die Anker kommen mit dem Motiv (R14a): `day.avif` → `day.json`. Beim
     eigenen Haus entstehen sie aus Vorlage und erkannten Flächen. Bis sie da
     sind, steht das Bild ohne Marken; ein Motiv ohne Anker bleibt ohne Marken
     (R3). Ein Wechsel Tag/Nacht darf keine alten Anker aufs neue Bild legen,
     daher zählt nur die zuletzt angeforderte Datei. */
  let baseFrame = $state<EnergyHeroFrame | null>(null);
  let regionsLoaded = $state(false);
  $effect(() => {
    if (!exteriorAssetId) return;
    void loadRoomRegionsOnce().then(() => { regionsLoaded = true; });
  });
  $effect(() => {
    if (exteriorAssetId) {
      baseFrame = regionsLoaded ? exteriorHeroFrame(roomRegions(EXTERIOR_HERO_ID)) : null;
      return;
    }
    const url = energyFrameUrl(energyHeroUrl);
    let current = true;
    baseFrame = null;
    void loadEnergyHeroFrame(url).then((loaded) => { if (current) baseFrame = loaded; });
    return () => { current = false; };
  });
  /* Von Hand verschobene Zettel (R19) gehen vor — aber nur für das Motiv, für
     das sie gesetzt wurden; ein neues Bild beginnt wieder bei der Vorlage. */
  const storedMarks = $derived(energyMarks());
  const ownMarks = $derived(storedMarks && storedMarks.assetId === exteriorAssetId ? storedMarks : null);
  const frame = $derived<EnergyHeroFrame | null>(baseFrame
    ? (ownMarks ? { ratio: baseFrame.ratio, sun: ownMarks.sun, house: ownMarks.house, grid: ownMarks.grid } : baseFrame)
    : null);
  const heroRatio = $derived(frame?.ratio ?? ENERGY_HERO_DEFAULT_RATIO);
  /* Zeiträume aus der Langzeitstatistik (R21); heute bleibt live. */
  const sums = $derived(period === 'today' ? null : energyPeriodTotals(period));
  const panel = $derived(energyPanelData(e, period, 'flow', sums));
  $effect(() => { initEnergyHistory(); });
  const hasLiveEnergyValue = $derived(e.pv !== null || e.load !== null);

  const grid = $derived(e.grid); // >0 Einspeisung, <0 Bezug, null unbekannt
  const feeding = $derived(grid !== null && grid > 0.05);
  const drawing = $derived(grid !== null && grid < -0.05);
  const gridLabel = $derived(feeding ? m.energy_grid_feed() : drawing ? m.energy_grid_draw() : m.energy_grid());

  const showSun = $derived(frame !== null && e.hasGeneration && e.pv !== null);
  const showLoad = $derived(frame !== null && e.load !== null);
  const showGrid = $derived(frame !== null && grid !== null);

  function noteStyle(anchor: EnergyMarkAnchor): string {
    return `--mark-x:${anchor.note.x};--mark-y:${anchor.note.y};--mark-tilt:${anchor.tilt}deg`;
  }
  function pointStyle(anchor: EnergyMarkAnchor): string {
    return `--mark-x:${anchor.point.x};--mark-y:${anchor.point.y}`;
  }

  /* Die Wand trägt den Tag (R4): der Leitwert des Zeitraums groß in der
     Papierstimme, die übrigen Summen klein darunter. Ohne Summen steht dort
     der Satz, warum es gerade keine gibt — nie ein leeres Feld. */
  const storyLead = $derived(panel.kpis[0] ?? null);
  const storyRest = $derived(panel.kpis.slice(1));
  const periodLabel = $derived(ENERGY_PERIODS.find((option) => option.id === period)?.label ?? '');

  /* Tagesverlauf als eine Linie am unteren Bildrand (R4): Verbrauch als
     Haarlinie, Erzeugung als warme Fläche darunter. Seit R21 aus der
     Fünf-Minuten-Statistik des Recorders — oder aus dem Simulator. Ohne
     Daten keine Linie: die Achse ist der Tag (0…24 h), die Höhe der größte
     Wert des Tages, damit die Linie den Streifen füllt. */
  const CURVE_H = 28;
  const curve = $derived(energyCurve());
  const curveMax = $derived(curve
    ? Math.max(0.1, ...curve.map((p) => Math.max(p.load ?? 0, p.prod ?? 0)))
    : 1);
  function curveY(v: number): string {
    return (CURVE_H - Math.min(1, v / curveMax) * CURVE_H).toFixed(2);
  }
  const loadLine = $derived(curve
    ? curve.filter((p) => p.load !== null).map((p) => `${(p.t * 100).toFixed(2)},${curveY(p.load ?? 0)}`).join(' ')
    : '');
  const prodPoints = $derived(curve ? curve.filter((p) => p.prod !== null) : []);
  const prodArea = $derived(prodPoints.length
    ? `${(prodPoints[0].t * 100).toFixed(2)},${CURVE_H} ${prodPoints.map((p) => `${(p.t * 100).toFixed(2)},${curveY(p.prod ?? 0)}`).join(' ')} ${(prodPoints[prodPoints.length - 1].t * 100).toFixed(2)},${CURVE_H}`
    : '');
  const showCurve = $derived(period === 'today' && curve !== null && curve.length > 1);

  /* Kontextmenü per langem Druck auf die Bühne (Owner-Wunsch 2026-09-07):
     Bild ändern (Assistent, Bibliothek) und Sensoren zuweisen. Gilt wie
     jede Konfiguration nur im Konfigurieren-Modus; im Bedienen-Modus zählt
     der Druck als Versuch, wie beim Raumlayout. Assistent und Bibliothek
     werden erst beim Öffnen nachgeladen. */
  let menuOpen = $state(false);
  let wizardOpen = $state(false);
  let libraryOpen = $state(false);
  const wizardLoader = createRetryableLazyLoader({
    wizard: () => import('../components/settings/RoomImageWizard.svelte'),
  });
  const libraryLoader = createRetryableLazyLoader({
    library: () => import('../components/settings/RoomImageLibrary.svelte'),
  });
  function openWizard(): void { menuOpen = false; wizardOpen = true; }
  function openLibrary(): void { menuOpen = false; libraryOpen = true; }
  function openSensors(): void {
    menuOpen = false;
    /* Der System-Screen wird beim Wechsel aufgebaut und verbraucht den Sprung
       beim Betreten — ein früheres Anwenden würde von seinem Start bei
       Räume & Geräte wieder überschrieben. */
    jumpToSetting('services', 'energy-production');
    showScreen('system');
  }
  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') menuOpen = false;
  }

  /* Anordnen (R19, Owner-Wunsch 2026-09-07): Zettel und Punkte lassen sich
     ziehen. Gearbeitet wird an einem Entwurf in Bildprozent — das Cover-
     Rechteck (`.energy-frame`) ist das Koordinatensystem, damit die Plätze
     beim Zuschnitt am Motiv bleiben. „Fertig" schreibt den Entwurf in den
     Haushalt, „Zurücksetzen" nimmt ihn zurück auf die Vorlage. */
  let arrange = $state(false);
  let draft = $state<EnergyHeroFrame | null>(null);
  let arrangeBusy = $state(false);
  let arrangeError = $state<string | null>(null);
  let frameEl = $state<HTMLElement>();
  let stageEl = $state<HTMLElement>();
  let wallEl = $state<HTMLElement>();
  /* Zettel bleiben im Bild (R21): Der sichtbare Ausschnitt und die
     Zusammenfassung oben links werden gemessen und in Bildprozent übersetzt;
     placeFrame() hält jeden Zettel und Punkt darin — aus Vorlage, Erkennung
     oder Hand. Neu gemessen bei Größenänderung und wenn die Wand wächst. */
  let bounds = $state<PlacementBounds | null>(null);
  function measureBounds(): void {
    if (!frameEl || !stageEl) { bounds = null; return; }
    const f = frameEl.getBoundingClientRect();
    if (!f.width || !f.height) { bounds = null; return; }
    const toRect = (r: DOMRect) => ({
      x0: ((r.left - f.left) / f.width) * 100,
      y0: ((r.top - f.top) / f.height) * 100,
      x1: ((r.right - f.left) / f.width) * 100,
      y1: ((r.bottom - f.top) / f.height) * 100,
    });
    const stage = stageEl.getBoundingClientRect();
    const tab = document.querySelector('.tab-bar')?.getBoundingClientRect();
    const visible = toRect(stage);
    if (tab && tab.top < stage.bottom) visible.y1 = Math.min(visible.y1, toRect(tab).y0);
    const blocked: PlacementBounds['blocked'] = [];
    const wall = wallEl?.getBoundingClientRect();
    if (wall && wall.width && wall.height) blocked.push(toRect(wall));
    const noteEl = frameEl.querySelector<HTMLElement>('.energy-mark');
    const noteW = noteEl?.offsetWidth ?? 120;
    const noteH = noteEl?.offsetHeight ?? 84;
    bounds = { visible, blocked, note: { w: (noteW / f.width) * 100, h: (noteH / f.height) * 100 } };
  }
  $effect(() => {
    if (!frameEl || !stageEl) return;
    const observer = new ResizeObserver(() => measureBounds());
    observer.observe(stageEl);
    observer.observe(frameEl);
    if (wallEl) observer.observe(wallEl);
    measureBounds();
    return () => observer.disconnect();
  });
  $effect(() => {
    void panel; void period; void frame;
    measureBounds();
  });
  const shown = $derived.by(() => {
    const raw = arrange && draft ? draft : frame;
    return raw ? placeFrame(raw, bounds) : null;
  });
  function startArrange(): void {
    menuOpen = false;
    if (!frame) return;
    draft = structuredClone($state.snapshot(frame));
    arrangeError = null;
    arrange = true;
  }
  const clampPct = (value: number) => Math.min(99, Math.max(1, Math.round(value * 10) / 10));
  function startDrag(event: PointerEvent, key: 'sun' | 'house' | 'grid', part: 'note' | 'point'): void {
    if (!arrange || !draft || !frameEl || event.button !== 0) return;
    const el = event.currentTarget as HTMLElement;
    const rect = frameEl.getBoundingClientRect();
    try { el.setPointerCapture(event.pointerId); } catch { /* ohne Capture geht der Zug weiter */ }
    const move = (e: PointerEvent) => {
      if (!draft) return;
      const x = clampPct(((e.clientX - rect.left) / rect.width) * 100);
      const y = clampPct(((e.clientY - rect.top) / rect.height) * 100);
      draft = placeFrame({ ...draft, [key]: { ...draft[key], [part]: { x, y } } }, bounds);
    };
    const stop = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    event.preventDefault();
  }
  async function finishArrange(): Promise<void> {
    if (!draft || arrangeBusy) return;
    arrangeBusy = true;
    arrangeError = null;
    try {
      await saveEnergyMarks({ assetId: exteriorAssetId, sun: draft.sun, house: draft.house, grid: draft.grid });
      arrange = false;
      draft = null;
    } catch {
      arrangeError = m.energy_arrange_failed();
    } finally {
      arrangeBusy = false;
    }
  }
  async function resetArrange(): Promise<void> {
    if (arrangeBusy) return;
    arrangeBusy = true;
    arrangeError = null;
    try {
      await saveEnergyMarks(null);
      arrange = false;
      draft = null;
    } catch {
      arrangeError = m.energy_arrange_failed();
    } finally {
      arrangeBusy = false;
    }
  }
  const markLabel = { sun: () => m.energy_solar(), house: () => m.energy_measured_load(), grid: () => gridLabel } as const;
</script>

<!-- ── Energie (docs/23 R4): Das Balkonbild ist die Bühne. Die Wand trägt den
     Tag, das Motiv die Live-Werte — jeder Zettel per Haarlinie an seine Stelle
     geheftet, der Tagesverlauf als Linie am unteren Rand. Keine Kachelspalte,
     keine dritte Stimme. Was nicht gemessen wird, bekommt keine Marke. ── -->
<div class="energy-stage" class:is-night={isNight} class:is-arranging={arrange}
     style={`--hero-ratio:${heroRatio.toFixed(4)}`} bind:this={stageEl}>
  <div class="energy-hero" aria-hidden="true">
    <div class="energy-hero-img" style:background-image={`url("${energyHeroUrl}")`}></div>
    {#if counterOpacity > 0.005}
      <div class="energy-hero-img is-counter" style:opacity={counterOpacity}
           style:background-image={`url("${counterHeroUrl}")`}></div>
    {/if}
    <div class="energy-hero-scrim"></div>
  </div>

  <!-- Freie Trefferfläche unter Zetteln, Chips und Linie: nur der lange Druck
       auf den Hintergrund öffnet das Menü; alles darüber bleibt bedienbar. -->
  <div class="energy-config-hitarea" aria-label={m.energy_menu_hint()}
       use:longpress={{ onLongPress: whenEditable(() => (menuOpen = true)), enabled: !arrange }}></div>

  <!-- Cover-Rechteck des Motivs: Zettel, Linien und Punkte rechnen in Bildprozent. -->
  {#if shown}
  {@const f = shown}
  <div class="energy-frame" bind:this={frameEl}>
    <!-- Zwei Striche übereinander: ein heller Hof unter der Tinte hält die
         Haarlinie auch über Blattwerk und Geländer lesbar. -->
    <svg class="energy-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {#each ['halo', 'ink'] as layer (layer)}
        <g class="leader-{layer}">
          {#if arrange || showSun}
            <line x1={f.sun.note.x} y1={f.sun.note.y} x2={f.sun.point.x} y2={f.sun.point.y} />
          {/if}
          {#if arrange || showLoad}
            <line x1={f.house.note.x} y1={f.house.note.y} x2={f.house.point.x} y2={f.house.point.y} />
          {/if}
          {#if arrange || showGrid}
            <line x1={f.grid.note.x} y1={f.grid.note.y} x2={f.grid.point.x} y2={f.grid.point.y} />
          {/if}
        </g>
      {/each}
    </svg>

    {#if arrange}
      <!-- Anordnen: alle drei Zettel samt Punkt, auch ohne Messwert — sonst
           ließe sich nicht setzen, was morgen gemessen wird. -->
      <div class="energy-marks" role="group" aria-label={m.energy_menu_arrange()}>
        {#each ['sun', 'house', 'grid'] as const as key (key)}
          <span class="mark-point is-draggable" style={pointStyle(f[key])} role="button" tabindex="0"
                aria-label={markLabel[key]()} onpointerdown={(e) => startDrag(e, key, 'point')}></span>
          <div class="energy-mark is-draggable" class:is-warm={key === 'sun'} style={noteStyle(f[key])}
               role="button" tabindex="0" aria-label={markLabel[key]()}
               onpointerdown={(e) => startDrag(e, key, 'note')}>
            <span class="caps-label mark-label">{markLabel[key]()}</span>
            <span class="mark-value num">
              {#if key === 'sun' && e.pv !== null}{fmtKw(e.pv)}<span class="kpi-unit">kW</span>
              {:else if key === 'house' && e.load !== null}{fmtKw(e.load)}<span class="kpi-unit">kW</span>
              {:else if key === 'grid' && grid !== null}{fmtKw(Math.abs(grid))}<span class="kpi-unit">kW</span>
              {:else}·{/if}
            </span>
          </div>
        {/each}
      </div>
    {:else}
    <div class="energy-marks" role="group" aria-label={m.energy_current_values()}>
      {#if showSun && e.pv !== null}
        <span class="mark-point" style={pointStyle(f.sun)} aria-hidden="true"></span>
        <div class="energy-mark is-warm" style={noteStyle(f.sun)}>
          <span class="caps-label mark-label">{m.energy_solar()}</span>
          <span class="mark-value num">{fmtKw(e.pv)}<span class="kpi-unit">kW</span></span>
        </div>
      {/if}

      {#if showLoad && e.load !== null}
        <span class="mark-point" style={pointStyle(f.house)} aria-hidden="true"></span>
        <button class="energy-mark energy-mark-trigger pressable" type="button"
                aria-haspopup="dialog" aria-label={m.energy_show_breakdown()}
                style={noteStyle(f.house)} onclick={openLoadOverlay}>
          <span class="caps-label mark-label">{m.energy_measured_load()}</span>
          <span class="mark-value num">{fmtKw(e.load)}<span class="kpi-unit">kW</span></span>
        </button>
      {/if}

      {#if showGrid && grid !== null}
        <span class="mark-point" style={pointStyle(f.grid)} aria-hidden="true"></span>
        <div class="energy-mark" class:is-warm={feeding} class:is-cool={drawing}
             style={noteStyle(f.grid)}>
          <span class="caps-label mark-label">{gridLabel}</span>
          <span class="mark-value num">{fmtKw(Math.abs(grid))}<span class="kpi-unit">kW</span></span>
        </div>
      {/if}
    </div>
    {/if}
  </div>
  {/if}

  <div class="energy-wall" bind:this={wallEl}>
    <div class="energy-period-row" role="radiogroup" aria-label="Energie-Zeitraum">
      {#each ENERGY_PERIODS as p (p.id)}
        <button class="scene-btn energy-period-btn pressable" type="button" role="radio"
                aria-checked={period === p.id} class:is-active={period === p.id}
                onclick={() => (period = p.id)}>
          {p.label}
        </button>
      {/each}
    </div>

    {#if storyLead}
      <section class="energy-story" aria-label={m.energy_period_kpis()}>
        <span class="caps-label story-label">{periodLabel} · {storyLead.label}</span>
        <p class="story-value num">{fmtKw(storyLead.value)}<span class="story-unit">{storyLead.unit}</span></p>
        {#if storyRest.length > 0}
          <p class="story-rest">
            {#each storyRest as kpi (kpi.label)}
              <span class="story-rest-item">
                <span class="story-rest-label">{kpi.label}</span>
                <span class="story-rest-value num">{fmtKw(kpi.value)}<span class="kpi-unit">{kpi.unit}</span></span>
              </span>
            {/each}
          </p>
        {/if}
      </section>
    {/if}

    {#if panel.hint}
      <p class="energy-hint">{panel.hint}</p>
    {/if}
  </div>

  {#if showCurve}
    <section class="energy-daycurve" aria-label={m.energy_day_curve()}>
      <span class="caps-label curve-label">{m.energy_today()}</span>
      <svg class="energy-curve" viewBox="0 0 100 {CURVE_H}" preserveAspectRatio="none" aria-hidden="true">
        {#if prodArea}<polygon class="curve-prod" points={prodArea}></polygon>{/if}
        {#if loadLine}<polyline class="curve-load" points={loadLine}></polyline>{/if}
      </svg>
    </section>
  {/if}
</div>

{#if arrange}
  <div class="energy-arrange-bar" role="toolbar" aria-label={m.energy_menu_arrange()}>
    <span class="energy-arrange-hint">{arrangeError ?? m.energy_arrange_hint()}</span>
    <button class="secondary-btn pressable" type="button" disabled={arrangeBusy} onclick={resetArrange}>{m.energy_arrange_reset()}</button>
    <button class="primary-btn pressable" type="button" disabled={arrangeBusy} onclick={finishArrange}>{m.energy_arrange_done()}</button>
  </div>
{/if}

{#if menuOpen}
  <div class="energy-menu" role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
         — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
    <div class="overlay-scrim" onclick={() => (menuOpen = false)}></div>
    <div class="energy-menu-panel overlay-panel" role="dialog" aria-modal="true"
         aria-label={m.energy_menu_title()} tabindex="-1" onkeydown={onMenuKeydown}>
      <header class="ld-header">
        <h2 class="ld-title">{m.energy_menu_title()}</h2>
        <button class="ld-close pressable" type="button" aria-label={m.common_close()}
                onclick={() => (menuOpen = false)}>×</button>
      </header>
      <div class="energy-menu-actions">
        <button class="re-row pressable" type="button" onclick={openWizard}>
          <Icon name="i-auto-fix" cls="icon icon-md" /><span>{m.energy_menu_wizard()}</span>
        </button>
        <button class="re-row pressable" type="button" onclick={openLibrary}>
          <Icon name="i-image" cls="icon icon-md" /><span>{m.energy_menu_library()}</span>
        </button>
        <button class="re-row pressable" type="button" onclick={startArrange} disabled={!frame}>
          <Icon name="i-cursor-move" cls="icon icon-md" /><span>{m.energy_menu_arrange()}</span>
        </button>
        <button class="re-row pressable" type="button" onclick={openSensors}>
          <Icon name="i-flash" cls="icon icon-md" /><span>{m.energy_menu_sensors()}</span>
        </button>
      </div>
    </div>
  </div>
{/if}

{#if wizardOpen}
  {#await wizardLoader.load('wizard') then loaded}
    {@const RoomImageWizard = loaded.default}
    <RoomImageWizard open={wizardOpen} roomId={EXTERIOR_HERO_ID} onclose={() => (wizardOpen = false)} />
  {/await}
{/if}

{#if libraryOpen}
  {#await libraryLoader.load('library') then loaded}
    {@const RoomImageLibrary = loaded.default}
    <RoomImageLibrary open={libraryOpen} targetRoomId={EXTERIOR_HERO_ID} onclose={() => (libraryOpen = false)} />
  {/await}
{/if}

<EnergyLoadOverlay mode={loadOverlay} {breakdown}
                   onRequestClose={closeLoadOverlay}
                   onClosed={() => (loadOverlay = 'hidden')} />
