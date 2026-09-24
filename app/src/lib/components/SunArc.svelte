<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Der Sonnenstand über der Energie (wie die iOS-App): der Tagbogen zwischen
     Auf- und Untergang über einer Horizontlinie, die Sonne als goldener Punkt
     mit Hof — der gegangene Weg durchgezogen, der kommende gepunktet, im
     Winter flacher als im Sommer. Unter Wolken bleibt nur ein blasser
     Schimmer; nachts ruht sie, und der Bogen nennt Auf- und Untergang. Ohne
     Sonnenzeiten kein Bogen. */
  import { onMount } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import { appState } from '../state/app.svelte.ts';
  import { intlLocale } from '../state/locale.svelte.ts';
  import { outdoor } from '../state/weather.svelte.ts';
  import { resolvedWeatherCondition } from '../state/hero-weather.ts';
  import { simulation } from '../state/simulation.svelte.ts';

  let { width, height }: { width: number; height: number } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 60_000);
    return () => clearInterval(timer);
  });

  const rise = $derived(outdoor.sunrise ?? null);
  const set = $derived(outdoor.sunset ?? null);
  const known = $derived(rise !== null && set !== null && set > rise);
  const progress = $derived(known ? (now - rise!) / (set! - rise!) : 0);
  const up = $derived(known && (appState.heroSun?.day ?? true) && progress > 0 && progress < 1);
  const clouded = $derived.by(() => {
    const condition = resolvedWeatherCondition(simulation.weather, typeof location === 'undefined' ? '' : location.search, outdoor.condition);
    return condition !== null && condition !== 'sunny';
  });

  /* Im Winter flacher: die Tageslänge steht für die Mittagshöhe der Sonne
     (8 h ≈ flach, gut 16 h ≈ voll). */
  const lift = $derived(known ? Math.min(1, Math.max(0.45, 0.45 + ((set! - rise!) / 3_600_000 - 8) / 8.3 * 0.55)) : 0.6);
  const bleed = $derived(height / 3);
  const horizon = $derived(height - 16);
  const inset = 6;
  const arcHeight = $derived((horizon - 10) * lift);
  function point(f: number): [number, number] {
    return [inset + (width - 2 * inset) * f, horizon - arcHeight * Math.sin(Math.PI * f)];
  }
  function path(from: number, to: number): string {
    const steps = 40;
    return Array.from({ length: steps + 1 }, (_, step) => {
      const [x, y] = point(from + (to - from) * (step / steps));
      return `${step === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }
  const walked = $derived(up ? progress : 0);
  const sun = $derived(point(walked));
  const radius = $derived(height / 10);

  const time = (ms: number) => new Date(ms).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  const label = $derived(known ? `${m.sun_rise()} ${time(rise!)}, ${m.sun_set()} ${time(set!)}` : '');
  const gradientId = `sun-glow-${Math.random().toString(36).slice(2, 8)}`;
</script>

{#if known}
  <div class="sun-arc" style={`width:${width}px;height:${height}px`} role="img" aria-label={label}>
    <svg viewBox={`${-bleed} ${-bleed} ${width + 2 * bleed} ${height + 2 * bleed}`}
         style={`left:${-bleed}px;top:${-bleed}px;width:${width + 2 * bleed}px;height:${height + 2 * bleed}px`} aria-hidden="true">
      <defs>
        <radialGradient id={gradientId}>
          <stop offset={clouded ? '0%' : '18%'} style={`stop-color:var(--color-accent-warm);stop-opacity:${clouded ? 0.22 : 0.45}`} />
          <stop offset="100%" style="stop-color:var(--color-accent-warm);stop-opacity:0" />
        </radialGradient>
      </defs>
      <line class="sun-arc-horizon" x1="0" y1={horizon} x2={width} y2={horizon} />
      <path class="sun-arc-ahead" d={path(walked, 1)} />
      {#if up}
        <path class="sun-arc-walked" class:is-clouded={clouded} d={path(0, walked)} />
        <circle cx={sun[0]} cy={sun[1]} r={radius * (clouded ? 2.2 : 3.4)} fill={`url(#${gradientId})`} />
        {#if !clouded}<circle class="sun-arc-disc" cx={sun[0]} cy={sun[1]} r={radius} />{/if}
      {/if}
    </svg>
    <span class="sun-arc-time is-rise num">{time(rise!)}</span>
    <span class="sun-arc-time is-set num">{time(set!)}</span>
  </div>
{/if}

<style>
  .sun-arc { position: relative; flex: none; color: var(--sun-arc-ink, currentColor); pointer-events: none; }
  .sun-arc svg { position: absolute; overflow: visible; }
  .sun-arc-horizon { stroke: currentColor; stroke-opacity: 0.25; stroke-width: 1; }
  .sun-arc-ahead { fill: none; stroke: currentColor; stroke-opacity: 0.35; stroke-width: 1; stroke-linecap: round; stroke-dasharray: 0.5 4; }
  .sun-arc-walked { fill: none; stroke: currentColor; stroke-opacity: 0.5; stroke-width: 1.2; stroke-linecap: round; }
  .sun-arc-walked.is-clouded { stroke-opacity: 0.3; }
  .sun-arc-disc { fill: var(--color-accent-warm); }
  .sun-arc-time { position: absolute; bottom: 0; font-size: 11px; opacity: 0.6; line-height: 1; }
  .sun-arc-time.is-rise { left: 0; }
  .sun-arc-time.is-set { right: 0; }
</style>
