<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { ENERGY_SENSORS } from '../../state/app.svelte.ts';
  import { energyView, loadBreakdown } from '../../state/energy.svelte.ts';
  import {
    energyCurve, energyPeriodTotals, energyYesterdayCurve, initEnergyHistory, periodWindow,
  } from '../../state/energy-history.svelte.ts';
  import { energyPanelData, type EnergyPeriod } from '../../state/energy-periods.ts';
  import { intlLocale } from '../../state/locale.svelte.ts';
  import { projectPhoneEnergy } from '../../state/phone-energy.ts';

  let { titleAnchor = $bindable() }: { titleAnchor?: HTMLHeadingElement } = $props();

  /* Der Zeitraum gehört zur Auswertung, nicht zum Live-Wert: „Jetzt" bleibt
     oben stehen, egal was unten gewählt ist. */
  const PERIODS: { id: EnergyPeriod; label: () => string }[] = [
    { id: 'today', label: () => m.period_today() },
    { id: 'week', label: () => m.period_short_week() },
    { id: 'month', label: () => m.period_short_month() },
    { id: 'total', label: () => m.period_total() },
  ];
  let period = $state<EnergyPeriod>('today');
  let showAll = $state(false);

  /* Minuten-Ticker für „bis jetzt" und die Vergleichsgrenze. */
  let now = $state(new Date());
  $effect(() => {
    initEnergyHistory();
    const timer = setInterval(() => { now = new Date(); }, 60 * 1000);
    return () => clearInterval(timer);
  });
  const nowFraction = $derived((now.getHours() * 60 + now.getMinutes()) / 1440);
  const timeLabel = $derived(now.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }));

  const e = $derived(energyView());
  const sums = $derived(period === 'today' ? null : energyPeriodTotals(period));
  const panel = $derived(energyPanelData(e, period, 'flow', sums));
  const curve = $derived(energyCurve());
  const model = $derived(projectPhoneEnergy(e, loadBreakdown(), panel, {
    curve, yesterday: energyYesterdayCurve(), nowFraction, loadSourceCount: ENERGY_SENSORS.load.length,
  }));

  /* Der konkrete Zeitraum unter der Auswahl: „Woche" ist die letzte
     Kalenderwoche, „Monat" der letzte Kalendermonat — die Zeile sagt es. */
  const rangeLabel = $derived.by(() => {
    if (period === 'today') return m.phone_energy_range_today({ time: timeLabel });
    if (period === 'total') return m.phone_energy_range_total();
    const { start, end } = periodWindow(period, now);
    if (period === 'month') return start.toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });
    const last = new Date(end.getTime() - 1);
    const day = (d: Date) => d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
    return `${day(start)} – ${day(last)}`;
  });

  /* Verlauf heute als Fläche über 24 h; ohne Statistik keine Kurve, sondern
     nur die Zahlen. */
  const CURVE_H = 56;
  const curveMax = $derived(curve ? Math.max(0.1, ...curve.map((p) => p.load ?? 0)) : 1);
  const loadArea = $derived.by(() => {
    if (!curve) return null;
    const pts = curve.filter((p) => p.load !== null);
    if (pts.length < 2) return null;
    const y = (v: number) => (CURVE_H - Math.min(1, v / curveMax) * CURVE_H).toFixed(2);
    const line = pts.map((p) => `${(p.t * 100).toFixed(2)},${y(p.load ?? 0)}`).join(' ');
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    return {
      line,
      area: `${(first.t * 100).toFixed(2)},${CURVE_H} ${line} ${(last.t * 100).toFixed(2)},${CURVE_H}`,
    };
  });

  const TOP_COUNT = 3;
  const visibleConsumers = $derived(showAll ? model.consumers : model.consumers.slice(0, TOP_COUNT));
</script>

<main class="phone-energy" aria-labelledby="phone-energy-title">
  <header class="phone-energy-header">
    <h1 bind:this={titleAnchor} id="phone-energy-title" tabindex="-1">{m.phone_energy_title()}</h1>
    {#if model.status.kind !== 'available'}
      <p class="phone-energy-status" role="status">{model.status.text}</p>
    {/if}
  </header>

  {#if model.now || model.nowLines.length}
    <section class="phone-energy-now" aria-label={m.phone_energy_now()}>
      {#if model.now}
        <p class="phone-energy-now-label">{model.now.label}</p>
        <p class="phone-energy-now-value num">{model.now.power.value}<span class="phone-energy-unit">{model.now.power.unit}</span></p>
      {/if}
      {#if model.nowLines.length}
        <ul class="phone-energy-now-lines">
          {#each model.nowLines as line (line.label)}
            <li><span>{line.label}</span><span class="num">{line.power.value} {line.power.unit}</span></li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="phone-energy-section" aria-labelledby="phone-energy-period-title">
    <h2 id="phone-energy-period-title" class="phone-visually-hidden">{m.phone_energy_period()}</h2>
    <div class="phone-energy-periods" role="radiogroup" aria-label={m.phone_energy_period()}>
      {#each PERIODS as option (option.id)}
        <button class="phone-energy-period pressable" class:is-active={period === option.id}
                type="button" role="radio" aria-checked={period === option.id}
                onclick={() => (period = option.id)}>{option.label()}</button>
      {/each}
    </div>
    <p class="phone-energy-range">{rangeLabel}</p>

    {#if model.lead}
      <p class="phone-energy-lead">
        <span class="phone-energy-lead-label">{model.lead.label}</span>
        <span class="phone-energy-lead-value num">{model.lead.value}<span class="phone-energy-unit">{model.lead.unit}</span></span>
      </p>
    {/if}

    {#if period === 'today' && loadArea}
      <figure class="phone-energy-curve" aria-label={m.energy_today()}>
        <svg viewBox="0 0 100 {CURVE_H}" preserveAspectRatio="none" aria-hidden="true">
          <polygon class="phone-energy-curve-area" points={loadArea.area}></polygon>
          <polyline class="phone-energy-curve-line" points={loadArea.line}></polyline>
        </svg>
        <figcaption class="phone-energy-axis" aria-hidden="true">
          <span>0</span><span>6</span><span>12</span><span>18</span><span>{m.energy_24h()}</span>
        </figcaption>
      </figure>
    {/if}

    {#if period === 'today' && model.comparison}
      <p class="phone-energy-compare">
        <span>{m.phone_energy_yesterday_until({ time: timeLabel })}</span>
        <span class="num">{model.comparison.yesterday} kWh</span>
        {#if model.comparison.deltaPct !== null}
          <span class="phone-energy-delta num" class:is-up={model.comparison.deltaPct > 0}>
            {model.comparison.deltaPct > 0 ? '+' : ''}{model.comparison.deltaPct.toLocaleString(intlLocale())} %
          </span>
        {/if}
      </p>
    {/if}

    {#if model.rest.length}
      <dl class="phone-energy-kpis">
        {#each model.rest as metric (metric.label)}
          <div>
            <dt>{metric.label}</dt>
            <dd class="num">{metric.value}<span class="phone-energy-unit">{metric.unit}</span></dd>
          </div>
        {/each}
      </dl>
    {/if}

    {#if model.hint}
      <p class="phone-energy-note">{model.hint}</p>
    {/if}
  </section>

  {#if model.consumers.length}
    <section class="phone-energy-section" aria-labelledby="phone-energy-consumers-title">
      <h2 id="phone-energy-consumers-title">{m.phone_energy_top_consumers()}</h2>
      <ul class="phone-energy-consumers">
        {#each visibleConsumers as consumer (consumer.key)}
          <li style="--share:{consumer.share}">
            <span class="phone-energy-consumer-label">{consumer.label}</span>
            <span class="phone-energy-consumer-value num">{consumer.power.value} {consumer.power.unit}</span>
            <span class="phone-energy-consumer-share num">{consumer.sharePct}</span>
            <span class="phone-energy-consumer-bar" aria-hidden="true"></span>
          </li>
        {/each}
      </ul>
      {#if model.consumers.length > TOP_COUNT}
        <button class="phone-energy-more pressable" type="button" aria-expanded={showAll}
                onclick={() => (showAll = !showAll)}>
          {showAll ? m.phone_energy_show_less() : m.phone_energy_show_all()}
        </button>
      {/if}
    </section>
  {/if}
</main>
