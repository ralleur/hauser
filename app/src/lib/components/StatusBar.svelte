<script lang="ts">
  import LockButton from './LockButton.svelte';
  import { clock } from '../state/clock.svelte.ts';
  import { hudClockTap } from '../state/hud.svelte.ts';
  import { showClockZoom } from '../state/hidden-gestures.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { connection, retryConnection } from '../state/connection.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { nav, showScreen } from '../state/nav.svelte.ts';
  import ModeToggle from './ModeToggle.svelte';
  import Icon from './Icon.svelte';
  import { m } from '../../paraglide/messages.js';
  import { openFeedback } from '../state/feedback.svelte.ts';

  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { layoutHomeView, type HomeViewId } from '../state/layout-config.ts';
  import { appState } from '../state/app.svelte.ts';
  import { openRoomEdit } from '../state/overlay.svelte.ts';

  let modeToggle: ModeToggle | undefined = $state();
  const homeView = $derived(layoutHomeView(layoutManager.applied));
  const viewLabel = $derived(homeView === 'rooms' ? m.layout_home_view_rooms()
    : homeView === 'image' ? m.layout_home_view_image() : m.layout_home_view_fullscreen());
  const viewHint = $derived(m.layout_cycle_view({ view: viewLabel }));

  function cycleView(): void {
    const views: HomeViewId[] = ['fullscreen', 'rooms', 'image'];
    layoutManager.setHomeView(views[(views.indexOf(homeView) + 1) % views.length]);
    showScreen('home');
  }

  function openConfiguration(): void {
    modeToggle?.enterEditMode(() => {
      showScreen('home');
      const roomId = appState.currentRoom ?? appState.rooms[0]?.id;
      if (roomId) openRoomEdit(roomId);
    });
  }

  const conn = $derived(connection());
</script>

<!-- ── Status-Bar (persistent, Hauser-Rahmen-Bar oben) ── -->
<header class="status-bar">
  <div class="status-group">
    <!-- svelte-ignore a11y_no_static_element_interactions — Dev-Easter-Egg
         (3× Tap = HUD), kein Bedienelement; DOM bleibt identisch zu Phase 2.
         Langes Drücken zeigt Sekunden und Datum groß (Paket 10). -->
    <span class="status-clock num" onpointerdown={hudClockTap}
          use:longpress={{ enabled: true, onLongPress: showClockZoom }}>{clock.time}</span>
    <span class="status-date">{clock.date}</span>
  </div>
  <!-- Mitte: Bearbeiten ⇄ Bedienen. „Bedienen" sperrt die Konfigurations-
       Zugänge; Geräte bleiben voll bedienbar. Getrennt: das Rad wird rot und
       ein Tipp darauf verbindet zugleich neu — die frühere Statusanzeige rechts
       ist entfallen (Owner-Wunsch 2026-09-12). -->
  <!-- svelte-ignore a11y_no_static_element_interactions — reiner Mitlauscher,
       der Knopf darin bleibt das Bedienelement. -->
  <div class="mode-toggle-slot" title={conn.banner ?? undefined}
       onclickcapture={() => { if (conn.banner !== null) retryConnection(); }}>
    <ModeToggle bind:this={modeToggle} />
  </div>

  <!-- Rechts nur noch Standby: der Erscheinungsbild-Umschalter ist entfallen
       (Owner-Wunsch 2026-09-12), der Modus bleibt unter Oberfläche & Bedienung
       einstellbar. -->
  <div class="status-group status-group-end">
    <button class="standby-btn pressable" type="button" aria-label={viewHint}
            title={viewHint} onclick={cycleView}
            use:longpress={{ onLongPress: openConfiguration }}>
      <Icon name={homeView === 'rooms' ? 'i-view-grid-outline' : homeView === 'image' ? 'i-image-outline' : 'i-view-dashboard-outline'} cls="icon icon-md" />
    </button>
    <!-- Fragezeichen (R40): Problem melden oder Vorschlag machen, ohne Konto. -->
    <button class="standby-btn pressable" type="button" aria-label={m.feedback_button_label()}
            title={m.feedback_button_label()} onclick={openFeedback}>
      <Icon name="i-help-circle-outline" cls="icon icon-md" />
    </button>
    <!-- Standby: Langes Halten bietet den direkten Wechsel zum großen Button an. -->
    {#if settingsValues.classicLockButton || nav.screen === 'system'}
      <LockButton variant="titlebar" />
    {/if}
  </div>
</header>
