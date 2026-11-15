<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-only
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { m } from '../../paraglide/messages.js';
  import { apiPath } from '../api/client.ts';
  import { intlLocale } from '../state/locale.svelte.ts';
  type Frame = { time: number; url: string };
  type Buffered = { src: string; ready: boolean };
  let frames = $state<Frame[]>([]), index = $state(0), playing = $state(false);
  let loading = $state(true), failed = $state(false), displayed = $state<Frame | null>(null);
  let buffers = $state<Record<string, Buffered>>({});
  let coverage = $state('unknown'), baseMap = $state<string | null>(null), baseLoaded = $state(false);
  const frame = $derived(frames[index]);
  const readyCount = $derived(frames.filter(f => buffers[f.url]?.ready).length);
  const label = (stamp: number) => new Date(stamp * 1000).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  const controller = new AbortController();
  let refreshing = false, warming = false;

  // Download once, keep decoded image elements mounted, switch only when ready.
  async function warmBuffer() {
    if (warming || controller.signal.aborted || coverage === 'unavailable') return;
    warming = true;
    const queue = [frame, ...frames].filter((f): f is Frame => !!f && !buffers[f.url]);
    const unique = [...new Map(queue.map(f => [f.url, f])).values()];
    const worker = async () => {
      while (unique.length && !controller.signal.aborted) {
        const next = unique.shift()!;
        try {
          const response = await fetch(next.url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
          if (!response.ok) throw new Error('unavailable');
          const blob = await response.blob();
          if (!controller.signal.aborted && frames.some(f => f.url === next.url)) buffers[next.url] = { src: URL.createObjectURL(blob), ready: false };
        } catch { if (!controller.signal.aborted) failed = true; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    warming = false;
    const keep = new Set([...frames.map(f => f.url), displayed?.url]);
    for (const url of Object.keys(buffers)) if (!keep.has(url)) { URL.revokeObjectURL(buffers[url].src); delete buffers[url]; }
  }
  async function decoded(event: Event, url: string) {
    const img = event.currentTarget as HTMLImageElement;
    try {
      await img.decode();
      if (!controller.signal.aborted && buffers[url]) { buffers[url].ready = true; failed = false; }
    } catch { discard(url); }
  }
  function discard(url: string) {
    if (buffers[url]) { URL.revokeObjectURL(buffers[url].src); delete buffers[url]; }
    failed = true;
  }
  async function refresh() {
    if (refreshing || controller.signal.aborted) return;
    refreshing = true;
    try {
      const response = await fetch(apiPath('weatherRadar'), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.frames) || !data.frames.length) throw new Error('unavailable');
      if (controller.signal.aborted) return;
      const selected = frame?.time, followLatest = !frames.length || (!playing && index === frames.length - 1);
      if (baseMap && baseMap !== data.baseMap) {
        displayed = null; baseLoaded = false;
        for (const buffer of Object.values(buffers)) URL.revokeObjectURL(buffer.src);
        buffers = {};
      }
      frames = data.frames; coverage = data.coverage; baseMap = data.baseMap;
      index = followLatest ? frames.length - 1 : Math.max(0, frames.findIndex(f => f.time === selected));
      failed = false;
      void warmBuffer();
    } catch { if (!controller.signal.aborted) failed = true; }
    finally { loading = false; refreshing = false; }
  }
  onMount(() => {
    void refresh();
    const refreshTimer = setInterval(() => void refresh(), 2 * 60000);
    const retryTimer = setInterval(() => { void warmBuffer(); if (!baseLoaded || !frames.length) void refresh(); }, 30000);
    return () => {
      controller.abort(); clearInterval(refreshTimer); clearInterval(retryTimer);
      for (const buffer of Object.values(buffers)) URL.revokeObjectURL(buffer.src);
    };
  });
  $effect(() => {
    if (frame && buffers[frame.url]?.ready) displayed = frame;
  });
  $effect(() => {
    if (!playing || !frame || !buffers[frame.url]?.ready) return;
    const timer = setTimeout(() => {
      const next = (index + 1) % frames.length;
      if (buffers[frames[next].url]?.ready) index = next;
    }, 800);
    // Reading readyCount re-arms playback when a missing next frame arrives.
    void readyCount;
    return () => clearTimeout(timer);
  });
</script>

<div class="radar-heading"><h2>{m.weather_ui_rain_radar()}</h2><span>100 km</span></div>
<div class="radar-map-image" data-buffered={readyCount} data-frames={frames.length}>
  {#if baseMap}<img class="radar-base" src={baseMap} alt="" onload={() => { baseLoaded = true; }} onerror={() => { failed = true; }} />{/if}
  {#each Object.entries(buffers) as [url, buffer] (url)}
    <img class="radar-overlay" class:is-visible={displayed?.url === url} src={buffer.src} data-frame-url={url} alt={displayed?.url === url && displayed ? m.weather_ui_observed_precipitation_at() + label(displayed.time) : ''} aria-hidden={displayed?.url !== url} onload={event => { void decoded(event, url); }} onerror={() => discard(url)} />
  {/each}
  {#if coverage === 'unavailable' || (!displayed || !baseLoaded) && (loading || failed || !baseLoaded || !displayed)}
    <div class="radar-status" role="status">
      {coverage === 'unavailable' ? m.weather_ui_no_radar_coverage_here() : failed ? m.weather_ui_radar_currently_unavailable() : m.weather_ui_buffering_radar()}
      {#if failed}<button class="pressable" onclick={() => { void refresh(); void warmBuffer(); }}>{m.weather_ui_retry()}</button>{/if}
    </div>
  {/if}
  <a class="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
</div>
<div class="radar-transport">
  <button class="pressable" disabled={!readyCount || coverage === 'unavailable'} aria-label={playing ? m.weather_ui_pause_radar() : m.weather_ui_play_radar()} aria-pressed={playing} onclick={() => { playing = !playing; if (playing && index === frames.length - 1 && buffers[frames[0].url]?.ready) index = 0; }}><Icon name={playing ? 'i-pause' : 'i-play'} /></button>
  <div class="radar-timeline"><input type="range" min="0" max={Math.max(0, frames.length - 1)} value={index} disabled={!frames.length} aria-label={m.weather_ui_radar_time()} aria-valuetext={frame ? label(frame.time) : ''} oninput={e => { playing = false; index = Number((e.currentTarget as HTMLInputElement).value); }} />
    <div><span>{frames[0] ? label(frames[0].time) : '—'}</span><strong>{displayed ? label(displayed.time) : '—'}</strong><span>{frames.at(-1) ? label(frames.at(-1)!.time) : '—'}</span></div>
  </div>
</div>
<small>{m.weather_ui_observations_past_2_hours()}{coverage === 'partial' || coverage === 'unknown' ? m.weather_ui_limited_coverage() : ''} · <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a> · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></small>

<style>
  h2 { margin: 0; font-size: var(--text-md); font-weight: var(--font-weight-medium); }
  .radar-map-image { position: relative; flex: 1; min-height: calc(var(--space-8) * 3); overflow: hidden; border-radius: var(--radius-xl); background: var(--glass-face); }
  .radar-base, .radar-overlay { position: absolute; inset: 0; width: 100%; height: 100%; }
  .radar-base, .radar-overlay { object-fit: cover; }
  .radar-overlay { opacity: 0; pointer-events: none; } .radar-overlay.is-visible { opacity: 1; }
  .radar-base { filter: grayscale(1) invert(1); opacity: .65; }
  .radar-heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
  .radar-heading > span { font-size: var(--text-xs); color: var(--glass-text-secondary); }
  .map-credit { position: absolute; right: var(--space-1); bottom: var(--space-1); font-size: var(--text-3xs); color: var(--glass-text); background: var(--glass-fill); border-radius: var(--radius-sm); padding: var(--space-1); }
  .radar-status { position: absolute; inset: 0; display: grid; place-content: center; gap: var(--space-2); text-align: center; padding: var(--space-4); background: var(--glass-scrim); }
  .radar-transport { display: flex; align-items: center; gap: var(--space-3); }
  button { min-height: var(--touch-min); min-width: var(--touch-min); padding: var(--space-2); border: 1px solid var(--glass-border); border-radius: var(--radius-full); color: inherit; background: var(--glass-face); cursor: pointer; display: grid; place-items: center; }
  .radar-timeline { flex: 1; min-width: 0; } input { width: 100%; min-height: var(--touch-min); margin: 0; accent-color: var(--color-accent-warm); cursor: pointer; }
  .radar-timeline > div { display: flex; justify-content: space-between; gap: var(--space-2); font-size: var(--text-2xs); color: var(--glass-text-secondary); }
  strong { color: var(--color-accent-warm); font-weight: var(--font-weight-medium); }
  small { font-size: var(--text-2xs); color: var(--glass-text-secondary); } a { color: inherit; }
  @media (min-width: 1001px) and (min-height: 600px) { .radar-map-image { min-height: 0; } }
</style>
