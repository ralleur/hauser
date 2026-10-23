<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import Icon from '../Icon.svelte';
  import RoomImageWizard from './RoomImageWizard.svelte';
  import RoomImageLibrary from './RoomImageLibrary.svelte';
  import RoomImageSetup from './RoomImageSetup.svelte';
  import { EXTERIOR_HERO_ID } from '../../config/household-config.ts';
  import { normalizeHeroRoom, roomImageAssetUrl } from '../room-hero-assets.ts';
  import { energyAssetUrl } from '../energy-hero-assets.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { removeRoomBackground } from '../../state/room-background-client.ts';
  import { openRoomEdit } from '../../state/overlay.svelte.ts';
  import { showScreen } from '../../state/nav.svelte.ts';
  import { energyImageUi } from '../../state/energy-marks.svelte.ts';

  let { roomId, ondevices, onarrange, onleave, initialAction = null, page = $bindable('overview'), nested = false }: {
    roomId: string; ondevices?: () => void; onarrange?: () => void; onleave?: () => void;
    initialAction?: 'generate' | 'manual' | 'library' | null; page?: 'overview' | 'change' | 'setup'; nested?: boolean;
  } = $props();
  let wizardOpen = $state(false);
  let manual = $state(false);
  let libraryOpen = $state(false);
  let busy = $state(false);
  let message = $state<string | null>(null);
  let error = $state(false);
  let restoreConfirm = $state(false);
  const exterior = $derived(roomId === EXTERIOR_HERO_ID);
  const config = $derived(roomHeroConfig(roomId));
  const previewUrl = $derived(config ? roomImageAssetUrl(config.assetId, 'light.avif') : defaultUrl());
  function defaultUrl(): string {
    return exterior ? energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun: { day: true }, fallbackTheme: 'light' })
      : `${import.meta.env.BASE_URL}hero/${normalizeHeroRoom(roomId)}-light.avif`;
  }
  $effect(() => {
    if (!initialAction) return;
    page = 'change';
    if (initialAction === 'library') libraryOpen = true;
    else { manual = initialAction === 'manual'; wizardOpen = true; }
  });
  function generate(external: boolean) { manual = external; wizardOpen = true; }
  function setup() {
    if (exterior) page = 'setup';
    else if (ondevices) ondevices();
    else { onleave?.(); openRoomEdit(roomId, 'immersion'); }
  }
  function arrange() {
    if (onarrange) onarrange();
    else { energyImageUi.arrangeRequested = true; onleave?.(); showScreen('energy'); }
  }
  async function restore() {
    if (!restoreConfirm) { restoreConfirm = true; return; }
    busy = true; message = null; error = false;
    try { await removeRoomBackground(roomId); message = m.room_background_restored(); restoreConfirm = false; }
    catch (failure) { error = true; message = failure instanceof Error ? failure.message : m.room_background_failed(); }
    finally { busy = false; }
  }
</script>

<section class="image-editor" aria-label={m.room_background()}>
  {#if page !== 'overview'}
    {#if !nested}<button class="image-back pressable" type="button" onclick={() => page = 'overview'}><Icon name="i-chevron-left" cls="icon icon-sm" />{m.room_background()}</button>{/if}
    <h3>{page === 'change' ? m.img_change() : m.img_setup()}</h3>
  {/if}
  {#if page === 'overview'}
    <div class="image-entries">
      <button class="image-entry pressable" type="button" onclick={() => page = 'change'}><Icon name="i-image" cls="icon icon-md" /><span><strong>{m.img_change()}</strong><small>{m.img_change_hint()}</small></span><Icon name="i-chevron-right" cls="icon icon-md" /></button>
      <button class="image-entry pressable" type="button" onclick={setup}><Icon name="i-cursor-default-click" cls="icon icon-md" /><span><strong>{m.img_setup()}</strong><small>{m.img_setup_hint()}</small></span><Icon name="i-chevron-right" cls="icon icon-md" /></button>
    </div>
  {:else if page === 'change'}
    <div class="image-choices">
      <button type="button" class="image-choice pressable" onclick={() => generate(true)}><Icon name="i-image" cls="icon icon-md" /><strong>{m.img_use_photo()}</strong><span>{m.img_use_photo_hint()}</span></button>
      <button type="button" class="image-choice pressable" onclick={() => generate(false)}><Icon name="i-auto-fix" cls="icon icon-md" /><strong>{m.img_illustrate()}</strong><span>{m.img_illustrate_hint()}</span></button>
      <button type="button" class="image-choice pressable" onclick={() => libraryOpen = true}><Icon name="i-image-multiple" cls="icon icon-md" /><strong>{m.img_from_library()}</strong><span>{m.img_from_library_hint()}</span></button>
    </div>
    <p class="image-hint">{m.img_keep_current()}</p>
  {:else}
    <RoomImageSetup {roomId} onarrange={arrange} />
  {/if}

  {#if page === 'overview'}
    <figure class="image-preview"><img src={previewUrl} alt={m.room_background_preview()} onerror={(event) => { const image = event.currentTarget as HTMLImageElement; const fallback = new URL(defaultUrl(), location.href).href; if (image.src !== fallback) image.src = fallback; }} /><figcaption>{config ? m.room_background_custom() : m.room_background_default()}</figcaption></figure>
    {#if config}<button class="image-back pressable" type="button" disabled={busy} onclick={restore}>{restoreConfirm ? m.img_restore_confirm() : m.room_background_restore()}</button>{/if}
  {/if}
  {#if busy}<p role="status">{m.room_background_saving_hint()}</p>{:else if message}<p class:is-error={error} role="status">{message}</p>{/if}
</section>
{#if wizardOpen}<RoomImageWizard open {roomId} initialWay={manual ? 'manual' : 'auto'} onclose={() => wizardOpen = false} />{/if}
{#if libraryOpen}<RoomImageLibrary open targetRoomId={roomId} onclose={() => libraryOpen = false} onassigned={() => libraryOpen = false} />{/if}

<style>
  .image-editor { display: grid; gap: var(--space-4); color: var(--color-text-primary); }
  h3 { margin: 0; font-size: var(--text-lg); }
  .image-entries { display: grid; gap: var(--space-3); }
  .image-entry { display: flex; gap: var(--space-3); align-items: center; width: 100%; padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-text-primary); font: inherit; text-align: left; cursor: pointer; }
  .image-entry > span { display: grid; gap: var(--space-1); flex: 1; }
  .image-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(var(--space-8) * 4)), 1fr)); gap: var(--space-3); }
  .image-choice { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-2); color: var(--color-text-primary); font: inherit; text-align: left; cursor: pointer; }
  .image-choice span, .image-hint, small { color: var(--color-text-secondary); font-size: var(--text-sm); }
  .image-back { display: inline-flex; gap: var(--space-2); align-items: center; justify-self: start; min-height: var(--touch-min); border: 0; background: none; color: var(--color-text-primary); font: inherit; cursor: pointer; }
  .image-preview { margin: 0 auto; max-width: calc(var(--space-8) * 15); overflow: hidden; border-radius: var(--radius-lg); background: var(--color-surface-2); }
  .image-preview img { display: block; width: 100%; max-height: 40dvh; object-fit: contain; }
  figcaption { padding: var(--space-2) var(--space-3); font-size: var(--text-sm); }
  .image-hint { margin: 0; }
  .is-error { color: var(--color-error); }
</style>
