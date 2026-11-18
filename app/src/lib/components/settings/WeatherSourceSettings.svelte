<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { deviceManager } from '../../state/device-manager.svelte.ts';
  import { loadWeatherSource, saveWeatherSource, WEATHER_SOURCE_FIELDS } from '../../state/weather-source.ts';
  import { refreshWeather } from '../../state/weather.svelte.ts';
  let draft = $state(loadWeatherSource());
  let busy = $state(false), saved = $state(false), error = $state('');
  const labels = { entityId: () => m.weather_source_entity(), temperature: () => m.weather_source_temperature(),
    rain: () => m.weather_source_rain(), wind: () => m.weather_source_wind(), humidity: () => m.weather_source_humidity() };
  async function save(event: SubmitEvent) {
    event.preventDefault(); busy = true; error = ''; saved = false;
    try { await saveWeatherSource(draft); await refreshWeather(); saved = true; }
    catch { error = m.weather_source_error(); }
    finally { busy = false; }
  }
</script>

<details class="weather-source-settings">
  <summary>{m.weather_source_title()}</summary>
  <form onsubmit={save}>
    <p class="settings-row-sub">{m.weather_source_hint()}</p>
    {#each WEATHER_SOURCE_FIELDS as key}
      <label>{labels[key]()}<input type="text" list={`weather-source-${key}`} placeholder={key === 'entityId' ? 'weather.home' : key === 'rain' ? 'binary_sensor.rain' : `sensor.${key}`} bind:value={draft[key]} disabled={busy} spellcheck="false" autocapitalize="none" oninput={() => saved = false} /></label>
      <datalist id={`weather-source-${key}`}>{#each deviceManager.catalog.filter(item => key === 'entityId' ? item.entityId.startsWith('weather.') : key === 'rain' ? /^(sensor|binary_sensor)\./.test(item.entityId) : item.entityId.startsWith('sensor.')) as item}<option value={item.entityId}>{item.name}</option>{/each}</datalist>
    {/each}
    <button class="primary-btn" disabled={busy} type="submit">{busy ? m.rem_edit_saving() : m.rem_edit_save()}</button>
    {#if saved}<p role="status">{m.weather_source_saved()}</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  </form>
</details>

<style>
  .weather-source-settings { padding: var(--space-4); }
  form, label { display: grid; gap: var(--space-2); }
  form { gap: var(--space-4); padding-top: var(--space-4); }
  input { min-height: var(--touch-min); width: 100%; }
</style>
