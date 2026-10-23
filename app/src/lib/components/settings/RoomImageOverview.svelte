<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { appState } from '../../state/app.svelte.ts';
  import { EXTERIOR_HERO_ID } from '../../config/household-config.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { normalizeHeroRoom, roomImageAssetUrl } from '../room-hero-assets.ts';
  import { energyAssetUrl } from '../energy-hero-assets.ts';
  import RoomImageEditorDialog from './RoomImageEditorDialog.svelte';
  import RoomImageLibrary from './RoomImageLibrary.svelte';
  let selected = $state<string | null>(null);
  let libraryOpen = $state(false);
  const targets = $derived([...appState.rooms.map(room => ({ id: room.id, name: room.name })), { id: EXTERIOR_HERO_ID, name: m.img_exterior() }]);
  const target = $derived(targets.find(room => room.id === selected));
  function preview(id: string): string {
    const hero = roomHeroConfig(id);
    return hero ? roomImageAssetUrl(hero.assetId, 'light.avif') : fallback(id);
  }
  function fallback(id: string): string { return id === EXTERIOR_HERO_ID ? energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun: { day: true }, fallbackTheme: 'light' }) : `${import.meta.env.BASE_URL}hero/${normalizeHeroRoom(id)}-light.avif`; }
</script>
<div class="image-overview" data-setting-id="room-image-wizard">
  {#each targets as room}
    <button class="image-target pressable" type="button" aria-label={`${room.name} · ${m.img_edit()}`} onclick={() => selected = room.id}>
      <img src={preview(room.id)} alt="" loading="lazy" onerror={(event) => { const image = event.currentTarget as HTMLImageElement; const url = new URL(fallback(room.id), location.href).href; if (image.src !== url) image.src = url; }} />
      <span><strong>{room.name}</strong><small>{roomHeroConfig(room.id) ? m.room_background_custom() : m.room_background_default()}</small></span><span aria-hidden="true">›</span>
    </button>
  {/each}
</div>
<div class="image-library-entry" data-setting-id="room-image-library"><button class="secondary-btn pressable" type="button" onclick={() => libraryOpen = true}>{m.img_library_manage()}</button></div>
{#if target}<RoomImageEditorDialog roomId={target.id} name={target.name} onclose={() => selected = null} />{/if}
{#if libraryOpen}<RoomImageLibrary open onclose={() => libraryOpen = false} />{/if}
<style>
  .image-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--space-8) * 7)), 1fr)); gap: var(--space-3); padding: 0 var(--space-4); }
  .image-target { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-text-primary); font: inherit; text-align: left; cursor: pointer; }
  img { width: calc(var(--space-8) * 2); aspect-ratio: 1; border-radius: var(--radius-md); object-fit: cover; }
  .image-target > span:first-of-type { display: grid; gap: var(--space-1); flex: 1; }
  small { color: var(--color-text-secondary); font-size: var(--text-sm); }
  .image-library-entry { padding: var(--space-4); }
</style>
