<script lang="ts">
  /* ── Welcome Screen während eines Aufenthalts ──
     Er liegt über der bereits gestarteten Raumansicht: ein Tipp blendet ihn aus
     und die vertraute Hauser-Oberfläche steht sofort da. Eine individuelle
     Nachricht erscheint nur, wenn der Kalendereintrag eine hat — es gibt keine
     erfundene Vorlagenbegrüßung. */
  import { HOTEL_WELCOME_CALL_TO_ACTION, type HotelWelcomeView } from './hotel-welcome.ts';

  let { view, onEnter }: { view: HotelWelcomeView; onEnter: () => void } = $props();
</script>

<div class="hotel-welcome" data-testid="hotel-welcome">
  <button class="hotel-welcome__enter" type="button" onclick={onEnter}
          aria-label={HOTEL_WELCOME_CALL_TO_ACTION}>
    {#if view.message}
      <p class="hotel-welcome__message" data-testid="hotel-welcome-message">{view.message}</p>
    {/if}

    <!-- Dekorativ: freundlicher Smiley und ein Finger, der aufs Glas tippt. -->
    <svg class="hotel-welcome__art" viewBox="0 0 160 160" aria-hidden="true">
      <circle class="hotel-welcome__face" cx="80" cy="66" r="42" />
      <circle class="hotel-welcome__eye" cx="66" cy="58" r="5" />
      <circle class="hotel-welcome__eye" cx="94" cy="58" r="5" />
      <path class="hotel-welcome__smile" d="M62 78c5 8 13 12 18 12s13-4 18-12"
            fill="none" stroke-width="5" stroke-linecap="round" />
      <g class="hotel-welcome__finger">
        <circle class="hotel-welcome__tap" cx="80" cy="112" r="14" />
        <path d="M80 100v14M80 114c-7 0-11 5-11 11v22h22v-22c0-6-4-11-11-11z"
              fill="none" stroke="currentColor" stroke-width="4"
              stroke-linecap="round" stroke-linejoin="round" />
      </g>
    </svg>

    <span class="hotel-welcome__cta">{HOTEL_WELCOME_CALL_TO_ACTION}</span>
  </button>
</div>

<style>
  .hotel-welcome {
    position: fixed;
    inset: 0;
    z-index: 35;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface-0);
    font-family: var(--font-family);
  }

  .hotel-welcome__enter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    width: 100%;
    height: 100%;
    padding: var(--space-7);
    border: none;
    background: none;
    color: var(--color-text-primary);
    justify-content: center;
  }

  .hotel-welcome__message {
    margin: 0;
    max-width: 40ch;
    text-align: center;
    font-size: var(--text-lg);
    line-height: var(--leading-snug);
    color: var(--color-text-primary);
  }

  .hotel-welcome__art {
    width: 200px;
    height: 200px;
    color: var(--color-accent-warm);
  }

  .hotel-welcome__face {
    fill: none;
    stroke: var(--color-accent-warm);
    stroke-width: 5;
  }

  .hotel-welcome__eye { fill: var(--color-accent-warm); }
  .hotel-welcome__smile { stroke: var(--color-accent-warm); }

  .hotel-welcome__tap {
    fill: var(--color-accent-warm);
    opacity: 0.25;
    transform-origin: 80px 112px;
    animation: hotel-welcome-tap 2s var(--ease-in-out) infinite;
  }

  .hotel-welcome__cta {
    font-size: var(--text-xl);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--tracking-tight);
  }

  @keyframes hotel-welcome-tap {
    0%, 65%, 100% { transform: scale(0.65); opacity: 0.15; }
    35% { transform: scale(1); opacity: 0.45; }
  }

  @media (prefers-reduced-motion: reduce) {
    .hotel-welcome__tap { animation: none; opacity: 0.25; }
  }
</style>
