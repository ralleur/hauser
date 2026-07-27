<script lang="ts">
  import { hud } from '../state/hud.svelte.ts';
  import { phase4Metrics } from '../state/phase4-metrics.svelte.ts';
  import { formatPressLatency, formatPressSummary, summarizePressLatencies } from '../state/phase4-metrics.ts';

  let text = $state('');
  const pressText = $derived(formatPressLatency(phase4Metrics.latestPress));
  const pressSummary = $derived(formatPressSummary(summarizePressLatencies(phase4Metrics.pressSamples)));

  /* fps-Loop nur solange das HUD aktiv ist */
  $effect(() => {
    if (!hud.active) return;
    let running = true;
    let frames = 0;
    let last = performance.now();
    const loop = (t: number) => {
      if (!running) return;
      frames += 1;
      if (t - last >= 500) {
        const fps = Math.round((frames * 1000) / (t - last));
        frames = 0;
        last = t;
        text = `${window.innerWidth}×${window.innerHeight} @ dpr ${window.devicePixelRatio} · ${fps} fps`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; };
  });
</script>

<div class="hud num" hidden={!hud.active}>
  <div>{text}</div>
  <div>{pressText} · {pressSummary}</div>
</div>
