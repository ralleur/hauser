<script lang="ts">
  /* Hauser-Tick-Regler: Leiter kleiner Rechtecke. Zwei Modi:
     - fill (Helligkeit): Ticks bis zum Wert gefüllt, aktueller Tick als Marker.
     - gradient (Farbtemperatur): jeder Tick entlang warm→kühl eingefärbt,
       aktueller Tick als Marker. Vertikal ist oben = max, horizontal links = min.
     Mechanik/A11y liegt in der tickscale-Action; hier nur reaktives Rendering. */
  import { tickscale } from '../actions/tickscale.ts';
  import { onMount } from 'svelte';

  interface Props {
    value: number; min: number; max: number;
    step?: number; keyStep?: number;
    orientation?: 'vertical' | 'horizontal';
    mode?: 'fill' | 'gradient';
    tickCount?: number;
    ariaLabel: string;
    disabled?: boolean;
    /** gradient-Modus: Farbe je Tick (Positionsanteil 0..1) */
    tint?: (pf: number) => string;
    /** fill-Modus: CSS-Farbe aktiver Ticks (default warmer Akzent) */
    fillColor?: string;
    /** Kurzer compositor-only Aufbau der aktiven Ticks beim Mounten. */
    intro?: boolean;
    onInput: (val: number, final: boolean) => void;
    /** großer Wert-Text (wie „67 %" im Referenzbild) */
    format?: (v: number) => string;
  }

  const {
    value, min, max, step = 1, keyStep, orientation = 'vertical',
    mode = 'fill', tickCount, ariaLabel, disabled = false,
    tint, fillColor, intro = false, onInput, format,
  }: Props = $props();

  let introActive = $state(false);

  onMount(() => {
    if (!intro) return;
    introActive = true;
    const timeout = setTimeout(() => (introActive = false), 260);
    return () => clearTimeout(timeout);
  });

  const vertical = $derived(orientation === 'vertical');
  const n = $derived(tickCount ?? (vertical ? 20 : 24));
  const frac = $derived(max > min ? (value - min) / (max - min) : 0);

  // Positionsanteil je Tick (DOM-Reihenfolge j=0..n-1): vertikal oben=max.
  const pfs = $derived(Array.from({ length: n }, (_, j) => (vertical ? 1 - j / (n - 1) : j / (n - 1))));
  // Aktueller Tick = der mit kleinstem Abstand zum Wert-Anteil (Marker).
  const currentIdx = $derived(
    pfs.reduce((best, pf, j) => (Math.abs(pf - frac) < Math.abs(pfs[best] - frac) ? j : best), 0),
  );
</script>

<div class="tickscale" class:is-vertical={vertical} class:is-horizontal={!vertical}
     class:is-intro={introActive}
     class:is-disabled={disabled}
     role="slider" tabindex={disabled ? -1 : 0}
     aria-label={ariaLabel} aria-valuemin={min} aria-valuemax={max}
     aria-valuenow={Math.round(value)} aria-orientation={orientation} aria-disabled={disabled}
     style={fillColor ? `--ts-fill:${fillColor}` : undefined}
     onpointerdown={() => (introActive = false)}
     use:tickscale={{ value, min, max, step, keyStep, orientation, disabled, onChange: onInput }}>
  <div class="tickscale-track">
    {#each pfs as pf, j (j)}
      <span class="tick"
            class:is-active={mode === 'fill' && frac > 0 && pf <= frac + 1e-6}
            class:is-current={j === currentIdx}
            style={`${mode === 'gradient' && tint ? `background:${tint(pf)};` : ''}--charge-order:${vertical ? n - 1 - j : j}`}></span>
    {/each}
  </div>
  {#if format}<div class="tickscale-value num">{format(value)}</div>{/if}
</div>
