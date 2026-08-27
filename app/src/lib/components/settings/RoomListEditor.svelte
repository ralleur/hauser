<script lang="ts">
  /* ── Raumliste der Einstellungen ──
     Eine Zeile pro Raum: aktuelles Raumbild als Vorschau, Name mit
     Geräteanzahl, die Hauptaktion („Geräte konfigurieren“), Umbenennen,
     ein Ziehgriff für die Reihenfolge und ein Menü für den Rest.

     Reihenfolge wird direkt am Griff gezogen (Pointer Events, damit Maus und
     Touch denselben Pfad nehmen); die Pfeiltasten am Griff machen dasselbe
     ohne Zeigegerät. Gezogen wird im Entwurf — gespeichert wird erst mit
     „Änderungen speichern“. */
  import Icon from '../Icon.svelte';
  import type { RoomConfig } from '../../config/household-config.ts';
  import { resolveRoomHero } from '../room-hero-assets.ts';
  import { appState } from '../../state/app.svelte.ts';
  import type { RoomEditView } from '../../state/overlay.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  export interface RoomDeleteOption {
    id: string;
    name: string;
    disabled: boolean;
  }

  let {
    rooms,
    busy = false,
    deleteOptions,
    onopen,
    onrename,
    onreorder,
    ondelete,
    onadd,
  }: {
    rooms: readonly RoomConfig[];
    busy?: boolean;
    deleteOptions: (roomId: string) => RoomDeleteOption[];
    onopen: (roomId: string, view?: RoomEditView) => void;
    onrename: (roomId: string, name: string) => void;
    onreorder: (roomId: string, targetIndex: number) => void;
    ondelete: (roomId: string, destination: string) => void;
    onadd: () => void;
  } = $props();

  const base = import.meta.env.BASE_URL;

  let listEl = $state<HTMLElement>();
  let renamingId = $state<string | null>(null);
  let menuRoomId = $state<string | null>(null);
  let deleteRoomId = $state<string | null>(null);
  let deleteDestination = $state('');
  let dragRoomId = $state<string | null>(null);
  let missingThumbs = $state<Record<string, boolean>>({});

  /* Das Geräte-Overlay arbeitet auf der aktiven Konfiguration: ein Raum, den
     es dort noch nicht gibt, lässt sich erst nach dem Speichern bestücken. */
  const activeRoomIds = $derived(new Set(appState.rooms.map(({ id }) => id)));

  function thumbUrl(room: RoomConfig): string | null {
    const hero = resolveRoomHero({
      target: 'panel',
      baseUrl: base,
      roomId: room.id,
      config: room.hero,
      sun: undefined,
      fallbackTheme: 'light',
    });
    return hero.userCandidate?.url ?? hero.projectFallback?.url ?? null;
  }

  function deviceCount(room: RoomConfig): string {
    const count = room.visibleEntities.length;
    return count === 1
      ? m.settings_rooms_devices_count_one()
      : m.settings_rooms_devices_count_other({ count });
  }

  function startRename(roomId: string): void {
    menuRoomId = null;
    renamingId = roomId;
  }

  function renameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      renamingId = null;
    }
  }

  function focusOnMount(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  function toggleMenu(roomId: string): void {
    menuRoomId = menuRoomId === roomId ? null : roomId;
  }

  function move(roomId: string, direction: -1 | 1): void {
    const index = rooms.findIndex((room) => room.id === roomId);
    if (index < 0) return;
    onreorder(roomId, index + direction);
  }

  function beginDelete(roomId: string): void {
    menuRoomId = null;
    const options = deleteOptions(roomId);
    deleteDestination = options.find((option) => !option.disabled)?.id ?? '__omit__';
    deleteRoomId = roomId;
  }

  function confirmDelete(): void {
    if (!deleteRoomId) return;
    ondelete(deleteRoomId, deleteDestination);
    deleteRoomId = null;
  }

  function rowElements(): HTMLElement[] {
    return [...(listEl?.querySelectorAll<HTMLElement>('[data-room-row]') ?? [])];
  }

  function startDrag(event: PointerEvent, roomId: string): void {
    if (busy || rooms.length < 2) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRoomId = roomId;
  }

  function dragMove(event: PointerEvent): void {
    if (!dragRoomId) return;
    const rows = rowElements();
    const from = rows.findIndex((row) => row.dataset.roomRow === dragRoomId);
    const to = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (from < 0 || to < 0 || from === to) return;
    onreorder(dragRoomId, to);
  }

  function endDrag(event: PointerEvent): void {
    if (!dragRoomId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    dragRoomId = null;
  }

  function handleKeydown(event: KeyboardEvent, roomId: string): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    move(roomId, event.key === 'ArrowUp' ? -1 : 1);
  }
</script>

<svelte:window onclick={(event) => {
  if (menuRoomId && !(event.target as HTMLElement).closest('.room-menu-anchor')) menuRoomId = null;
}} />

<p class="rooms-hint">
  <Icon name="i-lightbulb-outline" cls="icon icon-md" />
  <span>{m.settings_rooms_devices_hint()}</span>
</p>

<div class="rooms-card" bind:this={listEl}>
  {#each rooms as room, index (room.id)}
    {@const thumb = thumbUrl(room)}
    <div
      class="room-row"
      class:is-dragging={dragRoomId === room.id}
      data-room-row={room.id}
      data-setting-id={`room-${room.id}`}
    >
      <div class="room-main">
        <button
          class="room-thumb pressable"
          type="button"
          disabled={busy || !activeRoomIds.has(room.id)}
          aria-label={m.settings_rooms_devices_change_image({ name: room.name })}
          title={activeRoomIds.has(room.id)
            ? m.settings_rooms_devices_change_image({ name: room.name })
            : m.settings_rooms_devices_configure_unsaved()}
          onclick={() => onopen(room.id, 'background')}
        >
          {#if thumb && !missingThumbs[room.id]}
            <img src={thumb} alt="" loading="lazy"
                 onerror={() => (missingThumbs = { ...missingThumbs, [room.id]: true })} />
          {:else}
            <span class="room-thumb-empty"><Icon name="i-image-outline" cls="icon icon-md" /></span>
          {/if}
          <span class="room-index num">{index + 1}</span>
          <span class="room-thumb-edit" aria-hidden="true"><Icon name="i-pencil" cls="icon icon-sm" /></span>
        </button>

        <div class="room-text">
          {#if renamingId === room.id}
            <input
              class="room-name-input"
              data-room-name={room.id}
              value={room.name}
              aria-label={m.setup_room_name()}
              oninput={(event) => onrename(room.id, event.currentTarget.value)}
              onkeydown={renameKeydown}
              onblur={() => (renamingId = null)}
              use:focusOnMount
            />
          {:else}
            <span class="room-name">{room.name}</span>
          {/if}
          <span class="room-count">
            <Icon name="i-lightbulb-outline" cls="icon icon-sm" />
            {deviceCount(room)}
          </span>
        </div>

        <div class="room-actions">
          <button
            class="room-primary pressable"
            type="button"
            disabled={busy || !activeRoomIds.has(room.id)}
            title={activeRoomIds.has(room.id) ? undefined : m.settings_rooms_devices_configure_unsaved()}
            onclick={() => onopen(room.id)}
          >{m.settings_rooms_devices_configure()}</button>

          <button
            class="room-secondary pressable"
            type="button"
            disabled={busy}
            onclick={() => startRename(room.id)}
          >{m.settings_rooms_devices_rename()}</button>

          <button
            class="room-handle"
            type="button"
            aria-label={m.settings_rooms_devices_reorder({ name: room.name })}
            title={m.setup_room_order()}
            disabled={busy || rooms.length < 2}
            onpointerdown={(event) => startDrag(event, room.id)}
            onpointermove={dragMove}
            onpointerup={endDrag}
            onpointercancel={endDrag}
            onkeydown={(event) => handleKeydown(event, room.id)}
          ><Icon name="i-dots-grid" cls="icon icon-md" /></button>

          <div class="room-menu-anchor">
            <button
              class="room-more"
              type="button"
              aria-label={m.settings_rooms_devices_more({ name: room.name })}
              aria-expanded={menuRoomId === room.id}
              disabled={busy}
              onclick={() => toggleMenu(room.id)}
            ><Icon name="i-dots-horizontal" cls="icon icon-md" /></button>

            {#if menuRoomId === room.id}
              <div class="room-menu" role="menu">
                <button class="room-menu-item" type="button" role="menuitem"
                        disabled={index === 0}
                        onclick={() => { menuRoomId = null; move(room.id, -1); }}>
                  <Icon name="i-arrow-up" cls="icon icon-sm" />{m.setup_move_room_up()}
                </button>
                <button class="room-menu-item" type="button" role="menuitem"
                        disabled={index === rooms.length - 1}
                        onclick={() => { menuRoomId = null; move(room.id, 1); }}>
                  <Icon name="i-arrow-down" cls="icon icon-sm" />{m.setup_move_room_down()}
                </button>
                <button class="room-menu-item" type="button" role="menuitem"
                        onclick={() => startRename(room.id)}>
                  <Icon name="i-pencil" cls="icon icon-sm" />{m.settings_rooms_devices_rename()}
                </button>
                <button class="room-menu-item is-danger" type="button" role="menuitem"
                        disabled={rooms.length <= 1}
                        title={rooms.length <= 1 ? m.setup_last_room_hint() : undefined}
                        onclick={() => beginDelete(room.id)}>
                  <Icon name="i-trash-can-outline" cls="icon icon-sm" />{m.setup_delete_room()}
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      {#if deleteRoomId === room.id}
        <div class="room-delete" role="group" aria-labelledby={`delete-room-${room.id}`}>
          <strong id={`delete-room-${room.id}`}>{m.setup_delete_room_title({ name: room.name })}</strong>
          <p>{m.setup_delete_room_hint()}</p>
          <label>
            <span>{m.setup_delete_room_destination()}</span>
            <select bind:value={deleteDestination}>
              {#each deleteOptions(room.id) as option (option.id)}
                <option value={option.id} disabled={option.disabled}>
                  {m.setup_delete_room_move_to({ name: option.name })}
                </option>
              {/each}
              <option value="__omit__">{m.setup_delete_room_omit()}</option>
            </select>
          </label>
          <div class="room-delete-actions">
            <button class="room-secondary pressable" type="button"
                    onclick={() => (deleteRoomId = null)}>{m.setup_delete_room_cancel()}</button>
            <button class="room-danger pressable" type="button"
                    onclick={confirmDelete}>{m.setup_delete_room_confirm()}</button>
          </div>
        </div>
      {/if}
    </div>
  {/each}

  <button class="room-add pressable" type="button" disabled={busy} onclick={onadd}>
    + {m.setup_add_room()}
  </button>
</div>

<style>
  .rooms-hint {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }
  .rooms-hint :global(.icon) { flex: none; color: var(--color-accent-warm); }

  .rooms-card {
    display: flex;
    flex-direction: column;
    margin-bottom: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-surface-1);
    overflow: hidden;
  }
  .room-row + .room-row { border-top: 1px solid var(--color-border); }
  .room-row.is-dragging { background: var(--color-surface-2); }

  .room-main {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  .room-thumb {
    position: relative;
    flex: none;
    padding: 0;
    border: 0;
    cursor: pointer;
    width: calc(var(--space-8) * 2);
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-lg);
    background: var(--color-surface-3);
    overflow: hidden;
  }
  .room-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .room-thumb:disabled { cursor: default; }
  /* Der Stift sagt, dass die Kachel etwas tut — dauerhaft sichtbar, weil das
     Panel per Finger bedient wird und dort kein Hover existiert. */
  .room-thumb-edit {
    position: absolute;
    right: var(--space-1);
    bottom: var(--space-1);
    display: grid;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-surface-0) 82%, transparent);
    color: var(--color-text-primary);
  }
  .room-thumb:disabled .room-thumb-edit { display: none; }
  .room-thumb-empty { display: grid; place-items: center; width: 100%; height: 100%; color: var(--color-text-tertiary); }
  .room-index {
    position: absolute;
    top: var(--space-1);
    left: var(--space-1);
    display: grid;
    place-items: center;
    min-width: var(--space-6);
    height: var(--space-6);
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-surface-0) 82%, transparent);
    color: var(--color-text-primary);
    font-size: var(--text-xs);
    font-weight: var(--font-weight-semibold);
  }

  .room-text { display: flex; flex-direction: column; gap: var(--space-1); flex: 1; min-width: 0; }
  .room-name {
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--tracking-snug);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .room-name-input {
    width: min(100%, calc(var(--space-8) * 5));
    min-height: var(--touch-min);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-accent-warm);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
  }
  .room-count {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .room-actions { display: flex; align-items: center; gap: var(--space-2); flex: none; }
  .room-primary, .room-secondary, .room-danger, .room-add {
    min-height: var(--touch-min);
    padding: 0 var(--space-5);
    border: 0;
    border-radius: var(--radius-lg);
    font: inherit;
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
  }
  .room-primary { background: var(--color-accent-warm); color: var(--color-text-on-accent); }
  .room-secondary {
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }
  .room-danger { background: var(--color-error); color: var(--color-text-on-accent); }
  .room-primary:disabled, .room-secondary:disabled, .room-add:disabled { opacity: 0.4; cursor: default; }

  .room-handle, .room-more {
    display: grid;
    place-items: center;
    width: var(--touch-min);
    min-height: var(--touch-min);
    padding: 0;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
  }
  .room-handle { cursor: grab; touch-action: none; }
  .room-row.is-dragging .room-handle { cursor: grabbing; color: var(--color-accent-warm); }
  .room-handle:hover, .room-more:hover { background: var(--color-surface-2); color: var(--color-text-primary); }
  .room-handle:disabled { opacity: 0.3; cursor: default; }

  .room-menu-anchor { position: relative; }
  .room-menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    min-width: calc(var(--space-8) * 2.5);
    padding: var(--space-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    box-shadow: var(--elevation-overlay-shadow);
  }
  .room-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-min);
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .room-menu-item:hover:not(:disabled) { background: var(--color-surface-2); }
  .room-menu-item:disabled { opacity: 0.4; cursor: default; }
  .room-menu-item.is-danger { color: var(--color-error); }

  .room-delete {
    display: grid;
    gap: var(--space-3);
    margin: 0 var(--space-4) var(--space-4);
    padding: var(--space-4);
    border: 1px solid color-mix(in srgb, var(--color-error) 35%, var(--color-border));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-error) 7%, var(--color-surface-1));
  }
  .room-delete p { margin: 0; color: var(--color-text-secondary); line-height: var(--leading-normal); }
  .room-delete label { display: grid; gap: var(--space-2); font-weight: var(--font-weight-semibold); }
  .room-delete select {
    min-height: var(--touch-min);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    font: inherit;
  }
  .room-delete-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }

  .room-add {
    border-top: 1px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    color: var(--color-accent-warm);
  }
  .room-add:hover:not(:disabled) { background: color-mix(in srgb, var(--color-accent-warm) 8%, transparent); }

  @media (max-width: 900px) {
    .room-main { flex-wrap: wrap; }
    .room-actions { width: 100%; justify-content: flex-end; }
    .room-primary, .room-secondary { flex: 1; padding: 0 var(--space-3); }
  }
</style>
