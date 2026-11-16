<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { apiRequest } from '../api/client.ts';
  import { nav } from '../state/nav.svelte.ts';
  import { IS_DEMO } from '../demo/recording-mode.ts';
  import { m } from '../../paraglide/messages.js';
  interface Player { id: string; name: string; state: string; title: string | null; artist: string | null; volume: number | null }
  let players = $state<Player[]>([]);
  let selected = $state('');
  let query = $state('');
  let busy = $state(false);
  let error = $state(false);
  let loaded = $state(false);
  const player = $derived(players.find((item) => item.id === selected));
  const available = $derived(player && !['unavailable', 'unknown'].includes(player.state));

  async function load() {
    const result = await apiRequest<'appStates', { states: Array<{ entityId: string; state: string | null; attributes: Record<string, unknown> }> }>('appStates', { query: { source: 'music-assistant' } });
    loaded = true;
    error = !result.ok;
    if (result.ok) {
      players = result.data.states.map((item) => ({
        id: item.entityId, name: String(item.attributes.friendly_name ?? item.entityId.slice(13)),
        state: item.state ?? 'unknown', title: typeof item.attributes.media_title === 'string' ? item.attributes.media_title : null,
        artist: typeof item.attributes.media_artist === 'string' ? item.attributes.media_artist : null,
        volume: typeof item.attributes.volume_level === 'number' ? item.attributes.volume_level : null,
      }));
      if (!players.some((item) => item.id === selected)) selected = players[0]?.id ?? '';
    }
  }
  $effect(() => {
    if (IS_DEMO || nav.screen !== 'media') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (document.visibilityState !== 'hidden') await load();
      if (!cancelled) timer = setTimeout(() => { void refresh(); }, 10_000);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  });
  async function command(service: string, data: Record<string, unknown> = {}) {
    if (!player || busy) return;
    busy = true;
    error = false;
    const result = await apiRequest('appCommand', { method: 'POST', body: { domain: service === 'play_media' ? 'music_assistant' : 'media_player', service, entityId: player.id, data } });
    if (result.ok) await load(); else error = true;
    busy = false;
  }
</script>

{#if !IS_DEMO}
<section class="detail-section music-assistant">
  <h2>Music Assistant</h2>
  {#if error}<p role="status">{m.music_error()}</p>{/if}
  {#if loaded && !players.length}<p>{m.music_setup_hint()}</p>{/if}
  {#if players.length}
    <label>{m.media_room()} <select bind:value={selected}>{#each players as item (item.id)}<option value={item.id}>{item.name}</option>{/each}</select></label>
    {#if player}
      <div class="music-now"><strong>{player.title ?? m.media_no_playback()}</strong>{#if player.artist}<span>{player.artist}</span>{/if}</div>
      <div class="music-actions">
        <button class="secondary-btn pressable" type="button" disabled={!available || busy} onclick={() => command('media_previous_track')}>{m.media_previous_track()}</button>
        <button class="primary-btn pressable" type="button" disabled={!available || busy} onclick={() => command('media_play_pause')}>{player.state === 'playing' ? m.media_pause() : m.music_play()}</button>
        <button class="secondary-btn pressable" type="button" disabled={!available || busy} onclick={() => command('media_next_track')}>{m.media_next_track()}</button>
      </div>
      {#if player.volume !== null}
        <label>{m.dev_volume()} <input type="range" min="0" max="1" step="0.01" value={player.volume} disabled={!available || busy} onchange={(event) => command('volume_set', { volume_level: Number(event.currentTarget.value) })} /></label>
      {/if}
      <form onsubmit={(event) => { event.preventDefault(); void command('play_media', { media_id: query.trim() }); }}>
        <label>{m.music_query()}<input bind:value={query} maxlength="500" /></label>
        <button class="primary-btn pressable" type="submit" disabled={!available || busy || !query.trim()}>{m.music_play()}</button>
      </form>
    {/if}
  {/if}
</section>
{/if}

<style>
  .music-assistant { display: grid; gap: var(--space-4); }
  h2 { font-size: var(--text-xl); }
  label { display: grid; gap: var(--space-2); }
  input:not([type='range']), select { min-height: var(--touch-min); padding: var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-text-primary); font: inherit; width: 100%; }
  input[type='range'] { min-height: var(--touch-min); accent-color: var(--color-accent-warm); width: 100%; }
  .music-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .music-now { display: grid; gap: var(--space-1); }
  form { display: grid; gap: var(--space-3); }
  form button { justify-self: start; }
</style>
