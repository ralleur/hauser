<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-only
  import { onMount, tick } from 'svelte';
  import { swipedown, SHEET_SWIPE_IGNORE } from '../actions/swipedown.ts';
  import Icon from './Icon.svelte';
  import { m } from '../../paraglide/messages.js';
  import WeatherRadar from './WeatherRadar.svelte';
  import { weatherView, outdoor, refreshWeather } from '../state/weather.svelte.ts';
  import { weatherConditionIcon, type WeatherCondition } from '../state/weather.ts';
  import { ensureAmbientMapStatus } from '../state/ambient-map.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { EXTERIOR_HERO_ID } from '../config/household-config.ts';
  import { energyAssetUrl, exteriorAssetUrl, energyOvercastUrl } from './energy-hero-assets.ts';
  import { appState } from '../state/app.svelte.ts';
  import { intlLocale } from '../state/locale.svelte.ts';
  import { bodyPortal } from '../actions/body-portal.ts';

  let dialog: HTMLDialogElement;
  let hoursShown = $state(12);
  let closing = $state(false);
  let now = $state(Date.now());
  let bottomInset = $state(0);
  const details = $derived(weatherView.details);
  const hours = $derived((details?.hours ?? []).filter(h => h.time + 3600000 > now));
  const hero = $derived(roomHeroConfig(EXTERIOR_HERO_ID));
  const day = $derived(appState.heroSun?.day ?? appState.theme === 'light');
  const normalImage = $derived(hero ? exteriorAssetUrl(hero.assetId, day ? 'day' : 'night')
    : energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun: appState.heroSun ?? undefined, fallbackTheme: appState.theme }));
  const image = $derived(day && outdoor.condition && outdoor.condition !== 'sunny'
    ? energyOvercastUrl(import.meta.env.BASE_URL, hero?.assetId ?? null) : normalImage);
  const wet = $derived(hours.find(h => h.rain !== null && h.rain > 0 && new Date(h.time + (details?.offsetSeconds ?? 0) * 1000).toISOString().slice(0, 10) === new Date(now + (details?.offsetSeconds ?? 0) * 1000).toISOString().slice(0, 10)));
  const walk = $derived(hours.find((h, i) => {
    const next = hours[i + 1];
    const daytime = outdoor.sunrise != null && outdoor.sunset != null && h.time >= outdoor.sunrise && h.time + 7200000 <= outdoor.sunset;
    return daytime && next && next.time - h.time === 3600000 && h.rain === 0 && next.rain === 0
      && h.rainChance !== null && h.rainChance < 30 && next.rainChance !== null && next.rainChance < 30 && h.wind !== null && h.wind < 25;
  }));
  const value = (v: number | null | undefined, unit = '') => v == null ? '—' : `${Math.round(v)}${unit}`;
  const time = (ms: number | null | undefined) => ms == null ? '—' : new Date(ms + (details?.offsetSeconds ?? 0) * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  function condition(c: WeatherCondition | null) {
    return c === 'sunny' ? m.weather_ui_sunny() : c === 'rainy' ? m.weather_ui_rain() : c === 'snowy' ? m.weather_ui_snow() : c === 'cloudy' ? m.weather_ui_cloudy() : m.weather_ui_weather_unavailable();
  }
  const direction = $derived(details?.windDirection == null ? '' : [m.weather_ui_north(), m.weather_ui_northeast(), m.weather_ui_east(), m.weather_ui_southeast(), m.weather_ui_south(), m.weather_ui_southwest(), m.weather_ui_west(), m.weather_ui_northwest()][Math.round(details.windDirection / 45) % 8]);
  async function closeWeather(after?: () => void) {
    if (closing) return;
    closing = true;
    await tick();
    // Keep the dialog and its calling screen alive until the shared exit ends.
    // Zero-duration motion and interrupted animations finish through the same path.
    await Promise.allSettled(dialog.getAnimations({ subtree: true }).map(animation => animation.finished));
    if (!dialog.isConnected) return;
    dialog.close();
    after?.();
  }
  // The visible navigation remains usable outside this transparent dialog.
  // Native dialog backdrops otherwise swallow those taps as modal input.
  function navigateFromBackdrop(event: MouseEvent) {
    if (event.target !== dialog) return;
    const button = [...document.querySelectorAll<HTMLButtonElement>('.tab-bar button')].find(button => {
      const rect = button.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (button && !button.disabled) void closeWeather(() => button.click());
  }
  onMount(() => {
    const measure = () => {
      const nav = document.querySelector('.tab-bar');
      bottomInset = !document.querySelector('.ambient.is-on') && nav ? Math.max(0, innerHeight - nav.getBoundingClientRect().top) : 0;
    };
    measure(); window.addEventListener('resize', measure);
    dialog.showModal(); ensureAmbientMapStatus({ immediate: true });
    const timer = setInterval(() => { now = Date.now(); }, 60000);
    return () => { clearInterval(timer); window.removeEventListener('resize', measure); };
  });
</script>

<dialog bind:this={dialog} use:bodyPortal use:swipedown={{ onSwipe: () => { void closeWeather(); }, enabled: !closing, threshold: 96, atTop: () => dialog.scrollTop <= 0, ignore: SHEET_SWIPE_IGNORE + ", button, a" }} style:--weather-bottom-inset={`${bottomInset}px`} class="weather-view" class:is-closing={closing} oncancel={event => { event.preventDefault(); void closeWeather(); }} onclick={navigateFromBackdrop} aria-label={m.weather_ui_weather()} onclose={() => { weatherView.open = false; }}>
  {#if weatherView.failed && !details}<p role="status" class="weather-status">{m.weather_ui_weather_is_currently_unavailable_please_try_again()}</p>{/if}
  {#if weatherView.loading && !details}<p role="status">{m.weather_ui_loading_weather()}</p>{/if}
  <div class="weather-grab" aria-hidden="true"></div>
  <div class="weather-grid">
    <div class="weather-left">
      <section class="weather-card weather-current">
        <img src={image} alt="" style:object-position={hero ? `${hero.focus.panel.x}% ${hero.focus.panel.y}%` : 'center'} onerror={e => { const img = e.currentTarget as HTMLImageElement; if (img.src !== new URL(normalImage, location.href).href) img.src = normalImage; }} />
        <div class="current-copy"><h2><Icon name="i-map-marker" /> {m.weather_ui_home()}</h2>
          <div class="weather-temperature"><span>{value(outdoor.temp, '°')}</span><Icon name={weatherConditionIcon(outdoor.condition)} /></div>
          <h2>{condition(outdoor.condition)}</h2><p>{m.weather_ui_feels_like()} {value(details?.feelsLike, '°')}</p>
        </div>
        <div class="weather-metrics">
          {#each [
            ['i-droplet', m.weather_ui_rain_chance(), value(hours[0]?.rainChance, ' %')],
            ['i-weather-windy', m.weather_ui_wind(), `${value(outdoor.windSpeed, ' km/h')} ${direction}`],
            ['i-droplet', m.weather_ui_humidity(), value(details?.humidity, ' %')],
            ['i-weather-sunny', m.weather_ui_uv_maximum(), value(details?.uv)],
            ['i-weather-sunset-up', m.weather_ui_sunrise(), time(outdoor.sunrise)],
            ['i-weather-sunset-down', m.weather_ui_sunset(), time(outdoor.sunset)]
          ] as metric}
            <div class="weather-metric"><Icon name={metric[0]} /><div><small>{metric[1]}</small><strong>{metric[2]}</strong></div></div>
          {/each}
        </div>
      </section>
      <section class="weather-card weather-today"><h2>{m.weather_ui_for_today()}</h2>
        {#if wet}<div class="weather-tip"><Icon name="i-weather-rainy" /><div><strong>{m.weather_ui_precipitation_from()} {time(wet.time)}</strong><p>{wet.rain?.toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) ?? '—'} mm · {value(wet.rainChance, ' %')}</p></div></div>{/if}
        {#if walk}<div class="weather-tip"><Icon name="i-weather-sunny" /><div><strong>{m.weather_ui_dry_hours_outdoors()}</strong><p>{time(walk.time)} – {time(walk.time + 7200000)}</p></div></div>{/if}
        {#if details?.uv != null && details.uv >= 3}<div class="weather-tip"><Icon name="i-weather-sunny" /><div><strong>{m.weather_ui_remember_sun_protection()}</strong><p>{m.weather_ui_uv_index_today_up_to()} {value(details.uv)}</p></div></div>{/if}
        {#if !wet && !walk}<p>{hours.length ? m.weather_ui_check_the_hourly_forecast_for_the_rest_of_the_day() : m.weather_ui_insights_appear_when_the_forecast_is_available()}</p>{/if}
      </section>
    </div>
    <div class="weather-right">
      <section class="weather-card weather-hourly"><div class="weather-section-heading"><h2>{m.weather_ui_hourly_forecast()}</h2>
        <div class="weather-actions">
        <div class="weather-range" role="group" aria-label={m.weather_ui_forecast_range()}>
          {#each [12, 24] as count}<button class="pressable" class:is-selected={hoursShown === count} aria-pressed={hoursShown === count} onclick={() => { hoursShown = count; }}>{count} h</button>{/each}
        </div>
          <button class="pressable" disabled={weatherView.loading} onclick={() => refreshWeather()} aria-label={m.weather_ui_refresh_weather()}><Icon name="i-refresh" /></button>
        </div></div>
        <div class="weather-hours">{#each hours.slice(0, hoursShown) as hour}<div class="weather-hour"><span>{time(hour.time)}</span><Icon name={weatherConditionIcon(hour.condition)} /><strong>{value(hour.temp, '°')}</strong><small class="rain-chance">{value(hour.rainChance, ' %')}</small></div>{:else}<p>{m.weather_ui_no_hourly_forecast_available()}</p>{/each}</div>
      </section>
      <div class="weather-bottom">
        <section class="weather-card weather-week"><h2>{m.weather_ui_weekly_forecast()}</h2>
          {#each details?.days ?? [] as day, i}<div class="weather-day"><span>{i === 0 ? m.weather_ui_today() : new Date(`${day.date}T12:00:00`).toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}</span><Icon name={weatherConditionIcon(day.condition)} /><small class="rain-chance">{value(day.rainChance, '%')}</small><strong>{value(day.high, '°')}</strong><span>{value(day.low, '°')}</span></div>{:else}<p>{m.weather_ui_no_daily_forecast_available()}</p>{/each}
        </section>
        <section class="weather-card weather-map"><WeatherRadar /></section>
      </div>
    </div>
  </div>

</dialog>

<style>
  .weather-view { position: relative; isolation: isolate; --color-text-primary: var(--glass-text); --color-text-secondary: var(--glass-text-secondary); --color-border: var(--glass-border); --color-surface-0: color-mix(in srgb, rgb(from var(--glass-fill) r g b / 1) 96%, var(--color-accent-warm)); --glass-face: var(--glass-fill); --glass-blur: blur(var(--glass-blur-radius)) saturate(var(--glass-saturation)); box-sizing: border-box; width: calc(100% - var(--space-6)); max-width: calc(var(--space-8) * 24); max-height: calc(100dvh - var(--space-6) - var(--weather-bottom-inset)); margin: auto auto calc(var(--space-3) + var(--weather-bottom-inset)); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); color: var(--color-text-primary); background: transparent; overflow: auto; border-color: transparent; }
  /* Animate the glass itself: opacity on its parent would isolate its backdrop. */
  .weather-view[open] .weather-card, .weather-view[open] .weather-grab { animation: modal-enter var(--duration-enter) var(--ease-spring) both; }
  .weather-view[open].is-closing { translate: 0 var(--sheet-release-y, 0px); pointer-events: none; }
  .weather-view[open].is-closing .weather-card, .weather-view[open].is-closing .weather-grab { animation: modal-exit var(--duration-fast) var(--ease-in) both; }
  .weather-grab { width: var(--space-8); height: var(--space-1); margin: calc(-1 * var(--space-2)) auto var(--space-2); border-radius: var(--radius-full); background: var(--glass-text-secondary); opacity: .6; flex-shrink: 0; }
  .weather-range { display: flex; border: 1px solid var(--glass-border); border-radius: var(--radius-full); background: var(--glass-face); }
  .weather-range button { border: 0; background: transparent; white-space: nowrap; font-size: var(--text-sm); }
  .weather-range .is-selected { color: var(--color-accent-warm); background: color-mix(in srgb, var(--color-accent-warm) 15%, transparent); }
  .weather-view::backdrop { background: transparent; }
  .weather-actions, .weather-section-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  h2,p { margin: 0; } h2 { font-size: var(--text-md); font-weight: var(--font-weight-medium); display: flex; gap: var(--space-2); align-items: center; }
  p, small { color: var(--color-text-secondary); } p { margin-top: var(--space-2); } small { font-size: var(--text-xs); }
  button { color: inherit; border: 1px solid var(--color-border); background: var(--glass-face, var(--color-surface-2)); border-radius: var(--radius-full); min-height: var(--touch-min); padding: var(--space-2) var(--space-3); font: inherit; } button { min-width: var(--touch-min); display: grid; place-items: center; cursor: pointer; }
  .weather-grid { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.9fr); gap: var(--space-4); }
  .weather-left,.weather-right { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
  .weather-card { color: var(--glass-text); --color-text-secondary: var(--glass-text-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); padding: var(--space-4); background: var(--glass-face, var(--color-surface-2)); backdrop-filter: var(--glass-blur); min-width: 0; }
  .weather-current { position: relative; overflow: hidden; isolation: isolate; color: var(--glass-text); }
  .weather-current > img { position: absolute; inset: 0; height: 100%; width: 100%; object-fit: cover; z-index: -2; }
  .weather-current::before { content: ''; position: absolute; inset: 0; background: linear-gradient(to bottom, var(--glass-fill), var(--glass-scrim)); z-index: -1; }
  .weather-current::after { content: ''; position: absolute; inset: 0; border: 1px solid var(--glass-border); border-radius: inherit; pointer-events: none; }
  .weather-current p, .weather-current small { color: inherit; }
  .current-copy { padding: var(--space-2) var(--space-1) var(--space-4); }
  .weather-temperature { display: flex; align-items: center; gap: var(--space-4); margin-top: var(--space-4); }
  .weather-temperature > span { font-size: clamp(var(--text-4xl), 8vw, var(--text-display)); line-height: 1; font-weight: var(--font-weight-normal); }
  .weather-temperature :global(svg), .weather-temperature :global(.icon) { width: var(--space-8); height: var(--space-8); }
  .weather-metrics { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-2); }
  .weather-metric { display: flex; gap: var(--space-2); align-items: center; padding: var(--space-3) var(--space-2); border-radius: var(--radius-lg); background: var(--glass-face); backdrop-filter: var(--glass-blur); }
  .weather-metric > div { min-width: 0; } .weather-metric strong, .weather-metric small { display: block; overflow-wrap: anywhere; hyphens: auto; } .weather-metric small { font-size: var(--text-2xs); } .weather-metric strong { font-size: var(--text-sm); font-weight: var(--font-weight-medium); margin-top: var(--space-1); }
  .weather-today { flex: 1; } .weather-tip { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-3); margin-top: var(--space-3); background: var(--glass-face); border-radius: var(--radius-lg); } .weather-tip strong { font-size: var(--text-sm); } .weather-tip p { font-size: var(--text-sm); }
  .weather-hours { display: flex; overflow-x: auto; gap: var(--space-2); padding-top: var(--space-4); }
  .weather-hour { flex: 0 0 calc(var(--space-8) + var(--space-2)); display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-1); } .weather-hour :global(.icon) { width: var(--space-6); height: var(--space-6); } .rain-chance { color: color-mix(in srgb, var(--color-accent-cool) 65%, var(--glass-text)); }
  .weather-bottom { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.4fr); gap: var(--space-4); flex: 1; }
  .weather-day { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-2); margin-top: var(--space-2); border-radius: var(--radius-lg); background: var(--glass-face); font-size: var(--text-sm); } .weather-day > span:first-child { flex: 1; } .weather-day strong { color: var(--color-accent-warm); }
  .weather-map { display: flex; flex-direction: column; gap: var(--space-3); }
  .weather-status { margin-bottom: var(--space-4); }
  @media (min-width: 1001px) and (min-height: 600px) {
    .weather-view[open] { display: flex; flex-direction: column; width: calc(100% - var(--space-6)); max-width: none; height: calc(100dvh - var(--space-6) - var(--weather-bottom-inset)); }
    .weather-grid { flex: 1; min-height: 0; grid-template-columns: minmax(0,1.05fr) minmax(0,1.9fr); }
    .weather-left, .weather-right, .weather-bottom { min-height: 0; }
    .weather-temperature { margin-top: var(--space-2); }
    .weather-temperature > span { font-size: var(--text-4xl); }
    .weather-hours { padding-top: var(--space-2); }
    .weather-current { flex: 1.7; display: flex; flex-direction: column; }
    .current-copy { flex: 1; padding-top: var(--space-1); padding-bottom: var(--space-2); }
    .weather-metric { padding: var(--space-2); gap: var(--space-1); }
    .weather-metric :global(.icon) { width: var(--space-4); height: var(--space-4); flex-shrink: 0; }
    .weather-metric small { font-size: var(--text-3xs); letter-spacing: var(--tracking-tightest); hyphens: none; overflow-wrap: normal; }
    .weather-current h2 { font-size: var(--text-md); }
    .weather-today { flex: 1; }
    .weather-tip { padding: var(--space-2); margin-top: var(--space-2); }
    .weather-week { display: flex; flex-direction: column; gap: var(--space-1); }
    .weather-week h2 { margin-bottom: var(--space-2); }
    .weather-week .weather-day { flex: 1; min-height: 0; margin-top: 0; }
    .weather-day { padding: var(--space-1) var(--space-2); margin-top: var(--space-1); gap: var(--space-2); font-size: var(--text-xs); }
    .weather-day .rain-chance { font-size: var(--text-2xs); }
    .weather-hour { padding: var(--space-2) var(--space-1); gap: var(--space-2); }
    .weather-hour > span { font-size: var(--text-sm); }
  }
  @media (max-width: 1000px) { .weather-grid { grid-template-columns: minmax(0,1fr); } .weather-left { display: grid; grid-template-columns: minmax(0,1.3fr) minmax(0,1fr); } }
  @media (max-width: 600px) { .weather-view { width: 100%; max-height: 100dvh; height: 100dvh; border-radius: var(--radius-none); padding: var(--space-4); } .weather-left,.weather-bottom { display: flex; flex-direction: column; } .weather-section-heading { align-items: flex-start; flex-direction: column; } .weather-metric { flex-direction: column; align-items: flex-start; } }
</style>
