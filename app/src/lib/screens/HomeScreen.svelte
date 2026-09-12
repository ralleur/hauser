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
  import { swipeleft } from '../actions/swipeleft.ts';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { prefersReducedMotion } from '../motion/index.ts';
  import { ambientState } from '../state/ambient.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { layoutHomeView, layoutRoomsPerRow, widthPreset, type LayoutSlotId } from '../state/layout-config.ts';
  import { cameraPopouts } from '../state/camera-popouts.svelte.ts';
  import { deviceDetail, roomEdit } from '../state/overlay.svelte.ts';
  import { currentMoment, initMoments } from '../state/moments.svelte.ts';
  import type { Component } from 'svelte';

  import { m } from '../../paraglide/messages.js';
  if (!appState.currentRoom) appState.currentRoom = appState.rooms[0]?.id ?? null;
  layoutManager.reconcileRooms(appState.rooms.map((room) => room.id));

  const preset = $derived(widthPreset(layoutManager.preview));
  const roomsPerRow = $derived(layoutRoomsPerRow(layoutManager.preview));
  /* R30: „Alle Räume" tauscht Bild und Raumauswahl gegen ein Kachelraster;
     die Kontrollfläche gehört dann ganz den Szenen und Geräten. Das Raster
     kommt erst, wenn die Ansicht gewählt ist — im Vollbild bleibt der
     Startpfad unverändert. */
  const roomsView = $derived(layoutHomeView(layoutManager.preview) === 'rooms');
  const activeRoomIds = $derived(layoutManager.preview.slots.map((slot) => slotRoom(slot.roomId)?.id ?? ''));
  let HomeRoomGrid = $state<Component<{
    rooms: typeof appState.rooms;
    activeIds: readonly string[];
    roomsPerRow: number;
    onselect: (roomId: string) => void;
  }> | null>(null);
  $effect(() => {
    if (!roomsView || HomeRoomGrid) return;
    void import('../components/HomeRoomGrid.svelte')
      .then((module) => { HomeRoomGrid = module.default; })
      .catch(() => { /* ohne Kacheln weiter */ });
  });
  /* Wisch nach links auf der Kontrollfläche lässt sie aus dem Bild fliegen —
     die Bühne gehört dann ganz dem Bild bzw. den Kacheln. Im Vollbild holt
     die nächste Berührung irgendwo sie zurück; der Tipp selbst wirkt weiter.
     In „Alle Räume" startet sie ausgeblendet — beim Wechsel in die Ansicht
     und nach dem Standby — und kommt erst, wenn eine Kachel angetippt wird
     (Owner-Wunsch 2026-09-12). */
  let panelsHidden = $state(false);
  $effect(() => {
    panelsHidden = roomsView && !ambientState.active;
  });
  $effect(() => {
    if (!panelsHidden || roomsView) return;
    const show = () => { panelsHidden = false; };
    window.addEventListener('pointerdown', show, { capture: true });
    return () => window.removeEventListener('pointerdown', show, { capture: true });
  });

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
    if (!roomsView) preloadNeighbours(roomId);
  }

  /* Kachel angetippt: der Raum kommt in die erste Kontrollfläche. Zeigt die
     schon diesen Raum und es gibt eine zweite, wandert er dorthin — so lassen
     sich beide Flächen ohne Raumauswahl belegen. */
  function selectRoomFromTile(roomId: string) {
    const slots = layoutManager.applied.slots;
    const first = slots[0];
    const second = slots[1];
    const target = second && slotRoom(first.roomId)?.id === roomId ? second.id : first.id;
    selectRoom(target, roomId);
    panelsHidden = false;
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

<!-- Wisch von rechts nach links irgendwo auf der Bühne öffnet das Layout-Menü
     (Owner-Wunsch 2026-09-11); die Kontrollfläche behält ihre eigene Geste. -->
<div class="home-stage" class:has-two-slots={layoutManager.preview.slots.length === 2}
     class:is-rooms-view={roomsView} style={layoutStyle}
     use:swipeleft={{ onSwipe: whenEditable(() => layoutManager.show()), move: false, ignore: '.home-panels', threshold: 120, angle: 60, enabled: !layoutManager.open }}>
  {#if !roomsView}
    <RoomHero />
  {/if}

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

  <div class="home-panels" class:is-hidden={panelsHidden} aria-label={m.home_control_surfaces()}
       use:swipeleft={{ onSwipe: () => { panelsHidden = true; }, angle: 55, enabled: !panelsHidden }}>
    {#each layoutManager.preview.slots as slot, index (slot.id)}
      {@const selected = slotRoom(slot.roomId)}
      <aside class="home-panel on-image" aria-label={m.home_control_surface({ number: index + 1 })}>
        {#if roomsView}
          {#if selected}
            <header class="panel-head">
              <h2 class="panel-title">{selected.name}</h2>
            </header>
          {/if}
        {:else}
          <PanelRoomSelector
            rooms={appState.rooms}
            selectedId={selected?.id ?? null}
            {roomsPerRow}
            onselect={(roomId) => selectRoom(slot.id, roomId)}
          />
        {/if}

        <!-- Raumwechsel als Überblendung: alter und neuer Block liegen kurz
             übereinander (Grid-Zelle, CSS), der alte löst sich auf, der neue
             kommt weich herein — kein Sprung von einem Frame auf den nächsten. -->
        <div class="panel-controls">
          {#if selected}
            {#key selected.id}
              <div class="panel-controls-page"
                   in:fade={{ duration: prefersReducedMotion() ? 0 : 220, easing: cubicOut }}
                   out:fade={{ duration: prefersReducedMotion() ? 0 : 140, easing: cubicOut }}>
                <RoomControls room={selected} compactClimate />
              </div>
            {/key}
          {/if}
        </div>
      </aside>
    {/each}
  </div>

  {#if roomsView && HomeRoomGrid}
    <HomeRoomGrid rooms={appState.rooms} activeIds={activeRoomIds} {roomsPerRow} onselect={selectRoomFromTile} />
  {/if}

  {#if MomentCelebration && momentVisible}
    <MomentCelebration />
  {/if}

  <!-- Die Onboarding-Karte wirbt für ein eigenes Bühnenbild — ohne Bühne
       (Alle Räume) hat sie nichts, worauf sie zeigen könnte. -->
  {#if !roomsView}
    <RoomImageOnboarding />
  {/if}
</div>
