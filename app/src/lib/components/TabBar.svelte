<script lang="ts">
  import Icon from './Icon.svelte';
  import { TABS, activeTab, showScreen, type ScreenId } from '../state/nav.svelte.ts';
  import { closeDeviceDetail } from '../state/overlay.svelte.ts';
  import { centralClimate } from '../state/climate-central.svelte.ts';
  import { appState } from '../state/app.svelte.ts';
  import { fmtTemp } from '../format.ts';
  import { familyCalendar } from '../state/calendar.svelte.ts';
  import { IS_DEMO } from '../demo/demo-mode.ts';
  import { m } from '../../paraglide/messages.js';
  import { pluralCategory } from '../state/locale.svelte.ts';

  const visibleTabs = $derived(TABS.filter((tab) => {
    // Ablage bleibt aus der öffentlichen Demo heraus (docs/12).
    if (tab.id === 'ablage' && IS_DEMO) return false;
    return tab.id !== 'calendar' || familyCalendar.sources.length > 0;
  }));

  const openWindows = $derived(appState.rooms.filter((r) => r.windowOpen));

  /* Plusamorm je Sprache: Deutsch hat zwei, Polnisch vier. */
  const WINDOWS_OPEN = {
    one: m.status_window_open_one, two: m.status_window_open_two,
    few: m.status_window_open_few, many: m.status_window_open_many,
    other: m.status_window_open_other,
  };

  function windowsOpenLabel(count: number): string {
    return WINDOWS_OPEN[pluralCategory(count)]({ count });
  }
  const securityLabel = $derived(
    openWindows.length === 0
      ? m.status_all_quiet()
      : windowsOpenLabel(openWindows.length),
  );

  function go(target: string) {
    closeDeviceDetail(true);  // Detail gehört zum aufrufenden Tab

    showScreen(target as ScreenId);
  }
</script>

<!-- ── Tab-Bar (persistent, Hauser-Rahmen-Bar unten; IA: docs/07) ──
     Links das globale Klima-Dock (zentrale Synchron-Steuerung, aus jedem Screen
     erreichbar — wie das Fahrzeug-UI), mittig die Navigation, rechts der globale
     Sicherheitsstatus. Gleiche Rand-Zonen halten die Tabs zentriert. -->
<nav class="tab-bar" aria-label={m.nav_main()}>
  <div class="tab-edge tab-edge-start">
    {#if centralClimate.hasClimate}
      <div class="climate-dock" aria-label={m.status_climate_central()}>
        <button class="cd-key cd-key-down pressable" type="button" aria-label={m.status_all_rooms_cooler()}
                onclick={() => centralClimate.step(-0.5)}><Icon name="i-chevron-down" cls="icon cd-chevron" /></button>
        <div class="cd-readout">
          <span class="cd-value num" class:is-mixed={!centralClimate.isSynced}>{fmtTemp(centralClimate.value)}°</span>
          <span class="cd-sub">{m.status_all_rooms()}</span>
        </div>
        <button class="cd-key cd-key-up pressable" type="button" aria-label={m.status_all_rooms_warmer()}
                onclick={() => centralClimate.step(0.5)}><Icon name="i-chevron-up" cls="icon cd-chevron" /></button>
      </div>
    {/if}
  </div>

  <div class="tab-nav">
    {#each visibleTabs as tab (tab.id)}
      <button class="tab pressable" class:is-active={activeTab() === tab.id}
              type="button" data-nav={tab.id} aria-label={tab.label}
              onclick={() => go(tab.id)}>
        <Icon name={tab.icon} cls="icon tab-icon" /><span class="tab-label">{tab.label}</span><span class="tab-indicator"></span>
      </button>
    {/each}
  </div>

  <div class="tab-edge tab-edge-end">
    <div class="security-bar" class:has-warning={openWindows.length > 0}
         title={openWindows.length ? openWindows.map((r) => r.name).join(', ') : m.status_all_quiet()}>
      <Icon name={openWindows.length ? 'i-window' : 'i-shield'} cls="icon icon-md" />
      <span>{securityLabel}</span>
    </div>
  </div>
</nav>
