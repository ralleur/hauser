<script lang="ts">
  import { tick } from 'svelte';
  import { commuteFade, commuteMapTransition, commuteRouteDraw, commuteTiming } from '../state/commute-motion.ts';
  import { m } from '../../paraglide/messages.js';
  import Icon from './Icon.svelte';
  import CommuteMapBackdrop from './CommuteMapBackdrop.svelte';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { commute, refreshCommute } from '../state/commute.svelte.ts';
  import { departureFor, freshCommute, inCommuteWindow, mapPath } from '../state/commute.ts';
  import { intlLocale } from '../state/locale.svelte.ts';
  let { active, preview = false, mode = null, clockHost, onlayout, onvisible }: { active: boolean; preview?: boolean; mode?: boolean | null; clockHost?: HTMLElement; onlayout: (layout: { x: number; y: number; width: number }) => void; onvisible: (shown: boolean) => void } = $props();
  let mapEl = $state<SVGSVGElement>();
  let cardEl = $state<HTMLElement>();
  let composition = $state({ width: 1000, height: 600, panelWidth: 320, x: 32, clockY: 32, cardY: 320, scale: 1, tx: 0, ty: 0, transform: '' });
  let now = $state(new Date());
  const visible = $derived(active && freshCommute(commute.route, now) && (mode ?? (preview || inCommuteWindow(commute.config, now))));
  $effect(() => { onvisible(visible); });
  $effect(() => {
    if (!active) return;
    now = new Date();
    void refreshCommute();
    const tick = setInterval(() => {
      now = new Date();
      if (mode === true || preview || inCommuteWindow(commute.config, now)) void refreshCommute();
    }, 30_000);
    const resume = () => { now = new Date(); if (document.visibilityState === 'visible') void refreshCommute(); };
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', resume); };
  });
  const time = (date: Date) => date.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  $effect(() => {
    const route = commute.route;
    if (!visible || !mapEl || !cardEl || !clockHost || !route) return;
    const card = cardEl, host = clockHost, clock = host.querySelector<HTMLElement>('.ambient-content')!;
    const surface = mapEl.parentElement!;
    let frame = 0, disposed = false;
    function measure() {
      const bounds = surface.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(surface).getPropertyValue('--space-5'));
      const pad = gap * 2;
      const control = surface.querySelector('.commute-view-control')?.getBoundingClientRect();
      const top = control ? control.bottom - bounds.top + gap : gap;
      let left = gap, right = bounds.width - gap, bottom = bounds.height - gap;
      for (const selector of ['.ambient-shopping', '.ambient-postits', '.ambient-week']) {
        const element = surface.querySelector<HTMLElement>(selector);
        if (!element || !element.getClientRects().length) continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (selector === '.ambient-week') bottom = Math.min(bottom, box.top - bounds.top - gap);
        else if (box.left + box.width / 2 < bounds.left + bounds.width / 2) left = Math.max(left, box.right - bounds.left + gap);
        else right = Math.min(right, box.left - bounds.left - gap);
      }
      const width = Math.max(gap, right - left), height = Math.max(gap, bottom - top);
      const xs = route!.line.map(p => p[0]), ys = route!.line.map(p => p[1]);
      const minX = Math.min(...xs) - 20, maxX = Math.max(...xs) + 20;
      const minY = Math.min(...ys) - 44, maxY = Math.max(...ys) + 12;
      const split = width >= 480 && (maxY - minY) > (maxX - minX);
      const panelWidth = split ? Math.min(360, (width - gap) * .52) : Math.min(576, width);
      card.style.width = `${panelWidth}px`; host.style.width = `${panelWidth}px`;
      const clockHeight = clock.getBoundingClientRect().height, cardHeight = card.getBoundingClientRect().height;
      const x = split ? left : left + (width - panelWidth) / 2;
      const clockY = split ? top + Math.max(0, (height - clockHeight - gap - cardHeight) / 2) : top;
      const cardY = split ? clockY + clockHeight + gap : bottom - cardHeight;
      const map = split
        ? { x: left + panelWidth + gap, y: top, width: width - panelWidth - gap, height }
        : { x: left, y: clockY + clockHeight + gap, width, height: Math.max(gap, cardY - clockY - clockHeight - gap * 2) };
      const scale = Math.min(Math.max(gap, map.width - pad) / (maxX - minX), Math.max(gap, map.height - pad) / (maxY - minY));
      const tx = map.x + map.width / 2 - (minX + maxX) / 2 * scale;
      const ty = map.y + map.height / 2 - (minY + maxY) / 2 * scale;
      onlayout({ x, y: clockY, width: panelWidth });
      composition = { width: bounds.width, height: bounds.height, panelWidth, x, clockY, cardY, scale, tx, ty, transform: `translate(${tx},${ty}) scale(${scale})` };
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(surface); resize.observe(card); resize.observe(clock);
    for (const element of surface.querySelectorAll('.ambient-shopping, .ambient-postits, .ambient-week')) resize.observe(element);
    const changes = new MutationObserver(schedule);
    changes.observe(surface, { childList: true, subtree: true });
    void tick().then(() => { if (!disposed) measure(); });
    return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect(); };
  });
</script>

{#if visible && commute.route}
  {@const route = commute.route}
  {@const departure = departureFor(commute.config, route.durationMinutes, now)}
  {@const immediate = mode === true}
  {@const home = route.line[0]}
  {@const work = route.line[route.line.length - 1]}
  <svg class="commute-map" transition:commuteMapTransition={{ commute: true }} bind:this={mapEl} viewBox={`0 0 ${composition.width} ${composition.height}`} style:--commute-map-scale={composition.scale} aria-hidden="true">
    <foreignObject width={composition.width} height={composition.height}>
      <CommuteMapBackdrop roads={route.roads} areas={route.areas ?? []} width={composition.width} height={composition.height} scale={composition.scale} tx={composition.tx} ty={composition.ty} colors={settingsValues.ambientMapColors} />
    </foreignObject>
    <g transform={composition.transform}>
    <path class="commute-route-halo" in:commuteRouteDraw out:commuteFade d={mapPath(route.line)} />
    <path class="commute-route-line" in:commuteRouteDraw out:commuteFade d={mapPath(route.line)} />
    {#each route.sections as section}
      <path class="commute-traffic" in:commuteFade={{ delay: commuteTiming('map') + commuteTiming('route') }} out:commuteFade class:is-severe={section.severe} d={mapPath(section.points)} />
    {/each}
    {#each route.reports.filter((r) => r.point && ['jam', 'accident', 'road_closed', 'road_works'].includes(r.category)) as report}
      {#if report.point}<g class="commute-incident" in:commuteFade={{ delay: commuteTiming('map') + commuteTiming('route') }} out:commuteFade transform={`translate(${report.point[0]},${report.point[1]})`}>
        <path d="M0,-10 L10,8 L-10,8 Z" /><text y="5">!</text>
      </g>{/if}
    {/each}
    <g class="commute-pin" in:commuteFade={{ delay: commuteTiming('map') }} out:commuteFade transform={`translate(${home[0]},${home[1]})`}>
      <circle r="4" /><path d="M0,-3 L-7,-17 L7,-17 Z" /><circle cy="-24" r="14" />
      <path class="commute-pin-symbol" d="M-7,-24 L0,-30 L7,-24 M-5,-25 V-18 H5 V-25 M-1,-18 V-23 H2 V-18" />
    </g>
    <g class="commute-pin" in:commuteFade={{ delay: commuteTiming('map') + commuteTiming('route') }} out:commuteFade transform={`translate(${work[0]},${work[1]})`}>
      <circle r="4" /><path d="M0,-3 L-7,-17 L7,-17 Z" /><circle cy="-24" r="14" />
      <path class="commute-pin-symbol" d="M-7,-28 H7 V-19 H-7 Z M-3,-28 V-31 H3 V-28 M-7,-24 H7" />
    </g>
    </g>
  </svg>
  <section class="commute-card" in:commuteFade={{ delay: commuteTiming('map') }} out:commuteFade bind:this={cardEl} style:left={`${composition.x}px`} style:top={`${composition.cardY}px`} style:width={`${composition.panelWidth}px`} aria-label={m.commute_title()}>
    <div class="commute-card-icon"><Icon name="i-car-outline" cls="icon icon-xl" /></div>
    <div class="commute-copy">
      <h2>{m.commute_title()}</h2>
      <p class="commute-duration num">{m.commute_minutes({ count: route.durationMinutes })}
        {#if route.delayMinutes !== null && route.delayMinutes > 0}<strong> · {m.commute_delay({ count: route.delayMinutes })}</strong>{/if}
      </p>
      {#if !immediate && route.reports[0]}<p class="commute-report">{route.reports[0].title}</p>{/if}
      <p class="commute-departure">
        {immediate ? m.commute_arrival_now({ time: time(new Date(now.getTime() + route.durationMinutes * 60_000)) })
          : departure.minutes > 0 ? m.commute_leave_in({ count: departure.minutes, arrival: commute.config.arrival })
          : departure.minutes === 0 ? m.commute_leave_now({ arrival: commute.config.arrival })
            : m.commute_leave_at({ time: time(departure.at), arrival: commute.config.arrival })}
      </p>
      {#if !immediate && (route.rainAt || route.parking)}<div class="commute-extras">
        {#if route.rainAt}<span><Icon name="i-weather-rainy" cls="icon icon-md" />{Date.parse(route.rainAt) <= now.getTime() ? m.commute_rain_now() : m.commute_rain_at({ time: time(new Date(route.rainAt)) })}</span>{/if}
        {#if route.parking}<span><Icon name="i-parking" cls="icon icon-md" />{route.parking.name} · {route.parking.state} {route.parking.unit}</span>{/if}
      </div>{/if}
      <small class="commute-source">TomTom · {m.commute_updated({ time: time(new Date(route.updatedAt)) })}</small>
    </div>
  </section>
{/if}

<style>
  .commute-map { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: -1; }
  .commute-map path { fill: none; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  /* Dash lengths must scale with the path. Non-scaling strokes repeat the dash
     near the destination before drawing has reached it. Keep the ink width
     constant by compensating for the map scale instead. */
  .commute-map .commute-route-halo { vector-effect: none; stroke: var(--color-accent-warm); stroke-width: calc(var(--space-3) / var(--commute-map-scale)); opacity: var(--commute-route-halo-opacity); }
  .commute-map .commute-route-line { vector-effect: none; stroke: var(--color-accent-warm); stroke-width: calc(var(--commute-route-width) / var(--commute-map-scale)); }
  .commute-traffic { stroke: var(--color-warning); stroke-width: var(--space-1); }
  .commute-traffic.is-severe { stroke: var(--color-error); }
  .commute-pin { fill: var(--color-accent-warm); stroke: var(--color-accent-warm); stroke-width: var(--commute-pin-width); }
  .commute-pin circle[cy] { fill: var(--color-surface-1); }
  .commute-pin .commute-pin-symbol { stroke: var(--color-accent-warm); }
  .commute-incident path { stroke: var(--color-warning); fill: var(--color-surface-1); stroke-width: calc(var(--commute-line-thin) * 2); }
  .commute-incident text { fill: var(--color-warning); text-anchor: middle; font: bold var(--text-xs) var(--font-family); }
  .commute-card { position: absolute;
    display: flex; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--ambient-glass-ground, var(--color-surface-1)) var(--commute-card-opacity), transparent); color: var(--color-text-primary); box-shadow: var(--elevation-overlay-shadow); pointer-events: none; }
  .commute-card-icon { align-self: start; display: grid; place-items: center; padding: var(--space-2); color: var(--color-accent-warm);
    background: color-mix(in srgb, var(--color-accent-warm) calc(100% - var(--commute-card-opacity)), transparent); border-radius: var(--radius-lg); }
  .commute-copy { min-width: 0; }
  .commute-copy h2 { font-size: var(--text-lg); font-weight: var(--font-weight-semibold); margin: 0 0 var(--space-1); }
  .commute-copy p { margin: var(--space-1) 0 0; font-size: var(--text-base); line-height: var(--leading-snug); }
  .commute-copy strong { color: var(--color-accent-warm); }
  .commute-report, .commute-departure { color: var(--color-text-secondary); }
  .commute-source { display: block; margin-top: var(--space-2); font-size: var(--text-xs); color: var(--color-text-secondary); }
  .commute-extras { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-border); }
  .commute-extras span { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
  @media (max-width: 767px), (max-height: 650px) { .commute-card-icon { display: none; } }
</style>
