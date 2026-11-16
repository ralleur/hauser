<script lang="ts">
  import { onMount } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import { arrivalFor, commuteDateKey, defaultCommute, departureFor, freshCommute, nextCommuteDay, type CommuteConfig, type CommuteRoute, type CommutePlace } from '../../state/commute.ts';
  import { prepareCommutePreview, refreshCommute } from '../../state/commute.svelte.ts';
  import { intlLocale } from '../../state/locale.svelte.ts';
  import { requestAmbientPreview } from '../../state/ambient.svelte.ts';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import TimeField from '../TimeField.svelte';
  import CommutePlaceField from './CommutePlaceField.svelte';

  let config = $state<CommuteConfig>({ ...defaultCommute, days: [...defaultCommute.days] });
  let saved = $state<CommuteConfig | null>(null);
  let routes = $state<{ id: string; name: string }[]>([]);
  let currentRoute = $state<CommuteRoute | null>(null);
  let busy = $state(true);
  let previewing = $state(false);
  let error = $state('');
  let message = $state('');
  let scheduleNow = $state(new Date());
  let home = $state<CommutePlace | null>(null);
  let editing = $state(false);
  let creating = $state(false);
  let routeName = $state('');
  let routeNameTaken = $state(false);
  let start = $state<CommutePlace | null>(null);
  let destination = $state<CommutePlace | null>(null);
  const key = (value: CommuteConfig) => JSON.stringify({ ...value, days: [...value.days].sort() });
  const dirty = $derived(saved !== null && key(config) !== key(saved));
  const enabled = $derived(config.entryId !== '');
  const suggestedRoute = $derived(!enabled && routes.length === 1 ? routes[0] : undefined);
  const missing = $derived(enabled && !routes.some((route) => route.id === config.entryId));
  const validation = $derived(!enabled && !editing ? '' : !config.days.length ? m.commute_need_days()
    : config.from === config.until ? m.commute_need_window() : '');
  const ready = $derived(saved?.entryId && freshCommute(currentRoute, new Date()));
  const nextDay = $derived(nextCommuteDay(config, scheduleNow));
  const nextDate = $derived(commuteDateKey(nextDay));
  const weekdays = [1, 2, 3, 4, 5, 6, 0];
  const weekday = (day: number, long = false) => new Date(2026, 10, 15 + day).toLocaleDateString(intlLocale(), { weekday: long ? 'long' : 'short' });
  const time = (at: Date) => at.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  onMount(() => {
    void load();
    const timer = setInterval(() => { scheduleNow = new Date(); }, 30_000);
    return () => clearInterval(timer);
  });

  async function readCurrent() {
    try {
      const response = await fetch('/api/commute?mapBounds=route', { signal: AbortSignal.timeout(15_000) });
      currentRoute = response.ok ? (await response.json()).route : null;
    } catch { currentRoute = null; }
  }
  async function preview() {
    if (busy || editing || dirty || !saved?.entryId) return;
    busy = true; previewing = true; error = ''; message = '';
    try {
      const status = await prepareCommutePreview();
      currentRoute = status.route;
      requestAmbientPreview();
    } catch { error = m.commute_preview_error(); }
    finally { busy = false; previewing = false; }
  }
  async function load() {
    busy = true; error = ''; message = '';
    try {
      const response = await fetch('/api/admin/commute', { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error();
      const body = await response.json();
      routes = body.routes; home = body.home;
      if (!saved) {
        config = { ...defaultCommute, ...body.config };
        saved = structuredClone($state.snapshot(config));
      }
      await readCurrent();
    } catch { error = m.commute_error(); }
    finally { busy = false; }
  }
  async function save() {
    if (busy || editing || !saved || validation) return;
    busy = true; error = ''; message = '';
    try {
      const response = await fetch('/api/admin/commute', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config), signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error();
      config = (await response.json()).config;
      saved = structuredClone($state.snapshot(config));
      message = m.commute_saved();
      await refreshCommute(); await readCurrent();
    } catch { error = m.commute_error(); }
    finally { busy = false; }
  }
  async function editRoute(create: boolean) {
    creating = create; routeNameTaken = false; error = ''; message = '';
    routeName = create ? '' : routes.find((r) => r.id === config.entryId)?.name ?? m.commute_title();
    start = home; destination = null;
    if (!create) {
      busy = true;
      try {
        const response = await fetch(`/api/admin/commute/route?entryId=${encodeURIComponent(config.entryId)}`, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error();
        const body = await response.json(); start = body.start; destination = body.destination;
      } catch { error = m.commute_route_error(); return; }
      finally { busy = false; }
    }
    editing = true;
  }
  async function saveRoute() {
    if (!start || !destination || validation || (creating && (!routeName.trim() || routeNameTaken))) return;
    busy = true; error = ''; message = '';
    try {
      const response = await fetch('/api/admin/commute/route', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: routeName, start, destination, config: { ...config, entryId: creating ? '' : config.entryId } }), signal: AbortSignal.timeout(90_000) });
      if (response.status === 409 && (await response.json()).code === 'COMMUTE_ROUTE_NAME_TAKEN') {
        routeNameTaken = true;
        return;
      }
      if (!response.ok) throw new Error();
      config = (await response.json()).config;
      saved = structuredClone($state.snapshot(config));
      if (!routes.some((r) => r.id === config.entryId)) routes = [...routes, { id: config.entryId, name: routeName }];
      editing = false; message = m.commute_saved();
      await refreshCommute(); await readCurrent();
    } catch { error = m.commute_route_error(); }
    finally { busy = false; }
  }
  function toggleDay(day: number, on: boolean) {
    config.days = on ? [...config.days, day].sort() : config.days.filter((d) => d !== day);
  }
  function setWeekdayArrival(day: number, time: string) {
    config.arrivals = { ...config.arrivals, [day]: time };
  }
</script>

{#if error}<div class="settings-group commute-notice" role="alert"><p>{error}</p><button class="secondary-btn pressable" type="button" disabled={busy} onclick={() => void load()}>{m.commute_reload()}</button></div>{/if}
{#if busy && !saved}<p class="settings-note" role="status">{m.commute_loading()}</p>{/if}
{#if saved}
<form onsubmit={(event) => { event.preventDefault(); void save(); }}>
  <fieldset class="commute-form" disabled={busy}>
    <div class="settings-group" data-setting-id="commute-route">
      <SettingsCardHead icon="i-car-outline" tint="warm" title={m.commute_route()} />
      <p class="commute-hint">{m.commute_setup_hint()}</p>
      <label class="settings-row">
        <div class="settings-row-text"><span class="settings-row-label">{m.commute_route()}</span><span class="settings-row-sub">{m.commute_route_hint()}</span></div>
        <select class="settings-input commute-select" disabled={editing} bind:value={config.entryId} onchange={() => { delete config.places; }}>
          <option value="">{m.commute_off()}</option>
          {#if missing}<option value={config.entryId}>{m.commute_route_missing()}</option>{/if}
          {#each routes as route}<option value={route.id}>{route.name}</option>{/each}
        </select>
      </label>
      <div class="commute-hint commute-actions">
        {#if suggestedRoute && !editing}
          {@const route = suggestedRoute}
          <button class="primary-btn pressable" type="button" onclick={() => { config.entryId = route.id; delete config.places; }}>{m.commute_route_use({ name: route.name })}</button>
        {/if}
        <button class="secondary-btn pressable" type="button" disabled={editing} onclick={() => void editRoute(true)}>{m.commute_route_new()}</button>
        <button class="secondary-btn pressable" type="button" disabled={editing || !enabled || missing} onclick={() => void editRoute(false)}>{m.commute_route_edit()}</button>
      </div>
      {#if editing}
        <div class="commute-hint">{m.commute_route_editor_hint()}</div>
        {#if creating}
          <label class="settings-row">
            <span class="settings-row-text">{m.commute_route_name()}</span>
            <input class="settings-input commute-select" bind:value={routeName} maxlength="80"
              aria-invalid={routeNameTaken} aria-describedby={routeNameTaken ? 'commute-route-name-error' : undefined} oninput={() => { routeNameTaken = false; }} />
          </label>
          {#if routeNameTaken}<p id="commute-route-name-error" class="commute-validation" role="alert">{m.commute_route_name_taken()}</p>{/if}
        {/if}
        {#key `${creating}-${config.entryId}`}
          <CommutePlaceField label={m.commute_route_start()} bind:value={start} />
          <CommutePlaceField label={m.commute_route_destination()} bind:value={destination} />
        {/key}
        <p class="commute-hint">{m.commute_route_apply_hint()}</p>
        <div class="commute-hint commute-actions">
          <button class="primary-btn pressable" type="button" disabled={!start || !destination || !!validation || (creating && (!routeName.trim() || routeNameTaken))} onclick={() => void saveRoute()}>{m.commute_route_apply()}</button>
          <button class="secondary-btn pressable" type="button" onclick={() => { editing = false; error = ''; }}>{m.commute_route_cancel()}</button>
        </div>
      {/if}
      {#if !routes.length || missing}
        <div class="commute-setup">
          <p>{m.commute_no_routes()}</p>
          <ol><li>{m.commute_setup_install()}</li><li>{m.commute_setup_route()}</li><li>{m.commute_setup_return()}</li></ol>
          <div class="commute-actions">
            <a class="secondary-btn pressable" href="https://github.com/somansch/tomtom#quick-start" target="_blank" rel="noreferrer">{m.commute_setup_help()}</a>
            <button class="secondary-btn pressable" type="button" onclick={() => void load()}>{m.commute_reload()}</button>
          </div>
        </div>
      {/if}
    </div>

    {#if enabled || editing}
      <div class="settings-group" data-setting-id="commute-schedule">
        <SettingsCardHead icon="i-calendar" tint="warm" title={m.commute_schedule()} />
        <fieldset class="commute-day-field"><legend>{m.commute_days()}</legend>
          <div class="commute-days">{#each weekdays as day}<label class:is-selected={config.days.includes(day)}>
            <input type="checkbox" checked={config.days.includes(day)} aria-label={weekday(day, true)} onchange={(event) => toggleDay(day, event.currentTarget.checked)} />{weekday(day)}
          </label>{/each}</div>
        </fieldset>
        <div class="settings-row"><div class="settings-row-text"><span class="settings-row-label">{m.commute_from()}</span><span class="settings-row-sub">{m.commute_window_hint()}</span></div><TimeField label={m.commute_from()} bind:value={config.from} /></div>
        <div class="settings-row"><span class="settings-row-text">{m.commute_until()}</span><TimeField label={m.commute_until()} bind:value={config.until} /></div>
        <div class="settings-row"><div class="settings-row-text"><span class="settings-row-label">{m.commute_arrival()}</span><span class="settings-row-sub">{m.commute_arrival_hint()}</span></div><TimeField label={m.commute_arrival()} bind:value={config.arrival} /></div>
        {#if config.days.length}
          <details class="commute-hint">
            <summary>{m.commute_weekday_arrivals()}</summary>
            {#each weekdays.filter((day) => config.days.includes(day)) as day (day)}
              <div class="settings-row">
                <span class="settings-row-label">{weekday(day, true)}</span>
                <div class="commute-actions">
                  {#if config.arrivals?.[day]}<button type="button" class="secondary-btn pressable" onclick={() => { delete config.arrivals?.[day]; }}>{m.commute_use_default()}</button>{/if}
                  <TimeField label={weekday(day, true)} bind:value={() => config.arrivals?.[day] ?? config.arrival, (value) => setWeekdayArrival(day, value)} />
                </div>
              </div>
            {/each}
          </details>
          <div class="settings-row">
            <div class="settings-row-text"><span class="settings-row-label">{m.commute_next_arrival()}</span><span class="settings-row-sub">{m.commute_next_arrival_date({ date: nextDay.toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'short' }) })}</span></div>
            <div class="commute-actions">
              {#if config.nextArrival?.date === nextDate}<button type="button" class="secondary-btn pressable" onclick={() => { delete config.nextArrival; }}>{m.commute_use_default()}</button>{/if}
              {#key nextDate}<TimeField label={m.commute_next_arrival()} bind:value={() => arrivalFor(config, nextDay), (value) => { config.nextArrival = { date: nextDate, time: value }; }} />{/key}
            </div>
          </div>
        {/if}
        <p class="commute-hint">{m.commute_polling_hint()}</p>
        {#if validation}<p class="commute-validation" role="alert">{validation}</p>{/if}
      </div>

      <div class="settings-group" data-setting-id="commute-extras">
        <SettingsCardHead icon="i-weather-rainy" tint="cool" title={m.commute_extras()} />
        <div class="settings-row"><div class="settings-row-text"><span class="settings-row-label">{m.commute_show_rain()}</span><span class="settings-row-sub">{m.commute_rain_hint()}</span></div>
          <button class="settings-switch pressable" type="button" role="switch" aria-label={m.commute_show_rain()} aria-checked={config.showRain} onclick={() => { config.showRain = !config.showRain; }}><span class="settings-switch-knob"></span></button>
        </div>
      </div>
    {/if}
  </fieldset>

  <div class="settings-group commute-summary">
    <SettingsCardHead icon="i-information-outline" tint="cool" title={m.commute_status()} />
    {#if ready && currentRoute && saved}
      {@const departure = departureFor(saved, currentRoute.durationMinutes, scheduleNow)}
      <p class="commute-route-name">{currentRoute.name || routes.find((r) => r.id === saved?.entryId)?.name || m.commute_title()}</p>
      <p>{m.commute_minutes({ count: currentRoute.durationMinutes })}{#if currentRoute.delayMinutes} · {m.commute_delay({ count: currentRoute.delayMinutes })}{/if}</p>
      <p class="settings-row-sub">{m.commute_departure_summary({ time: time(departure.at), arrival: departure.arrival })}</p>
      <small class="settings-row-sub">TomTom · {m.commute_updated({ time: time(new Date(currentRoute.updatedAt)) })}</small>
    {:else}<p>{saved.entryId ? m.commute_no_current() : m.commute_disabled_hint()}</p>{/if}
    <p class="settings-row-sub">{dirty ? m.commute_unsaved() : m.commute_shared_hint()}</p>
    <div class="commute-actions">
      <button class="primary-btn pressable" type="submit" disabled={busy || editing || !dirty || !!validation || (missing && config.entryId !== saved.entryId)}>{m.commute_save()}</button>
      <button class="secondary-btn pressable" type="button" disabled={busy || editing || !dirty} onclick={() => { if (saved) config = structuredClone($state.snapshot(saved)); message = ''; error = ''; }}>{m.commute_discard()}</button>
      <button class="secondary-btn pressable" type="button" disabled={busy || editing || dirty || !saved.entryId || missing} aria-busy={previewing} onclick={() => void preview()}>{previewing ? m.commute_loading() : m.sys_preview()}</button>
    </div>
    {#if message}<p role="status">{message}</p>{/if}
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
</form>
{/if}

<style>
  .commute-form, .commute-day-field { min-width: 0; border: 0; padding: 0; margin: 0; }
  .commute-form { display: contents; }
  .commute-hint, .commute-setup, .commute-day-field, .commute-validation { margin: var(--space-4); }
  .commute-hint, .commute-setup, .commute-summary p { font-size: var(--text-base); line-height: var(--leading-normal); }
  .commute-hint, .commute-setup { color: var(--color-text-secondary); }
  .commute-setup ol { padding-left: var(--space-5); display: grid; gap: var(--space-2); }
  .commute-days, .commute-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .commute-days { margin-top: var(--space-3); }
  .commute-days label { display: flex; gap: var(--space-2); align-items: center; min-height: var(--touch-min); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-1); }
  .commute-days label.is-selected { border-color: var(--color-accent-warm); }
  .commute-actions { margin-top: var(--space-4); }
  .commute-select { width: min(50%, calc(var(--space-8) * 5)); }
  .commute-validation { color: var(--color-error); }
  .commute-summary, .commute-notice { padding: var(--space-4); }
  .commute-summary .commute-route-name { font-weight: var(--font-weight-semibold); }
  .commute-summary p + p { margin-top: var(--space-2); }
  @media (max-width: 767px) {
    .settings-row { flex-wrap: wrap; }
    .commute-select { width: 100%; max-width: 100%; }
  }
</style>
