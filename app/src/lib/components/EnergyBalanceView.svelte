<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Die Tagesbilanz als ein Bild (wie die iOS-App): oben, was die Sonne
     erzeugt hat, unten, was das Haus verbraucht hat — auf einer kWh-Achse. Das
     selbst genutzte Stück steht in beiden Balken am Nullpunkt und ist gleich
     lang, eine blasse Goldbrücke verbindet es: dieselbe Energie, zweimal
     gesehen. Oben ragt hinaus, was ins Netz ging; unten füllt das Blau die
     Lücke. Ein Tipp auf ein Stück legt den Papierzettel der Energie-Bühne
     darüber. */
  import { m } from '../../paraglide/messages.js';
  import { intlLocale } from '../state/locale.svelte.ts';
  import {
    balanceAxis, balanceCounted, balancePercent, balanceSegments, balanceSelfUsePercent,
    type BalancePart, type EnergyBalance,
  } from '../state/energy-balance.ts';

  let { balance, compact = false }: { balance: EnergyBalance; compact?: boolean } = $props();

  type Row = 0 | 1;
  let focus = $state<{ row: Row; part: BalancePart } | null>(null);

  function kwh(value: number): string {
    return value.toLocaleString(intlLocale(), { minimumFractionDigits: value >= 100 ? 0 : 1, maximumFractionDigits: value >= 100 ? 0 : 1 });
  }

  function title(part: BalancePart): string {
    switch (part) {
      case 'ownUse': return m.energy_balance_own_use();
      case 'fedIn': return m.energy_fed_in();
      case 'drawn': return m.energy_drawn();
      case 'produced': return m.energy_produced();
      case 'consumed': return m.energy_consumed();
    }
  }
  const tone = (part: BalancePart) => (part === 'drawn' ? 'is-cool' : part === 'consumed' ? '' : 'is-warm');

  const counted = $derived(balanceCounted(balance));
  const split = $derived(balance.kind === 'split');
  const percent = $derived(balancePercent(balance));
  const selfUse = $derived(balanceSelfUsePercent(balance));

  const figure = $derived(percent !== null
    ? { value: String(percent), unit: '%' }
    : { value: `+${kwh(Math.max(0, balance.produced - balance.consumed))}`, unit: 'kWh' });
  const line = $derived(percent !== null
    ? (split ? m.energy_balance_line_split() : m.energy_balance_line_net())
    : (split ? m.energy_balance_surplus_split() : m.energy_balance_surplus_net()));
  const gap = $derived.by(() => {
    /* Ohne Netzzähler kein Bezug: max(0, V − E) wäre nur eine Untergrenze. */
    if (!split) return balance.produced >= balance.consumed ? m.energy_balance_net_surplus() : m.energy_balance_net_deficit();
    if (balance.produced < 0.05) return m.energy_balance_all_grid();
    if (balance.drawn < 0.05) return m.energy_balance_no_grid();
    return m.energy_balance_gap({ kwh: kwh(balance.drawn) });
  });
  /* Die Einsicht des Tages: mehr erzeugt als gebraucht, und trotzdem Netz —
     weil Mittag und Abend auseinanderliegen. */
  const aside = $derived(split && balance.produced > balance.consumed && balance.drawn >= 0.05 ? m.energy_balance_aside() : null);
  const footnote = $derived.by(() => {
    if (!split) return m.energy_balance_foot_net();
    const base = m.energy_balance_foot_split();
    return balance.meter !== null && counted ? `${base} ${m.energy_balance_foot_meter({ kwh: kwh(balance.meter) })}` : base;
  });

  const axis = $derived(balanceAxis(Math.max(balance.produced, balance.consumed)));
  const x = (value: number) => (Math.min(Math.max(value, 0), axis.top) / axis.top) * 100;
  const rows = $derived<[Row, string, number][]>([
    [0, m.energy_produced(), balance.produced],
    [1, balance.meter === null ? m.energy_consumed() : m.energy_balance_household(), balance.consumed],
  ]);
  const axisLabel = (tick: number) => {
    const number = tick.toLocaleString(intlLocale(), { maximumFractionDigits: axis.step < 1 ? 1 : 0, minimumFractionDigits: axis.step < 1 ? 1 : 0 });
    return tick + axis.step / 2 > axis.top ? `${number} kWh` : number;
  };

  /* Anteil und Herkunft auf dem Zettel; die Paare ergänzen sich auf 100. */
  function details(row: Row, part: BalancePart): string[] {
    const ofMade = (p: number): string => m.energy_balance_of_production({ p: String(p) });
    const ofUsed = (p: number): string => m.energy_balance_of_consumption({ p: String(p) });
    const measured: string = m.energy_balance_measured();
    const calculated: string = m.energy_balance_calculated();
    const lines = (share: string | null, origin: string): string[] => (share === null ? [origin] : [share, origin]);
    if (row === 0 && part === 'ownUse') return lines(selfUse !== null ? ofMade(selfUse) : null, calculated);
    if (part === 'fedIn') return lines(selfUse !== null ? ofMade(100 - selfUse) : null, measured);
    if (part === 'ownUse') return lines(percent !== null ? ofUsed(percent) : null, calculated);
    if (part === 'drawn') return lines(percent !== null ? ofUsed(100 - percent) : null, measured);
    return [measured];
  }

  function toggle(row: Row, part: BalancePart) {
    focus = focus && focus.row === row && focus.part === part ? null : { row, part };
  }
  const dimmed = (part: BalancePart) => focus !== null && focus.part !== part;

  const focused = $derived(focus ? balanceSegments(balance, focus.row).find((segment) => segment.part === focus!.part) ?? null : null);
  const legend = $derived(split
    ? ([[0, 'ownUse', balance.ownUse], [0, 'fedIn', balance.fedIn], [1, 'drawn', balance.drawn]] as [Row, BalancePart, number][])
        .filter(([, , value]) => value >= 0.005)
    : []);
</script>

<div class="eb" class:is-compact={compact}>
  {#if counted}
    <div class="eb-head">
      <p class="eb-figure num">{figure.value}<span class="eb-figure-unit">{figure.unit}</span></p>
      <div class="eb-lines">
        <p class="eb-line">{line}</p>
        <p class="eb-gap">{gap}</p>
        {#if aside}<p class="eb-aside">{aside}</p>{/if}
      </div>
    </div>

    <div class="eb-bars">
      <div class="eb-labels">
        {#each rows as [row, label, value] (row)}
          <div class="eb-row-label">
            <span class="caps-label">{label}</span>
            <span class="eb-row-value num">{kwh(value)}<span class="kpi-unit">kWh</span></span>
          </div>
        {/each}
      </div>
      <div class="eb-plot">
        {#each axis.ticks as tick (tick)}
          <span class="eb-tick" class:is-last={tick + axis.step / 2 > axis.top} style={`--x:${x(tick)}`}>
            <span class="eb-tick-label num">{axisLabel(tick)}</span>
          </span>
        {/each}
        {#if split && balance.ownUse > 0}
          <span class="eb-bridge" class:is-dim={dimmed('ownUse')} style={`--w:${x(balance.ownUse)}`}></span>
        {/if}
        {#each rows as [row] (row)}
          {@const parts = balanceSegments(balance, row)}
          <div class="eb-track" class:is-bottom={row === 1}>
            {#each parts as segment (segment.part)}
              <button class="eb-piece is-{segment.part}" type="button" class:is-dim={dimmed(segment.part)}
                      class:has-seam={segment.to < (parts.at(-1)?.to ?? 0)}
                      style={`--from:${x(segment.from)};--to:${x(segment.to)}`}
                      aria-label={m.energy_balance_piece({ title: title(segment.part), kwh: kwh(segment.to - segment.from) })}
                      aria-pressed={focus?.row === row && focus?.part === segment.part}
                      onclick={() => toggle(row, segment.part)}></button>
            {/each}
          </div>
        {/each}
        {#if focus && focused}
          <div class="energy-mark eb-note {tone(focused.part)}" class:is-below={focus.row === 1}
               style={`--mark-x:${Math.min(Math.max(x((focused.from + focused.to) / 2), 18), 82)};--mark-tilt:-0.8deg`}>
            <span class="caps-label mark-label">{title(focused.part)}</span>
            <span class="mark-value num">{kwh(focused.to - focused.from)}<span class="kpi-unit">kWh</span></span>
            {#each details(focus.row, focused.part) as detail (detail)}<span class="eb-note-detail">{detail}</span>{/each}
          </div>
        {/if}
      </div>
    </div>

    {#if legend.length > 0}
      <div class="eb-legend">
        {#each legend as [row, part, value] (part)}
          <button class="eb-key pressable" type="button" class:is-dim={dimmed(part)} onclick={() => toggle(row, part)}>
            <span class="eb-dot is-{part}" aria-hidden="true"></span>
            <span class="eb-key-label">{title(part)}</span>
            <span class="eb-key-value num">{kwh(value)}</span>
          </button>
        {/each}
      </div>
    {/if}
  {:else if balance.meter !== null}
    <p class="eb-line">{m.energy_balance_night({ kwh: kwh(balance.meter) })}</p>
  {:else}
    <p class="eb-line">{m.energy_balance_quiet()}</p>
  {/if}
  <p class="eb-foot">{footnote}</p>
</div>

<style>
  .eb { --eb-bar: 44px; --eb-bridge: 28px; display: flex; flex-direction: column; color: var(--color-text-primary); }
  /* Kompakt (Telefon): Beschriftung und Wert brauchen zusammen gut 34 px. */
  .eb.is-compact { --eb-bar: 36px; --eb-bridge: 14px; }
  .eb p { margin: 0; }

  .eb-head { display: flex; align-items: baseline; gap: var(--space-4); }
  .eb.is-compact .eb-head { gap: var(--space-3); }
  .eb-figure {
    flex: none;
    font-family: var(--font-family-display);
    font-size: 80px;
    line-height: 1;
    color: var(--color-accent-warm);
  }
  .eb.is-compact .eb-figure { font-size: 44px; color: var(--color-text-primary); }
  .eb-figure-unit { font-size: 0.42em; margin-left: 2px; }
  .eb-lines { display: flex; flex-direction: column; gap: var(--space-1); }
  .eb-line { font-size: var(--text-lg); font-weight: var(--font-weight-medium); }
  .eb.is-compact .eb-line { font-size: var(--text-md, 15px); }
  .eb-gap { font-size: var(--text-md, 16px); color: var(--color-text-secondary); }
  .eb.is-compact .eb-gap { font-size: var(--text-sm); }
  .eb-aside { font-size: var(--text-sm); color: var(--color-text-tertiary); }

  .eb-bars { display: flex; gap: var(--space-4); margin-top: calc(var(--space-6) + var(--space-2)); }
  .eb.is-compact .eb-bars { gap: var(--space-3); margin-top: var(--space-5); }
  .eb-labels { flex: none; width: 112px; display: flex; flex-direction: column; gap: var(--eb-bridge); }
  .eb.is-compact .eb-labels { width: 96px; }
  .eb-row-label { height: var(--eb-bar); display: flex; flex-direction: column; justify-content: center; min-width: 0; line-height: 1.1; }
  .eb.is-compact .eb-row-label .caps-label { font-size: 10px; }
  .eb-row-label .caps-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 14px; }
  .eb-row-value { font-family: var(--font-family-display); font-size: 26px; line-height: 1.1; white-space: nowrap; }
  .eb.is-compact .eb-row-value { font-size: 20px; }
  .eb-row-value .kpi-unit { margin-left: 3px; font-family: var(--font-family); font-size: 13px; color: var(--color-text-tertiary); }

  .eb-plot { position: relative; flex: 1; min-width: 0; height: calc(var(--eb-bar) * 2 + var(--eb-bridge) + 32px); }
  .eb-tick {
    position: absolute;
    top: -6px;
    left: calc(var(--x) * 1%);
    height: calc(var(--eb-bar) * 2 + var(--eb-bridge) + 12px);
    border-left: 1px dashed color-mix(in srgb, var(--color-text-primary) 16%, transparent);
  }
  .eb-tick-label {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    transform: translateX(-50%);
    font-size: 12px;
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .eb-tick.is-last .eb-tick-label { transform: translateX(-100%); }
  .eb-track {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: var(--eb-bar);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  }
  .eb-track.is-bottom { top: calc(var(--eb-bar) + var(--eb-bridge)); }
  .eb-bridge {
    position: absolute;
    left: 0;
    top: var(--eb-bar);
    width: max(0px, calc(var(--w) * 1% - 2px));
    height: var(--eb-bridge);
    background: color-mix(in srgb, var(--color-accent-warm) 14%, transparent);
    animation: eb-grow var(--duration-enter) var(--ease-out) both;
    transform-origin: left;
  }
  .eb-piece {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--from) * 1%);
    width: max(3px, calc((var(--to) - var(--from)) * 1%));
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transform-origin: left;
    animation: eb-grow var(--duration-enter) var(--ease-out) both;
    transition: opacity var(--duration-normal) var(--ease-out);
  }
  .eb-piece.has-seam { width: max(3px, calc((var(--to) - var(--from)) * 1% - 2px)); }
  .eb-piece::after { content: ''; position: absolute; inset: -8px 0; }
  .is-ownUse, .is-produced { background: var(--color-accent-warm); }
  .is-fedIn {
    background: color-mix(in srgb, var(--color-accent-warm) 32%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent-warm) 55%, transparent);
  }
  .is-drawn { background: var(--color-accent-cool); }
  .is-consumed { background: color-mix(in srgb, var(--color-text-primary) 28%, transparent); }
  .is-dim { opacity: 0.4; }
  .eb-piece:focus-visible { outline: 2px solid var(--color-accent-warm); outline-offset: 2px; }

  .eb-note { top: calc(-1 * var(--space-4)); transform: translate(-50%, -100%) rotate(var(--mark-tilt)); pointer-events: none; z-index: 1; }
  .eb-note.is-below { top: calc(var(--eb-bar) * 2 + var(--eb-bridge) + var(--space-4)); transform: translate(-50%, 0) rotate(var(--mark-tilt)); }
  .eb-note :global(.mark-value) { font-size: var(--text-2xl); }
  .eb-note-detail { font-size: 12px; color: #4d4a44; }

  .eb-legend { display: flex; flex-wrap: wrap; gap: var(--space-5); margin-top: var(--space-5); }
  .eb.is-compact .eb-legend { gap: var(--space-3); margin-top: var(--space-3); }
  .eb-key {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-min);
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 15px;
    transition: opacity var(--duration-normal) var(--ease-out);
  }
  .eb-key.is-dim { opacity: 0.5; }
  .eb-key-label { color: var(--color-text-secondary); }
  .eb-key-value { font-weight: var(--font-weight-medium); }
  .eb-dot { width: 10px; height: 10px; border-radius: 50%; }

  .eb-foot { margin-top: var(--space-4) !important; font-size: 13px; color: var(--color-text-tertiary); }
  .eb.is-compact .eb-foot { margin-top: var(--space-3) !important; }

  @keyframes eb-grow { from { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) {
    .eb-piece, .eb-bridge { animation: none; }
  }
</style>
