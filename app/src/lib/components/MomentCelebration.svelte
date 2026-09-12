<script lang="ts">
  /* Kalendermoment auf dem Panel: eine Zeile über den Raumkacheln, dahinter
     einmal am Morgen leises Konfetti. Dieser Baustein wird erst geladen, wenn
     es tatsächlich etwas zu feiern gibt — der Startpfad bleibt unberührt.
     `prefers-reduced-motion` lässt nur die Zeile stehen. */
  import { onMount } from 'svelte';
  import { prefersReducedMotion, tokenDuration } from '../motion/index.ts';
  import { momentLine } from '../state/moment-copy.ts';
  import { celebrationDue, currentMoment, dismissMoment, markCelebrated } from '../state/moments.svelte.ts';

  const moment = $derived(currentMoment());
  const line = $derived(momentLine(moment));

  let canvas = $state<HTMLCanvasElement | null>(null);
  let visible = $state(false);
  let confetti = $state(false);

  const COUNT = 70;
  const FALL_MS = 4200;
  const COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f4f1de'];

  function run(node: HTMLCanvasElement): () => void {
    const context2d = node.getContext('2d');
    if (!context2d) return () => {};
    const context: CanvasRenderingContext2D = context2d;
    const width = node.width = node.clientWidth;
    const height = node.height = node.clientHeight;
    const pieces = Array.from({ length: COUNT }, () => ({
      x: Math.random() * width,
      y: -Math.random() * height * 0.6,
      size: 4 + Math.random() * 5,
      speed: height / (FALL_MS * (0.6 + Math.random() * 0.6)),
      drift: (Math.random() - 0.5) * 0.03,
      spin: (Math.random() - 0.5) * 0.006,
      angle: Math.random() * Math.PI,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let frame = 0;
    let previous = performance.now();
    const started = previous;

    function draw(time: number) {
      const delta = time - previous;
      previous = time;
      const elapsed = time - started;
      context.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.y += piece.speed * delta;
        piece.x += piece.drift * delta;
        piece.angle += piece.spin * delta;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);
        context.globalAlpha = Math.max(0, 1 - elapsed / FALL_MS);
        context.fillStyle = piece.color;
        context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.6);
        context.restore();
      }
      if (elapsed < FALL_MS) frame = requestAnimationFrame(draw);
      else {
        context.clearRect(0, 0, width, height);
        confetti = false;
      }
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }

  onMount(() => {
    const active = currentMoment();
    if (!active) return;
    visible = true;
    if (!prefersReducedMotion() && celebrationDue()) {
      confetti = true;
      markCelebrated(active.id);
    }
  });

  $effect(() => {
    if (!confetti || !canvas) return;
    return run(canvas);
  });

  function dismiss() {
    const active = currentMoment();
    if (active) dismissMoment(active.id);
    visible = false;
    confetti = false;
  }

  const fadeMs = $derived(tokenDuration(canvas, 'enter'));
</script>

{#if visible && line}
  <div class="moment-layer" style={`--moment-fade:${fadeMs}ms`}>
    {#if confetti}
      <canvas class="moment-confetti" aria-hidden="true" bind:this={canvas}></canvas>
    {/if}
    <button class="moment-line" type="button" onclick={dismiss} aria-live="polite">{line}</button>
  </div>
{/if}

<style>
  /* Liegt über den Kacheln, nimmt aber nur die Zeile als Ziel — die Bedienung
     darunter bleibt erreichbar. */
  .moment-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 6;
  }

  .moment-confetti {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .moment-line {
    position: absolute;
    /* Unter der schwebenden Kopfzeile des Panels (--bar-top), sonst am Rand. */
    top: calc(var(--bar-top, 0px) + var(--space-3, 12px));
    left: 50%;
    transform: translateX(-50%);
    pointer-events: auto;
    max-width: min(80%, 40rem);
    padding: var(--space-2, 8px) var(--space-4, 16px);
    border: none;
    border-radius: var(--radius-pill, 999px);
    background: var(--surface-raised, rgba(0, 0, 0, 0.35));
    color: var(--text-primary, #fff);
    font: inherit;
    font-size: var(--font-size-body, 1rem);
    text-align: center;
    animation: moment-appear var(--moment-fade) var(--ease-out, ease-out) both;
  }

  @keyframes moment-appear {
    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .moment-line { animation: none; }
  }
</style>
