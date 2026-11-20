<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import type { Component } from 'svelte';
  import { heroWeatherLayer, resolvedWeatherCondition, type HeroWeatherLayer } from '../state/hero-weather.ts';
  import { loadRoomRegionsOnce, regionClipPaths, roomRegions } from '../state/room-regions.svelte.ts';
  import { weatherWholeImage } from '../state/room-display-config.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { simulation } from '../state/simulation.svelte.ts';
  import { outdoor, refreshWeather } from '../state/weather.svelte.ts';
  import { prefersReducedMotion } from '../motion/index.ts';

  // The decoded image owns its weather, including the room and crop. Keeping
  // both in one opacity layer prevents weather jumping ahead of an image load.
  const { roomId, position = '50% 50%' }: { roomId: string | null; position?: string } = $props();
  const focus = $derived(position.split(' ').map(value => Number.parseFloat(value) / 100));
  const clips = $derived(weatherWholeImage(roomId ?? '')
    ? ['polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)']
    : regionClipPaths(roomRegions(roomId, 'window')));
  const layer = $derived.by(() => {
    if (!roomId || !settingsValues.ambientWeather || !clips.length) return null;
    const condition = resolvedWeatherCondition(simulation.weather, typeof location === 'undefined' ? '' : location.search, outdoor.condition);
    const resolved = heroWeatherLayer(condition, outdoor.windSpeed, prefersReducedMotion());
    return resolved && !resolved.still ? resolved : null;
  });
  let Weather = $state<Component<{ layer: HeroWeatherLayer; clip?: string | null }> | null>(null);
  $effect(() => { void loadRoomRegionsOnce(); void refreshWeather(); });
  $effect(() => {
    if (!layer || Weather) return;
    void import('./HeroWeatherLayer.svelte').then(module => { Weather = module.default; });
  });
</script>

{#if Weather && layer}
  <span class="room-window-weather" data-weather-room={roomId} aria-hidden="true">
    <span class="room-window-weather-image"
          style:--weather-focus-x={Number.isFinite(focus[0]) ? focus[0] : 0.5}
          style:--weather-focus-y={Number.isFinite(focus[1]) ? focus[1] : 0.5}>
      {#each clips as clip}
        <Weather {layer} {clip} />
      {/each}
    </span>
  </span>
{/if}

<style>
  .room-window-weather {
    position: absolute;
    inset: 0;
    overflow: hidden;
    container-type: size;
    pointer-events: none;
    --hero-weather-z: 1;
  }
  .room-window-weather-image {
    position: absolute;
    width: max(100cqw, calc(100cqh * 106 / 75));
    height: max(100cqh, calc(100cqw * 75 / 106));
    translate: calc((100cqw - 100%) * var(--weather-focus-x)) calc((100cqh - 100%) * var(--weather-focus-y));
  }
</style>
