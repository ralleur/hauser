<script lang="ts">
  import Icon from './Icon.svelte';
  import LockButton from './LockButton.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { clock } from '../state/clock.svelte.ts';
  import { toggleTheme } from '../state/theme.svelte.ts';
  import { hudClockTap } from '../state/hud.svelte.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';

  const conn = $derived(connection());
</script>

<!-- ── Status-Bar (persistent, Hauser-Rahmen-Bar oben) ── -->
<header class="status-bar">
  <div class="status-group">
    <!-- svelte-ignore a11y_no_static_element_interactions — Dev-Easter-Egg
         (3× Tap = HUD), kein Bedienelement; DOM bleibt identisch zu Phase 2 -->
    <span class="status-clock num" onpointerdown={hudClockTap}>{clock.time}</span>
    <span class="status-date">{clock.date}</span>
  </div>
  <div class="status-group">
    <button class="theme-toggle pressable" type="button"
            aria-label="Tag/Nacht manuell umschalten (24 h Vorrang vor der sun.sun-Automatik)"
            onclick={toggleTheme}>
      <Icon name={appState.theme === 'dark' ? 'i-moon' : 'i-sun'} cls="icon icon-md" />
    </button>
    <!-- Standby: Langes Halten bietet den direkten Wechsel zum großen Button an. -->
    {#if settingsValues.classicLockButton}
      <LockButton variant="titlebar" />
    {/if}
    <span class="ha-status"><span class="dot {conn.dot}"></span>{conn.label}</span>
  </div>
</header>
