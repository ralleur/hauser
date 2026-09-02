<script lang="ts">
  import RoomHero from '../components/RoomHero.svelte';
  import RoomControls from '../components/RoomControls.svelte';
  import { whenEditable } from '../state/edit-mode.svelte.ts';
  import PanelRoomSelector from '../components/PanelRoomSelector.svelte';
  import RoomImageOnboarding from '../components/RoomImageOnboarding.svelte';
  import CameraPopout from '../components/CameraPopout.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { layoutRoomsPerRow, widthPreset, type LayoutSlotId } from '../state/layout-config.ts';
  import { cameraPopouts } from '../state/camera-popouts.svelte.ts';

  import { m } from '../../paraglide/messages.js';
  if (!appState.currentRoom) appState.currentRoom = appState.rooms[0]?.id ?? null;
  layoutManager.reconcileRooms(appState.rooms.map((room) => room.id));

  const preset = $derived(widthPreset(layoutManager.preview));
  const roomsPerRow = $derived(layoutRoomsPerRow(layoutManager.preview));
  const layoutStyle = $derived(
    `--layout-total:${preset.totalPercent}%;--slot-min:${preset.slotMinPx}px;--hero-min:${preset.heroMinPx}px;--slot-count:${layoutManager.preview.slots.length}`,
  );

  function slotRoom(roomId: string | null) {
    return appState.rooms.find((room) => room.id === roomId) ?? appState.rooms[0];
  }

  function selectRoom(slotId: LayoutSlotId, roomId: string) {
    layoutManager.setAppliedRoom(slotId, roomId);
    appState.currentRoom = roomId;
  }
</script>

<div class="home-stage" class:has-two-slots={layoutManager.preview.slots.length === 2} style={layoutStyle}>
  <RoomHero />

  <!-- Eigene freie Trefferfläche: sie liegt ausschließlich rechts neben den
       Kontrollflächen. Controls und Raumkacheln sind keine Nachfahren und können
       den Layout-Long-Press deshalb nicht versehentlich auslösen. -->
  <div class="hero-config-hitarea" aria-label={m.home_free_hero_area()}
       use:longpress={{ onLongPress: whenEditable(() => layoutManager.show()) }}></div>

  <div class="camera-popout-layer">
    {#each cameraPopouts.items as item (item.entityId)}
      {#if item.mode === 'always' || item.roomId === appState.currentRoom}
        <CameraPopout {item} />
      {/if}
    {/each}
  </div>

  <div class="home-panels" aria-label={m.home_control_surfaces()}>
    {#each layoutManager.preview.slots as slot, index (slot.id)}
      {@const selected = slotRoom(slot.roomId)}
      <aside class="home-panel" aria-label={m.home_control_surface({ number: index + 1 })}>
        <PanelRoomSelector
          rooms={appState.rooms}
          selectedId={selected?.id ?? null}
          {roomsPerRow}
          onselect={(roomId) => selectRoom(slot.id, roomId)}
        />

        <div class="panel-controls">
          {#if selected}
            {#key selected.id}<RoomControls room={selected} />{/key}
          {/if}
        </div>
      </aside>
    {/each}
  </div>

  <RoomImageOnboarding />
</div>
