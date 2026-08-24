<script lang="ts">
  /* ── Lern-Overlay über der Raumansicht ──
     Es liegt über allem, fängt aber nichts ab: `pointer-events: none` und ein
     Capture-Listener am Fenster reichen. Ein echtes Bedienelement blendet es
     weich aus, ein Tipp auf den Hintergrund wieder ein — beliebig oft und ohne
     dauerhaften Onboarding-Status. */
  import { onMount } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import { nextCoachVisibility } from './hotel-coach.ts';

  let visible = $state(true);

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      visible = nextCoachVisibility(event.target);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  });
</script>

<div class="hotel-coach" class:is-visible={visible} data-testid="hotel-coach" aria-hidden="true">
  <div class="hotel-coach__hint">
    <!-- Dekorativ: der tippende Finger zeigt, was gemeint ist. -->
    <svg class="hotel-coach__finger" viewBox="0 0 48 64" aria-hidden="true">
      <circle class="hotel-coach__pulse" cx="24" cy="18" r="12" />
      <path d="M24 6v22M24 28c-6 0-10 4-10 10v14h20V38c0-6-4-10-10-10z"
            fill="none" stroke="currentColor" stroke-width="3"
            stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <p>{m.hotel_coach_hint()}</p>
  </div>
</div>

<style>
  .hotel-coach {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: max(var(--space-8), env(safe-area-inset-bottom));
    /* Blockiert bewusst nichts: jeder Tipp geht an das Control darunter. */
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-enter) var(--ease-out);
  }

  .hotel-coach.is-visible {
    opacity: 1;
  }

  .hotel-coach__hint {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-2xl);
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-1) 88%, transparent);
    color: var(--color-text-primary);
    font-family: var(--font-family);
  }

  .hotel-coach__hint p {
    margin: 0;
    font-size: var(--text-sm);
  }

  .hotel-coach__finger {
    width: 32px;
    height: 42px;
    color: var(--color-accent-warm);
    flex: none;
  }

  .hotel-coach__pulse {
    fill: currentColor;
    opacity: 0.25;
    transform-origin: 24px 18px;
    animation: hotel-coach-tap 1.8s var(--ease-in-out) infinite;
  }

  @keyframes hotel-coach-tap {
    0%, 60%, 100% { transform: scale(0.7); opacity: 0.15; }
    30% { transform: scale(1); opacity: 0.4; }
  }

  @media (prefers-reduced-motion: reduce) {
    .hotel-coach { transition: none; }
    .hotel-coach__pulse { animation: none; opacity: 0.25; }
  }
</style>
