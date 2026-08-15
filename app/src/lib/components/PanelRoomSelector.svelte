<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { longpress } from '../actions/longpress.ts';
  import { openRoomEdit } from '../state/overlay.svelte.ts';
  import { HVAC_MODES, type Room } from '../state/app.svelte.ts';
  import { mergedClimate, mergedLight, roomTemperature } from '../state/commands.ts';
  import {
    clampPanelRoomPage,
    panelRoomPageForSelection,
    panelRoomPages,
  } from '../state/panel-room-pages.ts';
  import { fmtTemp } from '../format.ts';
  import { m } from '../../paraglide/messages.js';

  let {
    rooms,
    selectedId,
    onselect,
  }: {
    rooms: Room[];
    selectedId: string | null;
    onselect: (roomId: string) => void;
  } = $props();

  let viewport = $state<HTMLDivElement>();
  let currentPage = $state(0);
  let lastSelectedId = $state<string | null>(null);
  const pages = $derived(panelRoomPages(rooms));
  const multiPage = $derived(pages.length > 1);

  function scrollToPage(page: number, behavior: ScrollBehavior = 'smooth'): void {
    currentPage = clampPanelRoomPage(page, rooms.length);
    viewport?.scrollTo({ left: currentPage * viewport.clientWidth, behavior });
  }

  function handleScroll(): void {
    if (!viewport?.clientWidth) return;
    currentPage = clampPanelRoomPage(
      Math.round(viewport.scrollLeft / viewport.clientWidth),
      rooms.length,
    );
  }

  $effect(() => {
    const nextSelectedId = selectedId ?? null;
    const selectionChanged = nextSelectedId !== lastSelectedId;
    const nextPage = selectionChanged
      ? panelRoomPageForSelection(rooms, nextSelectedId, currentPage)
      : clampPanelRoomPage(currentPage, rooms.length);
    lastSelectedId = nextSelectedId;
    currentPage = nextPage;
    if (selectionChanged) void tick().then(() => scrollToPage(nextPage, 'auto'));
  });
</script>

<div class="room-selector" class:has-pages={multiPage}>
  <div
    class="room-page-viewport"
    bind:this={viewport}
    onscroll={handleScroll}
    aria-label={m.home_room_pages()}
  >
    {#each pages as pageRooms, pageIndex (pageIndex)}
      <div class="room-page" aria-hidden={multiPage && pageIndex !== currentPage} inert={multiPage && pageIndex !== currentPage}>
        {#each pageRooms as room (room.id)}
          {@const climate = mergedClimate(room.id)}
          {@const temp = roomTemperature(room.id)}
          {@const lightsOn = room.lights.filter((light) => mergedLight(room.id, light.id)?.on).length}
          {@const mode = climate ? HVAC_MODES.find((item) => item.id === climate.hvac) : null}
          <button
            class="room-btn pressable"
            type="button"
            data-room={room.id}
            class:is-active={selectedId === room.id}
            use:longpress={{ onLongPress: () => openRoomEdit(room.id) }}
            onclick={() => onselect(room.id)}
          >
            <div class="room-btn-top">
              <span class="room-btn-name" title={room.name}>{room.name}</span>
              {#if room.presence}<span class="dot dot-presence" title={m.home_present()}></span>{/if}
            </div>
            <div class="room-btn-stats num">
              {#if temp !== null}
                <span class="rb-temp" class:mode-heat={mode?.id === 'heat'} class:mode-cool={mode?.id === 'cool'}>
                  {#if mode}<Icon name={mode.icon} cls="icon icon-sm" />{/if}{fmtTemp(temp)}°
                </span>
              {/if}
              <span class="rb-light" class:is-on={lightsOn > 0}><Icon name="i-bulb" cls="icon icon-sm" /></span>
              {#if room.windowOpen}<Icon name="i-window" cls="icon icon-sm rb-window" />{/if}
            </div>
          </button>
        {/each}
      </div>
    {/each}
  </div>

  {#if multiPage}
    <nav class="room-page-nav" aria-label={m.home_room_pages()}>
      <button
        class="room-page-button pressable"
        type="button"
        aria-label={m.home_room_previous_page()}
        disabled={currentPage === 0}
        onclick={() => scrollToPage(currentPage - 1)}
      >‹</button>
      <span class="room-page-status" aria-live="polite">
        {m.home_room_page({ page: currentPage + 1, total: pages.length })}
      </span>
      <button
        class="room-page-button pressable"
        type="button"
        aria-label={m.home_room_next_page()}
        disabled={currentPage === pages.length - 1}
        onclick={() => scrollToPage(currentPage + 1)}
      >›</button>
    </nav>
  {/if}
</div>
