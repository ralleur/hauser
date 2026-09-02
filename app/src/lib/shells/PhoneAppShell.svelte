<script module lang="ts">
  export const shellKind = 'hmi-shell:phone' as const;
</script>

<script lang="ts">
  import '../../styles/phone-shell.css';
  import '../../styles/demo.css';
  import { onMount, tick, type Component } from 'svelte';
  import { cubicInOut, cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import PhoneBottomNav from '../components/phone/PhoneBottomNav.svelte';
  import PhoneHomeFeed from '../components/phone/PhoneHomeFeed.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { mergedClimate, mergedLight, roomTemperature, roomWindowOpen } from '../state/commands.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { applyPwaUpdate, pwaUpdatePrompt } from '../state/pwa-update-prompt.svelte.ts';
  import {
    projectPhoneRooms,
    reconcilePhoneRoomLayer,
    validPhoneRoom,
    type PhoneRoomLayer,
    type PhoneRoomSummary,
  } from '../state/phone-home.ts';
  import { endTransition, nav, projectPhoneTarget, showScreen, SCREENS } from '../state/nav.svelte.ts';
  import { navTargetForScreen, phoneNavOrder, type PhoneNavTarget } from '../state/phone-nav-order.svelte.ts';
  import { closeRoomEdit, roomEdit } from '../state/overlay.svelte.ts';
  import { centralClimateEdit, closeCentralClimateEdit } from '../state/central-climate-overlay.svelte.ts';
  import {
    createPhoneModalLifecycle,
    createPhoneLayerController,
    initialMediaTarget,
    rememberMediaTarget,
    restorePhoneFocus,
    type LayerChangeReason,
    type MediaRootTarget,
    type PhoneLayerController,
  } from '../state/phone-navigation.svelte.ts';
  import { createLatestPhoneLoader, createPhoneLayerLoader, createPhoneSystemLoader } from '../state/phone-lazy-loader.ts';
  import { shellLifecycle } from '../state/shell-lifecycle-instance.ts';

  import { m } from '../../paraglide/messages.js';
  const conn = $derived(connection());
  const target = $derived(projectPhoneTarget(nav.screen));
  const systemActive = $derived(target.area === 'more' && target.subtarget === 'system');
  const activeTarget = $derived(navTargetForScreen(nav.screen));
  const activeMain = $derived(phoneNavOrder.order.slice(0, 3).includes(activeTarget) ? activeTarget : 'more');
  const targetName = $derived(
    target.area === 'media'
      ? `Medien · ${target.subtarget === 'audio' ? 'Raum-Audio' : 'Bibliothek'}`
      : target.area === 'more'
        ? `Mehr · ${{ energy: 'Energie', shopping: 'Einkaufsliste', reminders: 'Erinnerungen', ablage: 'Ablage', system: 'System' }[target.subtarget]}`
        : target.area === 'calendar' ? 'Kalender' : 'Home',
  );
  const roomSummaries = $derived(projectPhoneRooms(appState.rooms, {
    temperature: roomTemperature,
    light: mergedLight,
    climate: mergedClimate,
    windowOpen: roomWindowOpen,
  }));
  const selectedRoom = $derived(validPhoneRoom(appState.rooms, appState.currentRoom));
  type PhoneFeatureId = 'calendar' | 'media' | 'library-detail' | 'library' | 'energy'
    | 'shopping' | 'reminders' | 'ablage' | 'room' | 'room-edit' | 'central-climate';
  type PhoneScreenFeatureId = Exclude<PhoneFeatureId, 'room' | 'room-edit' | 'central-climate'>;
  type PhoneFeatureModule = { default: Component<any> };
  const PHONE_SCREEN_LOADERS: Record<PhoneScreenFeatureId, () => Promise<PhoneFeatureModule>> = {
    calendar: () => import('../components/phone/PhoneCalendar.svelte'),
    media: () => import('../screens/MediaScreen.svelte'),
    'library-detail': () => import('../screens/LibraryDetailScreen.svelte'),
    library: () => import('../screens/LibraryScreen.svelte'),
    energy: () => import('../components/phone/PhoneEnergy.svelte'),
    shopping: () => import('../components/phone/PhoneShopping.svelte'),
    reminders: () => import('../components/phone/PhoneReminders.svelte'),
    ablage: () => import('../components/AblageScreen.svelte'),
  };
  const phoneScreenLoader = createLatestPhoneLoader(PHONE_SCREEN_LOADERS);
  const phoneFeatureLoader = createLatestPhoneLoader<'room' | 'room-edit' | 'central-climate', PhoneFeatureModule>({
    room: () => import('../components/phone/RoomControlSheet.svelte'),
    'room-edit': () => import('../components/RoomEdit.svelte'),
    'central-climate': () => import('../components/CentralClimateEdit.svelte'),
  });
  const featureStyleLoader = createLatestPhoneLoader({
    styles: () => import('../../styles/app.css'),
  });
  const phoneLayerLoader = createPhoneLayerLoader();
  const phoneSystemLoader = createPhoneSystemLoader();
  let MoreSheetComponent = $state<Component<any> | null>(null);
  let SystemScreenComponent = $state<Component<any> | null>(null);
  let moreLoadFailed = $state(false);
  let systemLoadFailed = $state(false);
  let systemLoading = $state(false);
  let featureStylesReady = $state(false);
  let featureStylesFailed = $state(false);
  let phoneFeatureRetries = $state({} as Partial<Record<PhoneFeatureId, number>>);
  let PhoneScreenComponent = $state<Component<any> | null>(null);
  let phoneScreenFailed = $state(false);
  let SceneEditComponent = $state<Component<any> | null>(null);
  const activePhoneScreenId = $derived.by<PhoneScreenFeatureId | null>(() => {
    if (target.area === 'calendar') return 'calendar';
    if (target.area === 'media') {
      if (target.subtarget === 'audio') return 'media';
      return nav.screen === 'library-detail' ? 'library-detail' : 'library';
    }
    if (target.area !== 'more' || target.subtarget === 'system') return null;
    return target.subtarget;
  });

  function ensureFeatureStyles(): void {
    if (featureStylesReady || featureStylesFailed) return;
    void featureStyleLoader.load('styles', () => {
      featureStylesReady = true;
    }).catch(() => {
      featureStylesFailed = true;
    });
  }

  function retryFeatureStyles(): void {
    featureStylesFailed = false;
    ensureFeatureStyles();
  }

  function loadPhoneFeature(
    id: 'room' | 'room-edit' | 'central-climate',
    _retryVersion: number,
  ): Promise<PhoneFeatureModule> {
    return phoneFeatureLoader.loadValue(id);
  }

  function retryPhoneFeature(id: PhoneFeatureId): void {
    phoneFeatureRetries[id] = (phoneFeatureRetries[id] ?? 0) + 1;
  }

  function requestPhoneScreen(id: PhoneScreenFeatureId): void {
    phoneScreenFailed = false;
    void phoneScreenLoader.load(id, (loaded) => {
      PhoneScreenComponent = loaded.default;
    }).catch(() => {
      if (activePhoneScreenId === id) phoneScreenFailed = true;
    });
  }

  function retryPhoneScreen(): void {
    if (activePhoneScreenId) requestPhoneScreen(activePhoneScreenId);
  }

  function retryMoreResources(): void {
    if (featureStylesFailed) retryFeatureStyles();
    if (moreLoadFailed) ensureMoreSheet();
  }

  function tokenValue(node: Element, token: string): string {
    return getComputedStyle(node).getPropertyValue(token).trim();
  }

  function tokenDuration(node: Element, token: string): number {
    const value = tokenValue(node, token);
    if (value.endsWith('ms')) return Number.parseFloat(value) || 0;
    if (value.endsWith('s')) return (Number.parseFloat(value) || 0) * 1000;
    return 0;
  }

  let phoneScreenDirection = $state<1 | -1>(1);

  function phoneScreenEnter(node: Element): TransitionConfig {
    const direction = phoneScreenDirection;
    const shift = Number.parseFloat(tokenValue(node, '--space-6')) || 0;
    return {
      duration: tokenDuration(node, '--duration-slow'),
      easing: cubicInOut,
      css: (t, u) => `opacity:${t};transform:translate3d(${direction * u * shift}px,0,0)`,
    };
  }

  function phoneScreenExit(node: Element): TransitionConfig {
    const direction = phoneScreenDirection;
    const shift = Number.parseFloat(tokenValue(node, '--space-6')) || 0;
    return {
      duration: tokenDuration(node, '--duration-slow'),
      easing: cubicInOut,
      css: (t, u) => `opacity:${t};transform:translate3d(${-direction * u * shift}px,0,0)`,
    };
  }

  function phoneContentTransition(node: Element): TransitionConfig {
    return {
      duration: tokenDuration(node, '--duration-normal'),
      easing: cubicOut,
      css: (t) => `opacity:${t}`,
    };
  }

  let activeLayer = $state<PhoneRoomLayer | null>(null);
  let requestedLayer: PhoneRoomLayer = 'more';
  const moreOpen = $derived(activeLayer === 'more');
  const roomOpen = $derived(activeLayer === 'room');
  let modalBlocking = $state(false);
  let outroGeneration = $state(0);
  const hasMediaScreen = SCREENS.some(({ id }) => id === 'media');
  const hasLibraryScreen = SCREENS.some(({ id }) => id === 'library');
  let lastMediaTarget = $state<MediaRootTarget>(initialMediaTarget(SCREENS));
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

  function ensureMoreSheet(): void {
    moreLoadFailed = false;
    void phoneLayerLoader.load('more', (loaded) => {
      MoreSheetComponent = loaded.default;
    }).catch(() => {
      if (moreOpen) moreLoadFailed = true;
    });
  }

  function ensureSystemScreen(): void {
    if (SystemScreenComponent || systemLoading) return;
    systemLoadFailed = false;
    systemLoading = true;
    void phoneSystemLoader.load('system', (loaded) => {
      SystemScreenComponent = loaded.default;
    }).catch(() => {
      if (systemActive) systemLoadFailed = true;
    }).finally(() => {
      systemLoading = false;
    });
  }

  $effect(() => {
    if (!systemActive) {
      phoneSystemLoader.cancel();
      systemLoadFailed = false;
      return;
    }
    if (!SystemScreenComponent && !systemLoadFailed && !systemLoading) ensureSystemScreen();
  });

  $effect(() => {
    const id = activePhoneScreenId;
    const stylesReady = featureStylesReady;
    phoneScreenLoader.cancel();
    PhoneScreenComponent = null;
    phoneScreenFailed = false;
    if (id && stylesReady) requestPhoneScreen(id);
  });

  $effect(() => {
    lastMediaTarget = rememberMediaTarget(lastMediaTarget, nav.screen);
  });

  $effect(() => {
    if (target.area !== 'home' || activeLayer !== null
      || roomEdit.mode !== 'hidden' || centralClimateEdit.mode !== 'hidden') {
      ensureFeatureStyles();
    }
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
      if (requestedLayer === 'more' && !MoreSheetComponent) ensureMoreSheet();
      modalLifecycle.open();
      modalBlocking = true;
      restoreFocusAfterOutro = false;
      restoreFocusToTitle = false;
      return;
    }
    const closingLayer = activeLayer;
    activeLayer = null;
    if (closingLayer === 'more') {
      phoneLayerLoader.cancel();
      moreLoadFailed = false;
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
    navigatePhoneScreen(target === 'media' ? lastMediaTarget : target);
  }

  function selectMore(target: PhoneNavTarget) {
    closeLayer('selection');
    navigatePhoneScreen(target === 'media' ? lastMediaTarget : target);
  }

  function phoneScreenRank(screen: typeof nav.screen): number {
    const navTarget = navTargetForScreen(screen);
    const targetIndex = phoneNavOrder.order.indexOf(navTarget);
    const mediaDepth = navTarget === 'media' && screen !== 'media' ? 1 : 0;
    return Math.max(targetIndex, 0) * 2 + mediaDepth;
  }

  function navigatePhoneScreen(screen: typeof nav.screen): void {
    const currentRank = phoneScreenRank(nav.screen);
    const nextRank = phoneScreenRank(screen);
    if (nextRank !== currentRank) phoneScreenDirection = nextRank < currentRank ? -1 : 1;
    showScreen(screen);
  }

  onMount(() => {
    const handleSceneEditOpen = () => {
      if (SceneEditComponent) return;
      void import('../components/SceneEdit.svelte').then((module) => {
        SceneEditComponent = module.default;
      });
    };
    window.addEventListener('hauser:scene-edit-open', handleSceneEditOpen);
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
      window.removeEventListener('hauser:scene-edit-open', handleSceneEditOpen);
      unregister();
      clearTimeout(modalReleaseTimer);
      phoneLayerLoader.cancel();
      phoneSystemLoader.cancel();
      layer?.destroy();
      layer = null;
    };
  });
</script>

{#snippet phoneScreenState()}
  {#if PhoneScreenComponent}
    <div class="phone-screen-content" in:phoneContentTransition>
      <PhoneScreenComponent phone bind:titleAnchor />
    </div>
  {:else}
    <main class="phone-skeleton" aria-labelledby="phone-target-title">
      <section>
        <p class="phone-skeleton-label">Phone</p>
        <h1 bind:this={titleAnchor} id="phone-target-title" tabindex="-1">{targetName}</h1>
        {#if phoneScreenFailed}
          <p role="alert">{m.shell_load_failed()}</p>
          <button class="secondary-btn pressable" type="button" onclick={retryPhoneScreen}>Erneut versuchen</button>
        {:else}
          <p role="status" aria-live="polite">{m.shell_loading()}</p>
        {/if}
      </section>
    </main>
  {/if}
{/snippet}

{#snippet phoneLayerLoading(kind: 'more' | 'room', label: string)}
  <div class={`${kind}-sheet-scrim`} role="presentation">
    <div class={`${kind}-sheet`} role="dialog" aria-modal="true" aria-label={label}>
      <p role="status" aria-live="polite">{m.shell_loading()}</p>
    </div>
  </div>
{/snippet}

{#snippet phoneLayerError(kind: 'more' | 'room', label: string, retry: () => void, close: () => void)}
  <div class={`${kind}-sheet-scrim`} role="presentation">
    <div class={`${kind}-sheet`} role="dialog" aria-modal="true" aria-label={label}>
      <p role="alert">{m.shell_load_failed()}</p>
      <button class="secondary-btn pressable" type="button" onclick={retry}>Erneut versuchen</button>
      <button class="secondary-btn pressable" type="button" onclick={close}>Schließen</button>
    </div>
  </div>
{/snippet}

<div class="phone-shell" data-shell="phone" class:is-disconnected={conn.disconnected} class:has-connection-banner={conn.banner !== null}>
  <div class="phone-conn-banner" class:is-visible={conn.banner !== null} role="status" aria-live="polite">
    <span class="dot {conn.dot}"></span>{conn.banner ?? ''}
  </div>
  <div class="phone-content-frame">
    {#key nav.screen}
      <div class="phone-screen-transition" in:phoneScreenEnter out:phoneScreenExit onoutroend={endTransition}>
        {#if target.area === 'home'}
          <PhoneHomeFeed rooms={roomSummaries} currentRoom={roomOpen ? appState.currentRoom : null} online={conn.online} onopen={openRoom} bind:titleAnchor />
        {:else if featureStylesReady && activePhoneScreenId}
          {#if target.area === 'media'}
            <div class="phone-media-area">
              {#if nav.screen !== 'library-detail'}
                <nav class="phone-media-switcher" aria-label="Medienbereich">
                  {#if hasMediaScreen}<button class="pressable" class:is-active={target.subtarget === 'audio'} type="button" aria-current={target.subtarget === 'audio' ? 'page' : undefined} onclick={() => navigatePhoneScreen('media')}>Audio</button>{/if}
                  {#if hasLibraryScreen}<button class="pressable" class:is-active={target.subtarget === 'library'} type="button" aria-current={target.subtarget === 'library' ? 'page' : undefined} onclick={() => navigatePhoneScreen('library')}>Bibliothek</button>{/if}
                </nav>
              {/if}
              {@render phoneScreenState()}
            </div>
          {:else}
            {@render phoneScreenState()}
          {/if}
        {:else if featureStylesReady && target.area === 'more' && target.subtarget === 'system'}
          {#if SystemScreenComponent}
            <div class="phone-screen-content" in:phoneContentTransition>
              <SystemScreenComponent phone bind:titleAnchor />
            </div>
          {:else}
            <main class="phone-skeleton" aria-labelledby="phone-target-title">
              <section>
                <p class="phone-skeleton-label">Phone</p>
                <h1 bind:this={titleAnchor} id="phone-target-title" tabindex="-1">System</h1>
                {#if systemLoadFailed}
                  <p role="alert">{m.shell_load_failed()}</p>
                  <button class="secondary-btn pressable" type="button" onclick={ensureSystemScreen}>Erneut versuchen</button>
                {:else}
                  <p role="status" aria-live="polite">{m.shell_loading()}</p>
                {/if}
              </section>
            </main>
          {/if}
        {:else}
          <main class="phone-skeleton" aria-labelledby="phone-target-title">
            <section>
              <p class="phone-skeleton-label">Phone</p>
              <h1 bind:this={titleAnchor} id="phone-target-title" tabindex="-1">{targetName}</h1>
              {#if featureStylesFailed}
                <p role="alert">{m.shell_load_failed()}</p>
                <button class="secondary-btn pressable" type="button" onclick={retryFeatureStyles}>Erneut versuchen</button>
              {:else}
                <p role="status" aria-live="polite">{m.phone_view_preparing()}</p>
              {/if}
            </section>
          </main>
        {/if}
      </div>
    {/key}
  </div>
  <div class="phone-navigation-frame">
    <PhoneBottomNav active={activeMain} {moreOpen} onselect={selectMain} bind:moreButton />
  </div>
  <!-- B-27 C: Ein wartender Service Worker wird angeboten, nicht erzwungen.
       Bewusst nicht modal und ohne Scrim: ohne Tap laeuft die alte Fassung
       stoerungsfrei weiter. Auf dem Kiosk erscheint der Hinweis nicht — dort
       aktiviert das Ambient-/Hidden-Gate unveraendert von selbst. -->
  {#if pwaUpdatePrompt.pending}
    <button class="phone-update-hint pressable" type="button" onclick={applyPwaUpdate}>
      <span class="phone-update-hint-text">{m.pwa_update_ready()}</span>
      <span class="phone-update-hint-action">{m.pwa_update_apply()}</span>
    </button>
  {/if}
  {#if moreOpen}
    {#if featureStylesReady && MoreSheetComponent}
      <MoreSheetComponent current={nav.screen} onclose={closeLayer} onselect={selectMore} onouteroutroend={handleOuterOutroEnd} />
    {:else}
      {#if featureStylesFailed || moreLoadFailed}
        {@render phoneLayerError('more', 'Mehr', retryMoreResources, () => closeLayer('close'))}
      {:else}
        {@render phoneLayerLoading('more', 'Mehr')}
      {/if}
    {/if}
  {/if}
  {#if roomOpen && selectedRoom}
    {#if featureStylesReady}
      {#await loadPhoneFeature('room', phoneFeatureRetries.room ?? 0)}
        {@render phoneLayerLoading('room', 'Raumsteuerung')}
      {:then loaded}
        {@const RoomControlSheet = loaded.default}
        <RoomControlSheet room={selectedRoom} onclose={closeLayer} onouteroutroend={handleOuterOutroEnd} />
      {:catch}
        {@render phoneLayerError('room', 'Raumsteuerung', () => retryPhoneFeature('room'), () => closeLayer('close'))}
      {/await}
    {:else}
      {#if featureStylesFailed}
        {@render phoneLayerError('room', 'Raumsteuerung', retryFeatureStyles, () => closeLayer('close'))}
      {:else}
        {@render phoneLayerLoading('room', 'Raumsteuerung')}
      {/if}
    {/if}
  {/if}
  {#if roomEdit.mode !== 'hidden'}
    {#if featureStylesReady}
      {#await loadPhoneFeature('room-edit', phoneFeatureRetries['room-edit'] ?? 0)}
        {@render phoneLayerLoading('room', 'Raum bearbeiten')}
      {:then loaded}
        {@const RoomEdit = loaded.default}
        <RoomEdit />
      {:catch}
        {@render phoneLayerError('room', 'Raum bearbeiten', () => retryPhoneFeature('room-edit'), () => closeRoomEdit(true))}
      {/await}
    {:else}
      {#if featureStylesFailed}
        {@render phoneLayerError('room', 'Raum bearbeiten', retryFeatureStyles, () => closeRoomEdit(true))}
      {:else}
        {@render phoneLayerLoading('room', 'Raum bearbeiten')}
      {/if}
    {/if}
  {/if}
  {#if centralClimateEdit.mode !== 'hidden'}
    {#if featureStylesReady}
      {#await loadPhoneFeature('central-climate', phoneFeatureRetries['central-climate'] ?? 0)}
        {@render phoneLayerLoading('room', 'Zentrale Klimasteuerung')}
      {:then loaded}
        {@const CentralClimateEdit = loaded.default}
        <CentralClimateEdit />
      {:catch}
        {@render phoneLayerError('room', 'Zentrale Klimasteuerung', () => retryPhoneFeature('central-climate'), () => closeCentralClimateEdit(true))}
      {/await}
    {:else}
      {#if featureStylesFailed}
        {@render phoneLayerError('room', 'Zentrale Klimasteuerung', retryFeatureStyles, () => closeCentralClimateEdit(true))}
      {:else}
        {@render phoneLayerLoading('room', 'Zentrale Klimasteuerung')}
      {/if}
    {/if}
  {/if}
  <!-- Nur wenn kein Raum-Sheet offen ist: das bringt den Szenen-Editor selbst mit. -->
  {#if !roomOpen && featureStylesReady && SceneEditComponent}
    <SceneEditComponent />
  {/if}
</div>
