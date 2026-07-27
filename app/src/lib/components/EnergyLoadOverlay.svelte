<script lang="ts">
  /* Last-Overlay (B-19): Touch auf die „Erfasste Last" öffnet diese leichte
     Aufschlüsselung als SVG-Donut + Legende. Reuse der Overlay-Shell
     (overlay-scrim/overlay-panel + is-open/is-closing-Zustandsmaschine, s.
     DeviceDetail). Segmentfarben ausschließlich über Tokens (accent-warm-Rampe,
     gemischt mit surface-2); Reduced-Motion greift über die 0ms-Durations der
     wiederverwendeten Overlay-Animationen. Read-only — keine HA-Kommandos. */
  import { fmtKw } from '../format.ts';
  import type { LoadBreakdown, LoadSegment } from '../state/energy-load.ts';

  interface Props {
    mode: 'hidden' | 'open' | 'closing';
    breakdown: LoadBreakdown;
    onRequestClose: () => void;
    onClosed: () => void;
  }
  let { mode, breakdown, onRequestClose, onClosed }: Props = $props();

  /* Donut-Geometrie: pathLength=100 normalisiert jedes Segment auf Prozent,
     so dass dasharray/-offset direkt aus fraction/offset folgen. */
  const R = 42;
  const STROKE = 14;

  /* Monochrome Rampe rein aus Tokens: accent-warm, absteigend Richtung
     surface-2 gemischt — „dezente Segmente" statt greller Dashboard-Farben.
     „Sonstige" bewusst neutral. */
  function segColor(seg: LoadSegment, index: number, count: number): string {
    if (seg.key === 'other') return 'color-mix(in srgb, var(--color-text-tertiary) 60%, var(--color-surface-2))';
    const steps = Math.max(count - 1, 1);
    const pct = 88 - (58 * index) / steps; // 88 % … 30 %
    return `color-mix(in srgb, var(--color-accent-warm) ${pct.toFixed(1)}%, var(--color-surface-2))`;
  }

  const total = $derived(breakdown.total);
  const segments = $derived(breakdown.segments);
  const percent = (fraction: number) => `${Math.round(fraction * 100)} %`;

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && mode === 'open') onRequestClose();
  }

  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (mode === 'open' && panelEl) panelEl.focus();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="energy-load-overlay" class:is-open={mode === 'open'}
     class:is-closing={mode === 'closing'} hidden={mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={onRequestClose}></div>
  <div class="elo-panel overlay-panel" role="dialog" aria-modal="true"
       aria-label="Verbrauchsaufteilung" tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (mode === 'closing' && e.target === e.currentTarget) onClosed(); }}>
    <header class="elo-header">
      <div class="elo-title-group">
        <span class="caps-label">Verbrauchsaufteilung</span>
        <h2 class="elo-title num">{fmtKw(total)}<span class="kpi-unit">kW</span></h2>
      </div>
      <button class="elo-close pressable" type="button" aria-label="Schließen"
              onclick={onRequestClose}>×</button>
    </header>

    {#if segments.length === 0}
      <p class="elo-empty">Aktuell keine erfasste Last.</p>
    {:else}
      <div class="elo-body">
        <div class="elo-donut" aria-hidden="true">
          <svg viewBox="0 0 100 100" role="presentation">
            <g transform="rotate(-90 50 50)">
              <circle class="elo-track" cx="50" cy="50" r={R} fill="none"
                      stroke="var(--color-surface-2)" stroke-width={STROKE} />
              {#each segments as seg, i (seg.key)}
                <circle class="elo-seg" cx="50" cy="50" r={R} fill="none" pathLength="100"
                        stroke={segColor(seg, i, segments.length)} stroke-width={STROKE}
                        stroke-dasharray="{(seg.fraction * 100).toFixed(3)} 100"
                        stroke-dashoffset={(-seg.offset * 100).toFixed(3)} />
              {/each}
            </g>
          </svg>
          <div class="elo-donut-center">
            <span class="num elo-center-value">{fmtKw(total)}</span>
            <span class="caps-label">kW gesamt</span>
          </div>
        </div>

        <ul class="elo-legend">
          {#each segments as seg, i (seg.key)}
            <li class="elo-legend-row">
              <span class="elo-swatch" style="background:{segColor(seg, i, segments.length)}"></span>
              <span class="elo-legend-label">{seg.label}</span>
              <span class="elo-legend-value num">{fmtKw(seg.value)}<span class="kpi-unit">kW</span></span>
              <span class="elo-legend-pct num">{percent(seg.fraction)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
</div>
