<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-only
  import { type Component } from 'svelte';
  import Icon from './Icon.svelte';
  import { openWeather, outdoor, weatherView } from '../state/weather.svelte.ts';
  import { weatherConditionIcon } from '../state/weather.ts';
  import { m } from '../../paraglide/messages.js';
  import { fmtTemp } from '../format.ts';
  let View = $state<Component | null>(null);
  $effect(() => {
    if (weatherView.open && !View) void import('./WeatherView.svelte').then(module => { View = module.default; });
  });
</script>
<button class="standby-btn pressable weather-button" type="button" aria-label={m.weather_ui_open_weather()} title={m.weather_ui_weather()} onclick={openWeather}>
  <Icon name={weatherConditionIcon(outdoor.condition)} cls="icon icon-md" />
  {#if outdoor.temp !== null}<span class="num">{fmtTemp(outdoor.temp)}°</span>{/if}
</button>
{#if weatherView.open && View}<View />{/if}
<style>.weather-button { min-width: var(--touch-min); min-height: var(--touch-min); color: var(--color-text-secondary); font-family: inherit; font-size: var(--text-sm); background: transparent; border: none; display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); border-radius: var(--radius-full); cursor: pointer; white-space: nowrap; }</style>
