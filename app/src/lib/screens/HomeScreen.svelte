<script lang="ts">
  import RoomHero from '../components/RoomHero.svelte';
  import RoomControls from '../components/RoomControls.svelte';
  import { whenEditable } from '../state/edit-mode.svelte.ts';
  import PanelRoomSelector from '../components/PanelRoomSelector.svelte';
  import RoomImageOnboarding from '../components/RoomImageOnboarding.svelte';
  import CameraPopout from '../components/CameraPopout.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { resolveRoomHero } from '../components/room-hero-assets.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { layoutRoomsPerRow, widthPreset, type LayoutSlotId } from '../state/layout-config.ts';
  import { cameraPopouts } from '../state/camera-popouts.svelte.ts';
  import { deviceDetail, roomEdit } from '../state/overlay.svelte.ts';
  import { currentMoment, initMoments } from '../state/moments.svelte.ts';
  import type { Component } from 'svelte';

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

  /* Paket 4 sah den Raumwechsel als View Transition vor. Verworfen nach
     Messung: das Hero-Bild kann daran gar nicht teilnehmen, weil sein neues
     Bild erst nach dem Dekodieren eingehängt wird — beide Schnappschüsse zeigen
     also dasselbe. Übrig blieb ein 240-ms-Auflösen der Kontrollfläche, das
     niemand sieht, bezahlt mit einem Vollbild-Schnappschuss pro Raumwechsel.
     Den Crossfade der Bühne macht weiterhin der Doppelpuffer in RoomHero. */
  function selectRoom(slotId: LayoutSlotId, roomId: string) {
    layoutManager.setAppliedRoom(slotId, roomId);
    appState.currentRoom = roomId;
    preloadNeighbours(roomId);
  }

  /* Paket 5 (docs/20): Die Hero-Bilder der Nachbarräume liegen nach dem
     Antippen im Cache — der nächste Wechsel zeigt sie ohne Dekodierpause. */
  function preloadNeighbours(roomId: string): void {
    void import('../components/hero-preload.ts').then(({ neighbourRoomIds, preloadHeroes }) => {
      const ids = neighbourRoomIds(appState.rooms.map((room) => room.id), roomId);
      preloadHeroes(ids.map((id) => resolveRoomHero({
        target: 'panel',
        baseUrl: import.meta.env.BASE_URL,
        roomId: id,
        config: roomHeroConfig(id),
        sun: appState.heroSun,
        fallbackTheme: appState.theme,
      })));
    }).catch(() => { /* ohne Vorladen weiter */ });
  }

  /* Kalendermomente: der Baustein kommt erst, wenn der Server einen Moment
     meldet — an normalen Tagen wird er nie geladen. Während einer Bedienung
     (Gerätedetail, Raum bearbeiten) bleibt er weg. */
  initMoments();
  let MomentCelebration = $state<Component | null>(null);
  const momentVisible = $derived(currentMoment() !== null
    && deviceDetail.mode === 'hidden' && roomEdit.mode === 'hidden');
  $effect(() => {
    if (!momentVisible || MomentCelebration) return;
    void import('../components/MomentCelebration.svelte')
      .then((module) => { MomentCelebration = module.default; })
      .catch(() => { /* ohne Konfetti weiter */ });
  });
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

  {#if MomentCelebration && momentVisible}
    <MomentCelebration />
  {/if}

  <RoomImageOnboarding />
</div>
