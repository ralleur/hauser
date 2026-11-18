<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount } from 'svelte';
  import HeroWeatherLayer from '../HeroWeatherLayer.svelte';
  import { heroWeatherLayer, resolvedWeatherCondition } from '../../state/hero-weather.ts';
  import { loadRoomRegionsOnce, regionClipPaths, roomRegions } from '../../state/room-regions.svelte.ts';
  import { weatherWholeImage } from '../../state/room-display-config.svelte.ts';
  import { settingsValues } from '../../state/settings.svelte.ts';
  import { simulation } from '../../state/simulation.svelte.ts';
  import { outdoor, refreshWeather, weatherRefresh } from '../../state/weather.svelte.ts';
  import { prefersReducedMotion } from '../../motion/index.ts';

  let { roomId, position = '50% 50%' }: { roomId: string; position?: string } = $props();
  const focus = $derived(position.split(' ').map(value => parseFloat(value) / 100));
  const clips = $derived(weatherWholeImage(roomId)
    ? ['polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)']
    : regionClipPaths(roomRegions(roomId, 'window')));
  const layer = $derived(settingsValues.ambientWeather
    ? heroWeatherLayer(resolvedWeatherCondition(simulation.weather, location.search, outdoor.condition), outdoor.windSpeed, prefersReducedMotion())
    : null);
  onMount(() => { void loadRoomRegionsOnce(); void refreshWeather(); });
  $effect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshWeather(); }, weatherRefresh.intervalMs);
    return () => clearInterval(timer);
  });
</script>

{#if layer && !layer.still && clips.length}
  <div class="room-hero-targets is-phone" aria-hidden="true" style:--hero-weather-z="0">
    <div class="hero-image-space" style:--hero-focus-x={focus[0]} style:--hero-focus-y={focus[1]}>
      {#each clips as clip}<HeroWeatherLayer {layer} {clip} />{/each}
    </div>
  </div>
{/if}
