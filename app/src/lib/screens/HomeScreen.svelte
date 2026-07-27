<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import RoomHero from '../components/RoomHero.svelte';
  import RoomControls from '../components/RoomControls.svelte';
  import { appState, HVAC_MODES } from '../state/app.svelte.ts';
  import { mergedLight, mergedClimate, roomTemperature } from '../state/commands.ts';
  import { longpress } from '../actions/longpress.ts';
  import { openRoomEdit } from '../state/overlay.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { widthPreset, type LayoutSlotId } from '../state/layout-config.ts';
  import { fmtTemp } from '../format.ts';

  import { m } from '../../paraglide/messages.js';
  if (!appState.currentRoom) appState.currentRoom = appState.rooms[0]?.id ?? null;
  layoutManager.reconcileRooms(appState.rooms.map((room) => room.id));

  const preset = $derived(widthPreset(layoutManager.preview));
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
       use:longpress={{ onLongPress: () => layoutManager.show() }}></div>

  <div class="home-panels" aria-label={m.home_control_surfaces()}>
    {#each layoutManager.preview.slots as slot, index (slot.id)}
      {@const selected = slotRoom(slot.roomId)}
      <aside class="home-panel" aria-label="Kontrollfläche {index + 1}">
        <div class="room-select">
          {#each appState.rooms as room (room.id)}
            {@const climate = mergedClimate(room.id)}
            {@const temp = roomTemperature(room.id)}
            {@const lightsOn = room.lights.filter((light) => mergedLight(room.id, light.id)?.on).length}
            {@const mode = climate ? HVAC_MODES.find((item) => item.id === climate.hvac) : null}
            <button class="room-btn pressable" type="button" data-room={room.id}
                    class:is-active={selected?.id === room.id}
                    use:longpress={{ onLongPress: () => openRoomEdit(room.id) }}
                    onclick={() => selectRoom(slot.id, room.id)}>
              <div class="room-btn-top">
                <span class="room-btn-name">{room.name}</span>
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

        <div class="panel-controls">
          {#if selected}
            {#key selected.id}<RoomControls room={selected} />{/key}
          {/if}
        </div>
      </aside>
    {/each}
  </div>
</div>
