<script lang="ts">
  import LockButton from './LockButton.svelte';
  import { clock } from '../state/clock.svelte.ts';
  import { hudClockTap } from '../state/hud.svelte.ts';
  import { showClockZoom } from '../state/hidden-gestures.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { connection, retryConnection } from '../state/connection.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { nav } from '../state/nav.svelte.ts';
  import ModeToggle from './ModeToggle.svelte';

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
    <ModeToggle />
  </div>

  <!-- Rechts nur noch Standby: der Erscheinungsbild-Umschalter ist entfallen
       (Owner-Wunsch 2026-09-12), der Modus bleibt unter Oberfläche & Bedienung
       einstellbar. -->
  <div class="status-group status-group-end">
    <!-- Standby: Langes Halten bietet den direkten Wechsel zum großen Button an. -->
    {#if settingsValues.classicLockButton || nav.screen === 'system'}
      <LockButton variant="titlebar" />
    {/if}
  </div>
</header>
