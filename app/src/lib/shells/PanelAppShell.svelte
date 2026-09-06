<script module lang="ts">
  export const shellKind = 'hmi-shell:panel' as const;
</script>

<script lang="ts">
  import '../../styles/app.css';
  import '../../styles/hero-layout.css';
  import '../../styles/standalone.css';
  import '../../styles/demo.css';
  import { onMount, type Component } from 'svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import TabBar from '../components/TabBar.svelte';
  import LoginScreen from '../components/LoginScreen.svelte';
  import StandbyFab from '../components/StandbyFab.svelte';
  import HomeScreen from '../screens/HomeScreen.svelte';
  import { SCREENS, nav, endTransition, type ScreenId } from '../state/nav.svelte.ts';
  import { connection, retryConnection } from '../state/connection.svelte.ts';
  import { authState } from '../state/auth.svelte.ts';
  import {
    centralClimateEdit, closeCentralClimateEdit,
    closeDeviceDetail, closeRoomEdit, deviceDetail, roomEdit,
  } from '../state/overlay.svelte.ts';
  import { closeSceneEdit, sceneEdit } from '../state/scene-edit-overlay.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { hud, simulator } from '../state/hud.svelte.ts';
  import { createRetryableLazyLoader } from '../state/lazy-loader.ts';
  import { shellLifecycle } from '../state/shell-lifecycle-instance.ts';
  import { undoOffer } from '../state/undo.svelte.ts';
  import { clockZoom, diagnostics } from '../state/hidden-gestures.svelte.ts';
  import { appState } from '../state/app.svelte.ts';
  import { ambientLight, watchAmbientLight } from '../state/ambient-light.svelte.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  type ScreenModule = { default: Component };
  type LazyScreenId = Exclude<ScreenId, 'home'>;
  type LayerId = 'device' | 'room' | 'scene' | 'central-climate' | 'layout' | 'ambient' | 'hud' | 'simulator';
  type VisibleLayerId = Exclude<LayerId, 'ambient'>;

  const SCREEN_LOADERS: Record<LazyScreenId, () => Promise<ScreenModule>> = {
    energy: () => import('../screens/EnergyScreen.svelte'),
    calendar: () => import('../screens/CalendarScreen.svelte'),
    notes: () => import('../screens/NotesScreen.svelte'),
    shopping: () => import('../screens/NotesScreen.svelte'),
    reminders: () => import('../screens/NotesScreen.svelte'),
    media: () => import('../screens/MediaScreen.svelte'),
    library: () => import('../screens/LibraryScreen.svelte'),
    'library-detail': () => import('../screens/LibraryDetailScreen.svelte'),
    ablage: () => import('../components/AblageScreen.svelte'),
    system: () => import('../screens/SystemScreen.svelte'),
  };
  const LAYER_LOADERS: Record<LayerId, () => Promise<ScreenModule>> = {
    device: () => import('../components/DeviceDetail.svelte'),
    room: () => import('../components/RoomEdit.svelte'),
    scene: () => import('../components/SceneEdit.svelte'),
    'central-climate': () => import('../components/CentralClimateEdit.svelte'),
    layout: () => import('../components/LayoutConfigDialog.svelte'),
    ambient: () => import('../components/AmbientLayer.svelte'),
    hud: () => import('../components/Hud.svelte'),
    simulator: () => import('../components/SimulationPanel.svelte'),
  };
  const screenLoader = createRetryableLazyLoader(SCREEN_LOADERS);
  const layerLoader = createRetryableLazyLoader(LAYER_LOADERS);
  let screenRetryVersions = $state({} as Partial<Record<LazyScreenId, number>>);
  let layerRetryVersions = $state({} as Partial<Record<VisibleLayerId, number>>);

  function loadScreen(id: LazyScreenId, _retryVersion: number): Promise<ScreenModule> {
    return screenLoader.load(id);
  }

  function loadLayer(id: LayerId, _retryVersion = 0): Promise<ScreenModule> {
    return layerLoader.load(id);
  }

  function retryScreen(id: LazyScreenId): void {
    screenRetryVersions[id] = (screenRetryVersions[id] ?? 0) + 1;
  }

  function retryLayer(id: VisibleLayerId): void {
    layerRetryVersions[id] = (layerRetryVersions[id] ?? 0) + 1;
  }

  function closeLayer(id: VisibleLayerId): void {
    if (id === 'device') closeDeviceDetail(true);
    else if (id === 'room') closeRoomEdit(true);
    else if (id === 'scene') closeSceneEdit(true);
    else if (id === 'central-climate') closeCentralClimateEdit(true);
    else if (id === 'layout') layoutManager.cancel();
    else hud.active = false;
  }

  const conn = $derived(connection());
  const auth = authState();
  const panelScreens = SCREENS.filter((screen) => !screen.phoneOnly);
  const visiblePanelScreens = $derived(panelScreens.filter((screen) => (
    nav.screen === screen.id || nav.entering === screen.id || nav.leaving === screen.id
  )));
  const screenEls: Partial<Record<ScreenId, HTMLElement>> = $state({});
  let AmbientLayerComponent = $state<Component | null>(null);
  /* Rückgängig-Streifen (Paket 6): erst laden, wenn es etwas zurückzunehmen
     gibt — der Startpfad bleibt unberührt. */
  let UndoToastComponent = $state<Component | null>(null);
  /* Versteckte Gesten (Paket 10): beide Ansichten kommen erst, wenn die Geste
     sie ruft — der Startpfad kennt nur die zwei Schalter. */
  let ClockZoomComponent = $state<Component<any> | null>(null);
  let DiagnosticsComponent = $state<Component<any> | null>(null);
  $effect(() => {
    if (!clockZoom.active || ClockZoomComponent) return;
    void import('../components/ClockZoom.svelte')
      .then((loaded) => { ClockZoomComponent = loaded.default; })
      .catch(() => { /* versteckte Geste: ein Fehlschlag bleibt folgenlos */ });
  });
  $effect(() => {
    if (!diagnostics.active || DiagnosticsComponent) return;
    void import('../components/DiagnosticsOverlay.svelte')
      .then((loaded) => { DiagnosticsComponent = loaded.default; })
      .catch(() => { /* versteckte Geste: ein Fehlschlag bleibt folgenlos */ });
  });
  /* Umgebungslicht (Paket 9): der Schleier folgt dem Raumlicht, sobald ein
     Sensor etwas meldet. Reine Deckkraft über allem, ohne Pointer-Ziel. */
  $effect(() => {
    if (!settingsValues.ambientLightDim) return;
    return watchAmbientLight(() => appState.currentRoom ?? '');
  });

  $effect(() => {
    if (!undoOffer.active || UndoToastComponent) return;
    void import('../components/UndoToast.svelte')
      .then((loaded) => { UndoToastComponent = loaded.default; })
      .catch(() => { /* ohne Streifen bleibt der Eingriff trotzdem gefahren */ });
  });

  $effect(() => {
    if (!nav.entering) return;
    const el = screenEls[nav.entering];
    if (el) el.scrollTop = 0;
    const fallback = setTimeout(endTransition, 400);
    return () => clearTimeout(fallback);
  });

  onMount(() => shellLifecycle.register(() => {
    closeDeviceDetail(true);
    closeRoomEdit(true);
    closeSceneEdit(true);
    closeCentralClimateEdit(true);
    if (layoutManager.open) layoutManager.cancel();
    hud.active = false;
    simulator.active = false;
  }));

  /* Der Raumbild-Assistent meldet sich selbst, wenn etwas fertig ist (Paket
     13). Der Wächter kommt erst nach dem ersten Bild und nur, wenn wirklich
     ein Auftrag läuft — der Startpfad sieht ihn nie. */
  onMount(() => {
    let stop: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      void import('../state/room-image-watch.svelte.ts')
        .then((module) => { stop = module.watchRoomImageJobs(); })
        .catch(() => { /* ohne Wächter bleibt es beim Blick in den Assistenten */ });
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      stop?.();
    };
  });

  onMount(() => {
    let cancelled = false;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        void loadLayer('ambient').then((loaded) => {
          if (!cancelled) AmbientLayerComponent = loaded.default;
        }).catch(() => {
          // Ambient ist rein dekorativ. Der success-only Cache erlaubt beim
          // nächsten Shell-Mount einen echten neuen Versuch ohne UI-Blocker.
        });
      }, 0);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  });
</script>

{#snippet layerLoadState(id: VisibleLayerId, failed: boolean)}
  {#if failed}
    <div class="layout-dialog-scrim" role="presentation">
      <div class="layout-dialog" role="dialog" aria-modal="true" aria-label="Bereich laden">
        <p role="alert">{m.shell_load_failed()}</p>
        <button class="secondary-btn pressable" type="button" onclick={() => retryLayer(id)}>Erneut versuchen</button>
        <button class="secondary-btn pressable" type="button" onclick={() => closeLayer(id)}>{m.common_close()}</button>
      </div>
    </div>
  {:else}
    <!-- Kein sichtbarer Platzhalter: das Chunk-Laden dauert meist wenige
         Millisekunden, und die Dialog-Optik blitzte dabei rechts als eigenes
         Panel auf, bevor das eigentliche Overlay kam. Die Statusmeldung bleibt
         für Screenreader erhalten. -->
    <p class="layer-load-status" role="status" aria-live="polite">{m.shell_loading()}</p>
  {/if}
{/snippet}

<div class="status-scrim" aria-hidden="true"></div>

<!-- Gesperrt, solange keine Verbindung steht — also genau dann, wenn das
     Banner sichtbar ist (auch beim Reconnect, nicht erst bei harter Trennung). -->
<div class="app" data-shell="panel" class:is-disconnected={conn.banner !== null}>
  <StatusBar />
  <main class="screens">
    <div class="conn-banner" class:is-visible={conn.banner !== null} role="status" aria-live="polite">
      <span class="dot {conn.dot}"></span>{conn.banner ?? ''}
      {#if conn.banner !== null}
        <button class="conn-retry" type="button" onclick={retryConnection}>{m.conn_retry()}</button>
      {/if}
    </div>

    {#each visiblePanelScreens as screen (screen.id)}
      <section class="screen" data-screen={screen.id} data-tab={screen.tab}
               class:is-active={nav.screen === screen.id || nav.leaving === screen.id}
               class:is-entering={nav.entering === screen.id}
               class:anim-fade-in={nav.entering === screen.id}
               class:is-leaving={nav.leaving === screen.id}
               class:anim-fade-out={nav.leaving === screen.id}
               bind:this={screenEls[screen.id]}
               onanimationend={(event) => {
                 if (nav.entering === screen.id && event.target === event.currentTarget) endTransition();
               }}>
        {#if screen.id === 'home'}
          <HomeScreen />
        {:else}
          {#await loadScreen(screen.id as LazyScreenId, screenRetryVersions[screen.id as LazyScreenId] ?? 0)}
            <p role="status" aria-live="polite">{m.shell_loading()}</p>
          {:then loaded}
            {@const ScreenComponent = loaded.default}
            <ScreenComponent />
          {:catch}
            <p role="alert">{m.shell_load_failed()}</p>
            <button class="secondary-btn pressable" type="button" onclick={() => retryScreen(screen.id as LazyScreenId)}>Erneut versuchen</button>
          {/await}
        {/if}
      </section>
    {/each}
  </main>

  <TabBar />
  <StandbyFab />
</div>

{#if deviceDetail.mode !== 'hidden'}
  {#await loadLayer('device', layerRetryVersions.device ?? 0)}
    {@render layerLoadState('device', false)}
  {:then loaded}{@const Layer = loaded.default}<Layer />
  {:catch}{@render layerLoadState('device', true)}{/await}
{/if}
{#if roomEdit.mode !== 'hidden'}
  {#await loadLayer('room', layerRetryVersions.room ?? 0)}
    {@render layerLoadState('room', false)}
  {:then loaded}{@const Layer = loaded.default}<Layer />
  {:catch}{@render layerLoadState('room', true)}{/await}
{/if}
{#if sceneEdit.mode !== 'hidden'}
  {#await loadLayer('scene', layerRetryVersions.scene ?? 0)}
    {@render layerLoadState('scene', false)}
  {:then loaded}{@const Layer = loaded.default}<Layer />
  {:catch}{@render layerLoadState('scene', true)}{/await}
{/if}
{#if centralClimateEdit.mode !== 'hidden'}
  {#await loadLayer('central-climate', layerRetryVersions['central-climate'] ?? 0)}
    {@render layerLoadState('central-climate', false)}
  {:then loaded}{@const Layer = loaded.default}<Layer />
  {:catch}{@render layerLoadState('central-climate', true)}{/await}
{/if}
{#if layoutManager.open}
  {#await loadLayer('layout', layerRetryVersions.layout ?? 0)}
    {@render layerLoadState('layout', false)}
  {:then loaded}{@const Layer = loaded.default}<Layer />
  {:catch}{@render layerLoadState('layout', true)}{/await}
{/if}
{#if AmbientLayerComponent}<AmbientLayerComponent />{/if}
{#if UndoToastComponent}<UndoToastComponent />{/if}
{#if ClockZoomComponent && clockZoom.active}<ClockZoomComponent />{/if}
{#if DiagnosticsComponent && diagnostics.active}<DiagnosticsComponent />{/if}
{#if settingsValues.ambientLightDim && ambientLight.dim > 0}
  <div class="ambient-dim-veil" aria-hidden="true" style:opacity={ambientLight.dim}></div>
{/if}
{#if hud.active}
  {#await loadLayer('hud', layerRetryVersions.hud ?? 0)}
    {@render layerLoadState('hud', false)}
  {:then loaded}{@const Layer = loaded.default}<Layer />
  {:catch}{@render layerLoadState('hud', true)}{/await}
{/if}
{#if simulator.active}
  {#await loadLayer('simulator', layerRetryVersions.simulator ?? 0)}
    {@render layerLoadState('simulator', false)}
  {:then loaded}{@const Layer = loaded.default}<Layer />
  {:catch}{@render layerLoadState('simulator', true)}{/await}
{/if}

{#if auth.needsToken}
  <LoginScreen />
{/if}
