<script lang="ts">
  import Icon from './Icon.svelte';
  import LockButton from './LockButton.svelte';
  import { clock } from '../state/clock.svelte.ts';
  import { appearanceMode, cycleAppearanceMode } from '../state/theme.svelte.ts';
  import type { AppearanceMode } from '../state/appearance-mode.ts';
  import { hudClockTap } from '../state/hud.svelte.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { nav } from '../state/nav.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  const conn = $derived(connection());
  const mode = $derived(appearanceMode());
  const modeLabel = $derived(labelForMode(mode));

  function labelForMode(value: AppearanceMode): string {
    if (value === 'auto') return m.appearance_mode_auto();
    if (value === 'interface-light') return m.appearance_mode_interface_light();
    if (value === 'interface-dark') return m.appearance_mode_interface_dark();
    if (value === 'fixed-light') return m.appearance_mode_fixed_day();
    return m.appearance_mode_fixed_evening();
  }

  function iconForMode(value: AppearanceMode): string {
    if (value === 'auto') return 'i-brightness-auto';
    return value === 'interface-light' || value === 'fixed-light'
      ? 'i-white-balance-sunny'
      : 'i-weather-night';
  }

  function isFixed(value: AppearanceMode): boolean {
    return value === 'fixed-light' || value === 'fixed-dark';
  }
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
            aria-label={m.appearance_cycle_label({ mode: modeLabel })}
            title={m.appearance_cycle_label({ mode: modeLabel })}
            onclick={cycleAppearanceMode}>
      <span class="theme-toggle-icon">
        <Icon name={iconForMode(mode)} cls="icon icon-md" />
        {#if isFixed(mode)}
          <Icon name="i-lock" cls="icon theme-toggle-lock" />
        {/if}
      </span>
      <span class="theme-toggle-label">{modeLabel}</span>
    </button>
    <!-- Standby: Langes Halten bietet den direkten Wechsel zum großen Button an. -->
    {#if settingsValues.classicLockButton || nav.screen === 'system'}
      <LockButton variant="titlebar" />
    {/if}
    <span class="ha-status"><span class="dot {conn.dot}"></span>{conn.label}</span>
  </div>
</header>
