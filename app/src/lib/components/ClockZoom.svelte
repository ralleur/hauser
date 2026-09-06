<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Uhr lange drücken (Paket 10): Sekunden und Datum in Großschrift, solange
     der Finger liegt. Kein Menüeintrag, kein Zustand, der irgendwo hängen
     bleibt — Loslassen räumt die Ansicht ab. Erst bei Bedarf geladen. */
  import { onMount } from 'svelte';
  import { clock } from '../state/clock.svelte.ts';
  import { hideClockZoom } from '../state/hidden-gestures.svelte.ts';

  let seconds = $state(new Date().getSeconds());

  onMount(() => {
    const id = setInterval(() => { seconds = new Date().getSeconds(); }, 250);
    return () => clearInterval(id);
  });

  const secondsLabel = $derived(String(seconds).padStart(2, '0'));
</script>

<svelte:window onpointerup={hideClockZoom} onpointercancel={hideClockZoom} />

<div class="clock-zoom" role="status" aria-live="off">
  <div class="clock-zoom-time num">
    {clock.time}<span class="clock-zoom-seconds">:{secondsLabel}</span>
  </div>
  <div class="clock-zoom-date">{clock.date}</div>
</div>

<style>
  .clock-zoom {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3, 12px);
    background: var(--color-surface-0, #000);
    color: var(--color-text-primary, #fff);
    pointer-events: none;
    animation: clock-zoom-in var(--duration-enter, 200ms) var(--ease-out, ease-out) both;
  }

  .clock-zoom-time {
    font-size: clamp(4rem, 22vw, 16rem);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .clock-zoom-seconds {
    font-size: 0.45em;
    opacity: 0.6;
  }

  .clock-zoom-date {
    font-size: clamp(1rem, 4vw, 2.5rem);
    opacity: 0.75;
  }

  @keyframes clock-zoom-in {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .clock-zoom { animation: none; }
  }
</style>
