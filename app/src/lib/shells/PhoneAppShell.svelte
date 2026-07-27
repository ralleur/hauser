<script module lang="ts">
  export const shellKind = 'hmi-shell:phone' as const;
</script>

<script lang="ts">
  import '../../styles/app.css';
  import '../../styles/phone-shell.css';
  import '../../styles/demo.css';
  import { onMount, tick } from 'svelte';
  import type { TransitionConfig } from 'svelte/transition';
  import PhoneBottomNav from '../components/phone/PhoneBottomNav.svelte';
  import PhoneHomeFeed from '../components/phone/PhoneHomeFeed.svelte';
  import MoreSheet from '../components/phone/MoreSheet.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { mergedClimate, mergedLight, roomTemperature } from '../state/commands.ts';
  import { connection } from '../state/connection.svelte.ts';
  import {
    projectPhoneRooms,
    reconcilePhoneRoomLayer,
    validPhoneRoom,
    type PhoneRoomLayer,
    type PhoneRoomSummary,
  } from '../state/phone-home.ts';
  import { endTransition, nav, projectPhoneTarget, showScreen } from '../state/nav.svelte.ts';
  import { navTargetForScreen, phoneNavOrder, type PhoneNavTarget } from '../state/phone-nav-order.svelte.ts';
  import { closeDeviceDetail, deviceDetail, roomEdit } from '../state/overlay.svelte.ts';
  import { closeSceneEdit, sceneEdit } from '../state/scene-manager.svelte.ts';
  import {
    createPhoneModalLifecycle,
    createPhoneLayerController,
    rememberMediaTarget,
    restorePhoneFocus,
    type LayerChangeReason,
    type MediaRootTarget,
    type PhoneLayerController,
  } from '../state/phone-navigation.svelte.ts';
  import { shellLifecycle } from '../state/shell-lifecycle-instance.ts';

  import { m } from '../../paraglide/messages.js';
  const conn = $derived(connection());
  const target = $derived(projectPhoneTarget(nav.screen));
  const activeTarget = $derived(navTargetForScreen(nav.screen));
  const activeMain = $derived(phoneNavOrder.order.slice(0, 3).includes(activeTarget) ? activeTarget : 'more');
  const targetName = $derived(
    target.area === 'media'
      ? `Medien · ${target.subtarget === 'audio' ? 'Raum-Audio' : 'Bibliothek'}`
      : target.area === 'more'
        ? `Mehr · ${{ energy: 'Energie', shopping: 'Einkaufsliste', reminders: 'Erinnerungen', songs: 'Songs', ablage: 'Ablage', system: 'System' }[target.subtarget]}`
        : target.area === 'calendar' ? 'Kalender' : 'Home',
  );
  const roomSummaries = $derived(projectPhoneRooms(appState.rooms, {
    temperature: roomTemperature,
    light: mergedLight,
    climate: mergedClimate,
  }));
  const selectedRoom = $derived(validPhoneRoom(appState.rooms, appState.currentRoom));

  function phoneScreenTransition(_node: Element): TransitionConfig {
    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      duration: reduced ? 0 : 180,
      css: (t) => `opacity:${t};transform:translate3d(0,${(1 - t) * 4}px,0)`,
    };
  }

  let activeLayer = $state<PhoneRoomLayer | null>(null);
  let requestedLayer: PhoneRoomLayer = 'more';
  const moreOpen = $derived(activeLayer === 'more');
  const roomOpen = $derived(activeLayer === 'room');
  let modalBlocking = $state(false);
  let outroGeneration = $state(0);
  let lastMediaTarget = $state<MediaRootTarget>('media');
  let moreButton = $state<HTMLButtonElement>();
  let titleAnchor = $state<HTMLHeadingElement>();
  let focusTrigger: HTMLButtonElement | null = null;
  let layer = $state<PhoneLayerController | null>(null);
  let initialRoomReconciled = $state(false);
  let restoreFocusAfterOutro = false;
  let restoreFocusToTitle = false;
  let modalReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  const modalLifecycle = createPhoneModalLifecycle(() => {
    modalBlocking = false;
    if (!restoreFocusAfterOutro) return;
    restoreFocusAfterOutro = false;
    const trigger = restoreFocusToTitle ? null : focusTrigger ?? moreButton ?? null;
    restoreFocusToTitle = false;
    void tick().then(() => restorePhoneFocus(trigger, titleAnchor ?? null));
  });

  $effect(() => {
    lastMediaTarget = rememberMediaTarget(lastMediaTarget, nav.screen);
  });

  $effect(() => {
    const controller = layer;
    if (!controller) return;
    const action = reconcilePhoneRoomLayer(
      appState.rooms,
      appState.currentRoom,
      activeLayer,
      controller.isOpen(),
      initialRoomReconciled,
    );
    if (!initialRoomReconciled) initialRoomReconciled = true;
    if (action === 'open-current') {
      focusTrigger = null;
      openLayer('room');
    } else if (action === 'clear-stale') {
      appState.currentRoom = null;
    } else if (action === 'close-missing') {
      focusTrigger = null;
      controller.close('navigation');
    }
  });

  function handleLayerChange(open: boolean, reason: LayerChangeReason) {
    if (open) {
      clearTimeout(modalReleaseTimer);
      activeLayer = requestedLayer;
      modalLifecycle.open();
      modalBlocking = true;
      restoreFocusAfterOutro = false;
      restoreFocusToTitle = false;
      return;
    }
    const closingLayer = activeLayer;
    activeLayer = null;
    if (closingLayer === 'room') {
      // Schließt das Sheet (z. B. per Back-Geste), räumen auch die darüber
      // gestapelten Tablet-Overlays sofort mit auf.
      closeDeviceDetail(true);
      closeSceneEdit(true);
    }
    if (closingLayer === 'room' && focusTrigger === null) restoreFocusToTitle = true;
    if (closingLayer === 'room' && reason !== 'unmount') appState.currentRoom = null;
    const closingGeneration = modalLifecycle.beginClose();
    if (closingGeneration !== null) {
      outroGeneration = closingGeneration;
      // Lazy #await-Sheets liefern auf einzelnen Browsern kein verlässliches
      // Component-Outro-Event. Nach der maximalen Overlay-Dauer muss die
      // Inert-Sperre deshalb fail-safe fallen (Token --duration-slow = 240 ms).
      clearTimeout(modalReleaseTimer);
      modalReleaseTimer = setTimeout(() => handleOuterOutroEnd(), 240);
    }
    if (reason === 'unmount') {
      restoreFocusAfterOutro = false;
      modalLifecycle.destroy();
      modalBlocking = false;
      return;
    }
    restoreFocusAfterOutro = true;
  }

  function handleOuterOutroEnd() {
    clearTimeout(modalReleaseTimer);
    modalLifecycle.finishOutro(outroGeneration);
  }

  function closeLayer(reason: 'escape' | 'scrim' | 'close' | 'toggle' | 'selection' | 'navigation') {
    layer?.close(reason);
  }

  function openLayer(kind: PhoneRoomLayer) {
    requestedLayer = kind;
    if (layer?.isOpen()) {
      if (activeLayer === kind) return;
      layer.close('navigation');
    }
    layer?.open();
  }

  function openRoom(summary: PhoneRoomSummary, trigger: HTMLButtonElement) {
    const room = validPhoneRoom(appState.rooms, summary.id);
    if (!room) return;
    appState.currentRoom = room.id;
    focusTrigger = trigger;
    openLayer('room');
  }

  function selectMain(target: PhoneNavTarget | 'more', trigger: HTMLButtonElement) {
    if (target === 'more') {
      focusTrigger = trigger;
      if (moreOpen) closeLayer('toggle');
      else openLayer('more');
      return;
    }
    if (activeLayer) closeLayer('navigation');
    showScreen(target === 'media' ? lastMediaTarget : target);
  }

  function selectMore(target: PhoneNavTarget) {
    closeLayer('selection');
    showScreen(target === 'media' ? lastMediaTarget : target);
  }

  onMount(() => {
    const browser = {
      get state() { return history.state; },
      pushState: (data: unknown, unused?: string, url?: string | URL | null) => history.pushState(data, unused ?? '', url),
      back: () => history.back(),
      addEventListener: (_type: 'popstate', listener: (event: PopStateEvent) => void) => window.addEventListener('popstate', listener),
      removeEventListener: (_type: 'popstate', listener: (event: PopStateEvent) => void) => window.removeEventListener('popstate', listener),
    };
    layer = createPhoneLayerController(browser, handleLayerChange);
    const unregister = shellLifecycle.register(() => layer?.destroy());
    return () => {
      unregister();
      clearTimeout(modalReleaseTimer);
      layer?.destroy();
      layer = null;
    };
  });
</script>

<div class="phone-shell" data-shell="phone" class:is-disconnected={conn.disconnected} class:has-connection-banner={conn.banner !== null}>
  <div class="phone-conn-banner" class:is-visible={conn.banner !== null} role="status" aria-live="polite">
    <span class="dot {conn.dot}"></span>{conn.banner ?? ''}
  </div>
  <div class="phone-content-frame">
    {#key nav.screen}
      <div class="phone-screen-transition" transition:phoneScreenTransition onoutroend={endTransition}>
        {#if target.area === 'home'}
          <PhoneHomeFeed rooms={roomSummaries} currentRoom={roomOpen ? appState.currentRoom : null} online={conn.online} onopen={openRoom} bind:titleAnchor />
        {:else if target.area === 'calendar'}
          {#await import('../components/phone/PhoneCalendar.svelte') then loaded}
            {@const PhoneCalendar = loaded.default}
            <PhoneCalendar bind:titleAnchor />
          {/await}
        {:else if target.area === 'media'}
          <div class="phone-media-area">
            {#if nav.screen !== 'library-detail'}
              <nav class="phone-media-switcher" aria-label="Medienbereich">
                <button class="pressable" class:is-active={target.subtarget === 'audio'} type="button" aria-current={target.subtarget === 'audio' ? 'page' : undefined} onclick={() => showScreen('media')}>Audio</button>
                <button class="pressable" class:is-active={target.subtarget === 'library'} type="button" aria-current={target.subtarget === 'library' ? 'page' : undefined} onclick={() => showScreen('library')}>Bibliothek</button>
              </nav>
            {/if}
            {#if target.subtarget === 'audio'}
              {#await import('../screens/MediaScreen.svelte') then loaded}
                {@const MediaScreen = loaded.default}
                <MediaScreen phone bind:titleAnchor />
              {/await}
            {:else if nav.screen === 'library-detail'}
              {#await import('../screens/LibraryDetailScreen.svelte') then loaded}
                {@const LibraryDetailScreen = loaded.default}
                <LibraryDetailScreen phone bind:titleAnchor />
              {/await}
            {:else}
              {#await import('../screens/LibraryScreen.svelte') then loaded}
                {@const LibraryScreen = loaded.default}
                <LibraryScreen phone bind:titleAnchor />
              {/await}
            {/if}
          </div>
        {:else if target.area === 'more' && target.subtarget === 'energy'}
          {#await import('../components/phone/PhoneEnergy.svelte') then loaded}
            {@const PhoneEnergy = loaded.default}
            <PhoneEnergy bind:titleAnchor />
          {/await}
        {:else if target.area === 'more' && target.subtarget === 'shopping'}
          {#await import('../components/phone/PhoneShopping.svelte') then loaded}
            {@const PhoneShopping = loaded.default}
            <PhoneShopping bind:titleAnchor />
          {/await}
        {:else if target.area === 'more' && target.subtarget === 'reminders'}
          {#await import('../components/phone/PhoneReminders.svelte') then loaded}
            {@const PhoneReminders = loaded.default}
            <PhoneReminders bind:titleAnchor />
          {/await}
        {:else if target.area === 'more' && target.subtarget === 'songs'}
          {#await import('../screens/SongsScreen.svelte') then loaded}
            {@const SongsScreen = loaded.default}
            <SongsScreen phone bind:titleAnchor />
          {/await}
        {:else if target.area === 'more' && target.subtarget === 'ablage'}
          {#await import('../components/AblageScreen.svelte') then loaded}
            {@const AblageScreen = loaded.default}
            <AblageScreen phone bind:titleAnchor />
          {/await}
        {:else if target.area === 'more' && target.subtarget === 'system'}
          {#await import('../screens/SystemScreen.svelte') then loaded}
            {@const SystemScreen = loaded.default}
            <SystemScreen phone bind:titleAnchor />
          {/await}
        {:else}
          <main class="phone-skeleton" aria-labelledby="phone-target-title">
            <section>
              <p class="phone-skeleton-label">Phone</p>
              <h1 bind:this={titleAnchor} id="phone-target-title" tabindex="-1">{targetName}</h1>
              <p>{m.phone_view_preparing()}</p>
            </section>
          </main>
        {/if}
      </div>
    {/key}
  </div>
  <div class="phone-navigation-frame">
    <PhoneBottomNav active={activeMain} {moreOpen} onselect={selectMain} bind:moreButton />
  </div>
  {#if moreOpen}
    <MoreSheet current={nav.screen} onclose={closeLayer} onselect={selectMore} onouteroutroend={handleOuterOutroEnd} />
  {/if}
  {#if roomOpen && selectedRoom}
    {#await import('../components/phone/RoomControlSheet.svelte') then loaded}
      {@const RoomControlSheet = loaded.default}
      <RoomControlSheet room={selectedRoom} onclose={closeLayer} onouteroutroend={handleOuterOutroEnd} />
    {/await}
  {/if}
  {#if deviceDetail.mode !== 'hidden'}
    {#await import('../components/DeviceDetail.svelte') then loaded}
      {@const DeviceDetail = loaded.default}
      <DeviceDetail />
    {/await}
  {/if}
  {#if sceneEdit.mode !== 'hidden'}
    {#await import('../components/SceneEdit.svelte') then loaded}
      {@const SceneEdit = loaded.default}
      <SceneEdit />
    {/await}
  {/if}
  {#if roomEdit.mode !== 'hidden'}
    {#await import('../components/RoomEdit.svelte') then loaded}
      {@const RoomEdit = loaded.default}
      <RoomEdit />
    {/await}
  {/if}
</div>
