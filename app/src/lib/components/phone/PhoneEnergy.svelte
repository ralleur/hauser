<script lang="ts">
  import Icon from '../Icon.svelte';
  import { energyView, loadBreakdown } from '../../state/energy.svelte.ts';
  import {
    ENERGY_PERIODS,
    energyPanelData,
    type EnergyPage,
    type EnergyPeriod,
  } from '../../state/energy-periods.ts';
  import { projectPhoneEnergy } from '../../state/phone-energy.ts';

  let period = $state<EnergyPeriod>('today');
  let page = $state<EnergyPage>('flow');
  const e = $derived(energyView());
  const panel = $derived(energyPanelData(e, period, page));
  const breakdown = $derived(loadBreakdown());
  const model = $derived(projectPhoneEnergy(e, breakdown, panel));
  const periodLabel = $derived(ENERGY_PERIODS.find((option) => option.id === period)?.label ?? 'Heute');
  const pageSwitchLabel = $derived(page === 'flow' ? 'Zur Verbrauchsseite wechseln' : 'Zur Energieseite wechseln');
  let expanded = $state(false);

  let { titleAnchor = $bindable() }: { titleAnchor?: HTMLHeadingElement } = $props();
</script>

<main class="phone-energy" aria-labelledby="phone-energy-title">
  <header class="phone-energy-header">
    <h1 bind:this={titleAnchor} id="phone-energy-title" tabindex="-1">Energie</h1>
    <p class:phone-energy-unavailable={model.status.kind !== 'available'} role="status">{model.status.text}</p>
  </header>

  <div class="energy-panel-top phone-energy-toolbar">
    <div class="energy-period-row" role="radiogroup" aria-label="Energie-Zeitraum">
      {#each ENERGY_PERIODS as option (option.id)}
        <button
          class="scene-btn energy-period-btn pressable"
          class:is-active={period === option.id}
          type="button"
          role="radio"
          aria-checked={period === option.id}
          onclick={() => (period = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
    <button
      class="energy-page-toggle pressable"
      class:is-consumption={page === 'consumption'}
      type="button"
      aria-label={pageSwitchLabel}
      title={pageSwitchLabel}
      onclick={() => (page = page === 'flow' ? 'consumption' : 'flow')}
    >
      <Icon name={page === 'flow' ? 'i-home' : 'i-bolt'} cls="icon icon-md" />
    </button>
  </div>

  <section class="phone-energy-section" aria-labelledby="phone-energy-live-title">
    <h2 id="phone-energy-live-title">Aktuell</h2>
    <dl class="phone-energy-live">
      {#each model.live as metric (metric.label)}
        <div>
          <dt>{metric.label}</dt>
          <dd class="num">{metric.value} <span>{metric.unit}</span></dd>
        </div>
      {/each}
    </dl>
    <p class="phone-energy-direction">Netzrichtung: {model.gridDirection}.</p>
  </section>

  <section class="phone-energy-section" aria-labelledby="phone-energy-today-title">
    <h2 id="phone-energy-today-title">{periodLabel}</h2>
    <dl class="phone-energy-kpis">
      {#each model.kpis as metric (metric.label)}
        <div>
          <dt>{metric.label}</dt>
          <dd class="num">{metric.value} <span>{metric.unit}</span></dd>
        </div>
      {/each}
    </dl>
  </section>

  <section class="phone-energy-section" aria-labelledby="phone-energy-load-title">
    <h2 id="phone-energy-load-title">Verbrauch</h2>
    <button
      class="phone-energy-drilldown"
      type="button"
      aria-expanded={expanded}
      aria-controls="phone-energy-breakdown"
      disabled={!model.canExpand}
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? 'Aufteilung schließen' : 'Verbrauch aufteilen'}
    </button>
    {#if !model.canExpand}
      <p class="phone-energy-note">Die erfasste Last ist aktuell unbekannt. Eine Aufteilung ist deshalb nicht verfügbar.</p>
    {/if}
    {#if expanded}
      <div class="phone-energy-breakdown" id="phone-energy-breakdown">
        {#if model.breakdown.length === 0}
          <p class="phone-energy-note">Für die erfasste Last sind aktuell keine aktiven Segmente vorhanden.</p>
        {:else}
          <ul>
            {#each model.breakdown as segment (segment.key)}
              <li>
                <span>{segment.label}</span>
                <span class="num">{segment.value} kW · {segment.share}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </section>
</main>
