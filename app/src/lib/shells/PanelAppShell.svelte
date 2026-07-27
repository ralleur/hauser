<script module lang="ts">
  export const shellKind = 'hmi-shell:panel' as const;
</script>

<script lang="ts">
  import '../../styles/app.css';
  import '../../styles/room-backgrounds.css';
  import '../../styles/hero-layout.css';
  import '../../styles/standalone.css';
  import '../../styles/demo.css';
  import { onMount } from 'svelte';
  import StatusBar from '../components/StatusBar.svelte';
  import TabBar from '../components/TabBar.svelte';

  import DeviceDetail from '../components/DeviceDetail.svelte';
  import RoomEdit from '../components/RoomEdit.svelte';
  import SceneEdit from '../components/SceneEdit.svelte';
  import AmbientLayer from '../components/AmbientLayer.svelte';
  import Hud from '../components/Hud.svelte';
  import LoginScreen from '../components/LoginScreen.svelte';
  import StandaloneHint from '../components/StandaloneHint.svelte';
  import StandbyFab from '../components/StandbyFab.svelte';
  import LayoutConfigDialog from '../components/LayoutConfigDialog.svelte';
  import HomeScreen from '../screens/HomeScreen.svelte';
  import EnergyScreen from '../screens/EnergyScreen.svelte';
  import MediaScreen from '../screens/MediaScreen.svelte';
  import SongsScreen from '../screens/SongsScreen.svelte';
  import LibraryScreen from '../screens/LibraryScreen.svelte';
  import LibraryDetailScreen from '../screens/LibraryDetailScreen.svelte';
  import SystemScreen from '../screens/SystemScreen.svelte';
  import AblageScreen from '../components/AblageScreen.svelte';
  import CalendarScreen from '../screens/CalendarScreen.svelte';
  import NotesScreen from '../screens/NotesScreen.svelte';
  import { SCREENS, nav, endTransition, type ScreenId } from '../state/nav.svelte.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { authState } from '../state/auth.svelte.ts';
  import { closeDeviceDetail, closeRoomEdit } from '../state/overlay.svelte.ts';
  import { closeSceneEdit } from '../state/scene-manager.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { hud } from '../state/hud.svelte.ts';
  import { shellLifecycle } from '../state/shell-lifecycle-instance.ts';
  import type { Component } from 'svelte';

  const conn = $derived(connection());
  const auth = authState();

  const SCREEN_COMPONENTS: Record<ScreenId, Component> = {
    home: HomeScreen,
    energy: EnergyScreen,
    calendar: CalendarScreen,
    notes: NotesScreen,
    // Phone-only-Ziele: das Panel mountet sie nie (Filter unten); die
    // Zuordnung hält den Record vollständig, falls der Zustand sie nennt.
    shopping: NotesScreen,
    reminders: NotesScreen,
    media: MediaScreen,
    songs: SongsScreen,
    library: LibraryScreen,
    'library-detail': LibraryDetailScreen,
    ablage: AblageScreen,
    system: SystemScreen,
  };

  const panelScreens = SCREENS.filter((s) => !s.phoneOnly);

  const screenEls: Partial<Record<ScreenId, HTMLElement>> = $state({});

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
    if (layoutManager.open) layoutManager.cancel();
    hud.active = false;
  }));
</script>

<div class="status-scrim" aria-hidden="true"></div>

<div class="app" data-shell="panel" class:is-disconnected={conn.disconnected}>
  <StatusBar />
  <main class="screens">
    <div class="conn-banner" class:is-visible={conn.banner !== null} role="status" aria-live="polite">
      <span class="dot {conn.dot}"></span>{conn.banner ?? ''}
    </div>

    {#each panelScreens as s (s.id)}
      {@const ScreenComponent = SCREEN_COMPONENTS[s.id]}
      <section class="screen" data-screen={s.id} data-tab={s.tab}
               class:is-active={nav.screen === s.id || nav.leaving === s.id}
               class:is-entering={nav.entering === s.id}
               class:anim-fade-in={nav.entering === s.id}
               class:is-leaving={nav.leaving === s.id}
               class:anim-fade-out={nav.leaving === s.id}
               bind:this={screenEls[s.id]}
               onanimationend={(e) => { if (nav.entering === s.id && e.target === e.currentTarget) endTransition(); }}>
        <ScreenComponent />
      </section>
    {/each}
  </main>

  <TabBar />
  <StandbyFab />
</div>

<DeviceDetail />
<RoomEdit />
<SceneEdit />
<LayoutConfigDialog />
<AmbientLayer />
<Hud />

{#if auth.needsToken}
  <LoginScreen />
{/if}
<StandaloneHint />
