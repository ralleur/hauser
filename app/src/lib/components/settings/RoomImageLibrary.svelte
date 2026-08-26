<script lang="ts">
  import { tick } from 'svelte';
  import '../../../styles/room-images.css';
  import { m } from '../../../paraglide/messages.js';
  import { appState } from '../../state/app.svelte.ts';
  import { IS_DEMO } from '../../demo/demo-mode.ts';
  import { intlLocale } from '../../state/locale.svelte.ts';
  import {
    assignRoomImage,
    deleteRoomImageAsset,
    formatRoomImageBytes,
    loadRoomImageLibrary,
    type RoomImageLibrary,
    type RoomImageLibraryAsset,
  } from '../../state/room-image-library-client.ts';

  /* Ohne targetRoomId ist es die Verwaltung, mit targetRoomId die Auswahl
     für genau diesen Raum. */
  let { open, targetRoomId = null, onclose, onassigned }: {
    open: boolean;
    targetRoomId?: string | null;
    onclose: () => void;
    onassigned?: (assetId: string | null) => void;
  } = $props();

  let library = $state<RoomImageLibrary | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let confirmDelete = $state<string | null>(null);
  let roomChoice = $state<Record<string, string>>({});
  let dialog = $state<HTMLElement>();
  let wasOpen = false;

  const rooms = $derived(appState.rooms.map((room) => ({ id: room.id, name: room.name })));
  const targetRoomName = $derived(rooms.find((room) => room.id === targetRoomId)?.name ?? targetRoomId ?? '');

  $effect(() => {
    if (open && !wasOpen) {
      error = null;
      notice = null;
      confirmDelete = null;
      void reload();
      void tick().then(() => dialog?.focus());
    }
    wasOpen = open;
  });

  async function reload() {
    busy = true;
    try {
      library = await loadRoomImageLibrary();
      error = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.rimg_lib_err_load();
    } finally {
      busy = false;
    }
  }

  function roomNames(ids: string[]): string {
    if (!ids.length) return m.rimg_lib_unassigned();
    return ids.map((id) => rooms.find((room) => room.id === id)?.name ?? id).join(', ');
  }

  async function assign(asset: RoomImageLibraryAsset, roomId: string) {
    if (!library || !roomId || busy) return;
    busy = true;
    error = null;
    notice = null;
    try {
      await assignRoomImage(roomId, { assetId: asset.assetId, focus: asset.focus }, library.householdEtag);
      notice = m.rimg_lib_assigned_to({ room: rooms.find((room) => room.id === roomId)?.name ?? roomId });
      onassigned?.(asset.assetId);
      await reload();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.rimg_err_assign();
      busy = false;
    }
  }

  async function unassign(roomId: string) {
    if (!library || busy) return;
    busy = true;
    error = null;
    notice = null;
    try {
      await assignRoomImage(roomId, null, library.householdEtag);
      notice = m.rimg_lib_unassigned_notice();
      onassigned?.(null);
      await reload();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.rimg_lib_err_unassign();
      busy = false;
    }
  }

  async function remove(asset: RoomImageLibraryAsset) {
    if (busy) return;
    if (confirmDelete !== asset.assetId) {
      confirmDelete = asset.assetId;
      return;
    }
    confirmDelete = null;
    busy = true;
    error = null;
    notice = null;
    try {
      await deleteRoomImageAsset(asset.assetId);
      notice = m.rimg_lib_deleted();
      await reload();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.rimg_lib_err_delete();
      busy = false;
    }
  }

  function closeOnScrim(event: MouseEvent) {
    if (event.target === event.currentTarget) onclose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="room-image-wizard-layer" role="presentation" onclick={closeOnScrim}>
    <div class="room-image-wizard" role="dialog" aria-modal="true" aria-labelledby="room-image-library-title"
         tabindex="-1" bind:this={dialog}>
      <header class="room-image-wizard-head">
        <div>
          <span class="caps-label">{m.rimg_eyebrow()}</span>
          <h2 id="room-image-library-title">
            {targetRoomId ? m.rimg_lib_pick_for({ room: targetRoomName }) : m.rimg_lib_title()}
          </h2>
          <p>
            {#if library}
              {m.rimg_lib_summary({ count: library.assets.length, size: formatRoomImageBytes(library.totalByteLength) })}
            {:else}
              {m.rimg_lib_loading()}
            {/if}
          </p>
        </div>
        <button class="dialog-close pressable" type="button" aria-label={m.rimg_lib_close()} onclick={onclose}>×</button>
      </header>

      {#if IS_DEMO}<p class="room-image-alert" role="status">{m.demo_rimg_notice()}</p>{/if}
      {#if error}<p class="room-image-alert is-error" role="alert">{error}</p>{/if}
      {#if notice}<p class="room-image-alert" role="status">{notice}</p>{/if}

      {#if library && library.assets.length === 0}
        <p class="room-image-alert" role="status">
          {m.rimg_lib_empty()}
        </p>
      {:else if library}
        <div class="room-image-library-grid">
          {#each library.assets as asset (asset.assetId)}
            <article class="room-image-library-card">
              <img src={asset.variants.light} alt={m.rimg_lib_alt({ id: asset.assetId })} loading="lazy" />
              <div class="room-image-library-meta">
                <strong>{roomNames(asset.assignedRoomIds)}</strong>
                <small>{m.rimg_lib_meta({ size: formatRoomImageBytes(asset.byteLength), date: new Date(asset.createdAt).toLocaleDateString(intlLocale()) })}</small>
              </div>
              <div class="room-image-library-actions">
                {#if targetRoomId}
                  <button class="primary-btn pressable" type="button" disabled={busy}
                          onclick={() => assign(asset, targetRoomId)}>
                    {asset.assignedRoomIds.includes(targetRoomId) ? m.rimg_lib_assign_again() : m.rimg_lib_assign_here()}
                  </button>
                {:else}
                  <label>
                    <span class="visually-hidden">{m.rimg_lib_room_for_set()}</span>
                    <select bind:value={roomChoice[asset.assetId]} disabled={busy}>
                      <option value="">{m.rimg_lib_pick_room()}</option>
                      {#each rooms as room (room.id)}
                        <option value={room.id}>{room.name}</option>
                      {/each}
                    </select>
                  </label>
                  <button class="secondary-btn pressable" type="button"
                          disabled={busy || !roomChoice[asset.assetId]}
                          onclick={() => assign(asset, roomChoice[asset.assetId])}>{m.rimg_lib_assign()}</button>
                {/if}
                {#each asset.assignedRoomIds as roomId (roomId)}
                  <button class="secondary-btn pressable" type="button" disabled={busy}
                          onclick={() => unassign(roomId)}>{m.rimg_lib_unassign_from({ room: roomNames([roomId]) })}</button>
                {/each}
                <button class="secondary-btn danger-btn pressable" type="button" disabled={busy}
                        onclick={() => remove(asset)}>
                  {confirmDelete === asset.assetId ? m.rimg_lib_delete_confirm() : m.rimg_lib_delete()}
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}

      <footer class="room-image-wizard-actions">
        <button class="secondary-btn pressable" type="button" onclick={onclose}>{m.rimg_close()}</button>
      </footer>
    </div>
  </div>
{/if}
