<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { whenEditable } from '../state/edit-mode.svelte.ts';
  import { energyAssetUrl } from '../components/energy-hero-assets.ts';
  import { ENERGY_CURVE, SUN_ENTITY, appState } from '../state/app.svelte.ts';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import { energyView, loadBreakdown } from '../state/energy.svelte.ts';
  import EnergyLoadOverlay from '../components/EnergyLoadOverlay.svelte';
  import {
    ENERGY_PERIODS,
    energyPanelData,
    type EnergyPage,
    type EnergyPeriod,
  } from '../state/energy-periods.ts';
  import type { SunValue } from '../adapter/types.ts';
  import { fmtKw } from '../format.ts';
  import { longpress } from '../actions/longpress.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { widthPreset } from '../state/layout-config.ts';

  import { m } from '../../paraglide/messages.js';
  let period = $state<EnergyPeriod>('today');
  let page = $state<EnergyPage>('flow');

  /* Live-Sicht aus realen HA-Sensoren (ADR-018); null = nicht konfiguriert
     bzw. unavailable → „—" / inaktiver Node (Graceful Absence). */
  const e = $derived(energyView());

  /* Last-Overlay (B-19): eigene hidden→open→closing-Zustandsmaschine (Muster
     wie DeviceDetail). Trigger nur, wenn es überhaupt eine erfasste Last gibt. */
  let loadOverlay = $state<'hidden' | 'open' | 'closing'>('hidden');
  const breakdown = $derived(loadBreakdown());
  const canOpenLoad = $derived(e.load !== null);
  function openLoadOverlay() {
    if (canOpenLoad) loadOverlay = 'open';
  }
  function closeLoadOverlay() {
    if (loadOverlay === 'open') loadOverlay = 'closing';
  }
  const sun = $derived(SUN_ENTITY ? runtime.merged(SUN_ENTITY) as SunValue | undefined : undefined);
  const energyHeroUrl = $derived(energyAssetUrl({
    baseUrl: import.meta.env.BASE_URL,
    sun,
    fallbackTheme: appState.theme,
  }));
  const panel = $derived(energyPanelData(e, period, page));
  const hasLiveEnergyValue = $derived(e.pv !== null || e.load !== null);

  /* null-sicher: kW/kWh formatieren oder Gedankenstrich. */
  function dash(v: number | null): string {
    return v === null ? '—' : fmtKw(v);
  }

  /* aktiv nur bei bekanntem, nennenswertem Wert. */
  function active(v: number | null): boolean {
    return v !== null && Math.abs(v) > 0.05;
  }

  /* Geschwindigkeit ∝ Leistung: leise ~3,2 s pro Durchlauf, Volllast ~1,2 s */
  function flowDuration(kw: number | null): string {
    return `${Math.max(1.2, 3.4 - (kw ?? 0) * 0.55).toFixed(2)}s`;
  }

  /* Eigene Breite: dieselben CSS-Variablen wie auf Home, aber aus dem
     Energie-Wert der Layout-Konfiguration. */
  const layoutPreset = $derived(widthPreset(layoutManager.preview, 'energy'));
  const layoutStyle = $derived(
    `--layout-total:${layoutPreset.totalPercent}%;--slot-min:${layoutPreset.slotMinPx}px;--hero-min:${layoutPreset.heroMinPx}px`,
  );

  const grid = $derived(e.grid); // >0 Einspeisung, <0 Bezug, null unbekannt
  const feeding = $derived(grid !== null && grid > 0.05);
  const drawing = $derived(grid !== null && grid < -0.05);
  const pageSwitchLabel = $derived(page === 'flow' ? m.energy_to_consumption() : m.energy_to_energy());
</script>

<!-- ── Energie (Bühnen-Layout analog Home/Hauser-Hero): Nutzinformation links,
     Day/Night-Energy-Eyecatcher rechts. Datenlogik bleibt read-only über
     ENERGY_SENSORS; nicht konfigurierte Sensoren bleiben Graceful Absence. ── -->
<div class="energy-stage" style={layoutStyle}>
  <div class="energy-hero" aria-hidden="true">
    <div class="energy-hero-img" style:background-image={`url("${energyHeroUrl}")`}></div>
    <div class="energy-hero-scrim"></div>
  </div>

  <!-- Long-Press auf der freien Hero-Fläche öffnet — wie auf Home — den
       Layout-Dialog; das Panel liegt darüber (z-index) und bleibt unberührt. -->
  <div class="hero-config-hitarea" aria-label="Freie Hero-Fläche"
       use:longpress={{ onLongPress: whenEditable(() => layoutManager.show('energy')) }}></div>

  <aside class="energy-panel">
    <div class="energy-panel-top">
      <div class="energy-period-row" role="radiogroup" aria-label="Energie-Zeitraum">
        {#each ENERGY_PERIODS as p (p.id)}
          <button class="scene-btn energy-period-btn pressable" type="button" role="radio"
                  aria-checked={period === p.id} class:is-active={period === p.id}
                  onclick={() => (period = p.id)}>
            {p.label}
          </button>
        {/each}
      </div>
      <button class="energy-page-toggle pressable" type="button" aria-label={pageSwitchLabel}
              title={pageSwitchLabel} class:is-consumption={page === 'consumption'}
              onclick={() => (page = page === 'flow' ? 'consumption' : 'flow')}>
        <Icon name={page === 'flow' ? 'i-home' : 'i-bolt'} cls="icon icon-md" />
      </button>
    </div>

    <section class="energy-summary" aria-label={m.energy_current_values()}>
      <div class="energy-primary">
        <span class="chip-label">{panel.primary.label}</span>
        <span class="energy-primary-value num">{dash(panel.primary.value)}<span class="kpi-unit">{panel.primary.unit}</span></span>
      </div>
      <div class="energy-mini-grid">
        {#each panel.secondary as metric (metric.label)}
          <div class="value-chip is-plain">
            <span class="chip-label">{metric.label}</span>
            <span class="chip-value num">{dash(metric.value)}<span class="kpi-unit">{metric.unit}</span></span>
          </div>
        {/each}
      </div>
    </section>

    {#if page === 'flow'}
      <section class="energy-section" aria-label={m.energy_flow()}>
        <span class="caps-label">{m.energy_live_flow()}</span>
        <div class="energy-flow">
          <div class="flow-node" class:is-warm={active(e.pv)} data-node="pv">
            <div class="node-circle"><Icon name="i-sun" /></div>
            <span class="node-value num">{dash(e.pv)}<span class="kpi-unit">kW</span></span>
            <span class="caps-label node-label">{m.energy_solar()}</span>
          </div>
          <div class="flow-line" class:is-active={active(e.pv)} data-line="pv"
               style="--flow-duration:{flowDuration(e.pv)}">
            <div class="line-track">
              <span class="flow-dot"></span><span class="flow-dot dot-2"></span>
            </div>
          </div>
          {#if canOpenLoad}
            <button class="flow-node flow-node-trigger pressable" type="button" data-node="load"
                    aria-haspopup="dialog" aria-label={m.energy_show_breakdown()}
                    onclick={openLoadOverlay}>
              <div class="node-circle"><Icon name="i-home" /></div>
              <span class="node-value num">{dash(e.load)}<span class="kpi-unit">kW</span></span>
              <span class="caps-label node-label">{m.energy_measured_load()}</span>
            </button>
          {:else}
            <div class="flow-node" data-node="load">
              <div class="node-circle"><Icon name="i-home" /></div>
              <span class="node-value num">{dash(e.load)}<span class="kpi-unit">kW</span></span>
              <span class="caps-label node-label">{m.energy_measured_load()}</span>
            </div>
          {/if}
          <!-- Haus ↔ Netz: Richtung kehrt sich mit dem Vorzeichen um -->
          <div class="flow-line" class:is-active={feeding || drawing} class:is-reverse={drawing} class:is-cool={drawing}
               data-line="grid" style="--flow-duration:{flowDuration(grid === null ? null : Math.abs(grid))}">
            <div class="line-track">
              <span class="flow-dot"></span><span class="flow-dot dot-2"></span>
            </div>
          </div>
          <div class="flow-node" class:is-cool={drawing} data-node="grid">
            <div class="node-circle"><Icon name="i-grid" /></div>
            <span class="node-value num">{dash(grid === null ? null : Math.abs(grid))}<span class="kpi-unit">kW</span></span>
            <span class="caps-label node-label">{feeding ? m.energy_grid_feed() : drawing ? m.energy_grid_draw() : m.energy_grid()}</span>
          </div>
        </div>
      </section>
    {:else}
      <section class="energy-section" aria-label={m.energy_consumption_overview()}>
        <span class="caps-label">{m.energy_consumption()}</span>
        {#if canOpenLoad}
          <button class="consumption-card consumption-card-trigger pressable" type="button"
                  aria-haspopup="dialog" aria-label={m.energy_show_breakdown()}
                  onclick={openLoadOverlay}>
            <div class="consumption-mark" aria-hidden="true"><Icon name="i-home" cls="icon icon-xl" /></div>
            <div class="consumption-copy">
              <span class="chip-label">{m.energy_house_load()}</span>
              <span class="chip-value num">{dash(panel.primary.value)}<span class="kpi-unit">{panel.primary.unit}</span></span>
            </div>
          </button>
        {:else}
          <div class="consumption-card">
            <div class="consumption-mark" aria-hidden="true"><Icon name="i-home" cls="icon icon-xl" /></div>
            <div class="consumption-copy">
              <span class="chip-label">{m.energy_house_load()}</span>
              <span class="chip-value num">{dash(panel.primary.value)}<span class="kpi-unit">{panel.primary.unit}</span></span>
            </div>
          </div>
        {/if}
      </section>
    {/if}

    {#if panel.hint}
      <p class="energy-hint">{panel.hint}</p>
    {/if}

    <section class="energy-section" aria-label={m.energy_period_kpis()}>
      <div class="energy-kpis">
        {#each panel.kpis as kpi (kpi.label)}
          <div class="value-chip is-plain">
            <span class="chip-label">{kpi.label}</span>
            <span class="chip-value num">{dash(kpi.value)}<span class="kpi-unit">{kpi.unit}</span></span>
          </div>
        {/each}
      </div>
    </section>

    <!-- Tagesverlauf: Platzhalter (ENERGY_CURVE) bis zur HA-Statistics-API — nur
         für Heute/Flow zeigen, wenn Sensoren konfiguriert sind. -->
    {#if hasLiveEnergyValue && period === 'today' && page === 'flow'}
      <section class="energy-section" aria-label={m.energy_day_curve()}>
        <span class="caps-label">{m.energy_today()}</span>
        <div class="energy-chart">
          <div class="chart-bars">
            {#each ENERGY_CURVE as v, h (h)}
              <div class="chart-hour">
                <span class="bar bar-prod" style="--h:{v.prod.toFixed(3)};--i:{h}"></span>
                <span class="bar bar-load" style="--h:{v.load.toFixed(3)};--i:{h}"></span>
              </div>
            {/each}
          </div>
          <div class="chart-axis num"><span>0</span><span>6</span><span>12</span><span>18</span><span>{m.energy_24h()}</span></div>
          <div class="chart-legend">
            <span><i class="legend-dot legend-prod"></i>{m.energy_production()}</span>
            <span><i class="legend-dot legend-load"></i>{m.energy_consumption()}</span>
          </div>
        </div>
      </section>
    {/if}
  </aside>
</div>

<EnergyLoadOverlay mode={loadOverlay} {breakdown}
                   onRequestClose={closeLoadOverlay}
                   onClosed={() => (loadOverlay = 'hidden')} />
