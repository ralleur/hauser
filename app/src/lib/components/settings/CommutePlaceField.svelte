<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import type { CommutePlace } from '../../state/commute.ts';
  let { label, value = $bindable<CommutePlace | null>(null) }: { label: string; value: CommutePlace | null } = $props();
  let query = $state(value?.label ?? '');
  let results = $state<CommutePlace[]>([]);
  let busy = $state(false);
  let error = $state('');
  async function search() {
    busy = true; error = ''; results = [];
    try {
      const response = await fetch(`/api/admin/commute/places?q=${encodeURIComponent(query.trim())}`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error();
      results = (await response.json()).results;
      if (!results.length) error = m.commute_place_empty();
    } catch { error = m.commute_route_error(); }
    finally { busy = false; }
  }
</script>

<div class="place-field">
  <label><span>{label}</span><input class="settings-input" type="search" bind:value={query} oninput={() => { value = null; results = []; error = ''; }} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (query.trim().length >= 3 && !busy) void search(); } }} /></label>
  <button class="secondary-btn pressable" type="button" disabled={busy || query.trim().length < 3} onclick={() => void search()}>{busy ? m.commute_place_searching() : m.commute_place_search()}</button>
  {#each results as place}
    <button class="secondary-btn pressable place-result" type="button" onclick={() => { value = place; query = place.label; results = []; }}>{place.label}</button>
  {/each}
  {#if value}<p class="settings-row-sub">{m.commute_place_selected({ place: value.label })}</p>{/if}
  {#if error}<p class="settings-row-sub" role="alert">{error}</p>{/if}
</div>

<style>
  .place-field { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); margin: var(--space-4); }
  label { display: grid; gap: var(--space-2); flex: 1; min-width: 0; }
  input { width: 100%; }
  .place-result, p { width: 100%; text-align: left; }
</style>
