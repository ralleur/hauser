<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Same-origin, demo-only director. Scenes use the application's real state and
     commands. Acknowledgements gate reading time in the website player. */
  import { onMount, tick } from 'svelte';
  import { appState } from '../state/app.svelte.ts';
  import { showScreen, endTransition } from '../state/nav.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { setAppearanceMode } from '../state/theme.svelte.ts';
  import { changeLocale } from '../state/locale.svelte.ts';
  import { setUiModePreference } from '../state/ui-mode.svelte.ts';
  import { requestAmbientPreview, ambientState } from '../state/ambient.svelte.ts';
  import { setAmbientCityMap } from '../state/settings.svelte.ts';
  import { ensureAmbientMapStatus } from '../state/ambient-map.svelte.ts';
  import { closeDeviceDetail, closeRoomEdit, closeCentralClimateEdit, closeRoomClimate } from '../state/overlay.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { resolveRoomHero, loadRoomHero } from '../components/room-hero-assets.ts';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import { applyScene } from '../state/scene-manager.svelte.ts';
  import { shopping, refreshShopping, toggleShoppingItem } from '../state/shopping.svelte.ts';
  import { refreshCommute } from '../state/commute.svelte.ts';
  import { setClockPreview } from '../state/clock.svelte.ts';
  import type { LightValue } from '../adapter/types.ts';

  onMount(() => {
    const root = document.documentElement;
    const mobile = new URLSearchParams(location.search).get('device') === 'mobile';
    root.dataset.presentation = 'guided';
    root.dataset.presentationDevice = mobile ? 'mobile' : 'desktop';
    let controller = new AbortController();
    let disposed = false;
    let shoppingId: string | undefined;
    const tell = (type: string, data: Record<string, unknown> = {}) => window.parent.postMessage({ source: 'hauser-demo', type, ...data }, location.origin);
    function cancel() { controller.abort(); controller = new AbortController(); }
    function alive(signal: AbortSignal) { if (signal.aborted || disposed) throw new DOMException('Scene cancelled', 'AbortError'); }
    function waitFor(find: () => Element | null | undefined, signal: AbortSignal): Promise<Element> {
      return new Promise((resolve, reject) => {
        const done = (element?: Element, error?: Error) => { clearInterval(timer); clearTimeout(timeout); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(element!); };
        const check = () => { const element = find(); if (element) done(element); };
        const abort = () => done(undefined, new DOMException('Scene cancelled', 'AbortError'));
        const timer = window.setInterval(check, 60);
        const timeout = window.setTimeout(() => done(undefined, new Error('Scene did not become visible')), 20000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort(); else check();
      });
    }
    async function pictures() {
      const room = appState.rooms.find(r => r.id === 'wohnzimmer');
      if (!room) throw new Error('Demo room missing');
      let done = 0;
      await Promise.all((['dark-off', 'dark'] as const).map(async variant => {
        const base = { baseUrl: import.meta.env.BASE_URL, roomId: room.id, config: roomHeroConfig(room.id) };
        await loadRoomHero(resolveRoomHero(mobile ? { ...base, target: 'phone', variant } : { ...base, target: 'panel', sun: undefined, fallbackTheme: 'dark', allAssignedLightsOff: variant === 'dark-off' }));
        if (!disposed) tell('loading', { phase: 3 + ++done / 2, done, total: 2 });
      }));
      await document.fonts.ready;
    }
    function lightsOff() {
      for (const room of appState.rooms) for (const lamp of room.lights) {
        if ((lamp.domain ?? 'light') !== 'light') continue;
        const value = runtime.merged(lamp.entityId) as LightValue | undefined;
        runtime.dispatch({ entityId: lamp.entityId, domain: 'light', service: 'turn_off', data: {}, queuedAt: Date.now() }, { ...value, on: false });
      }
    }
    function wake() {
      if (!ambientState.active) return;
      const ambient = document.querySelector<HTMLElement>('.ambient.is-on');
      for (const type of ['pointerdown', 'pointerup']) ambient?.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2, pointerId: 1 }));
    }
    async function navigate(id: string, signal: AbortSignal) {
      wake();
      // Complete the ambient wake before replacing its underlying screen.
      await waitFor(() => !ambientState.active ? document.body : null, signal);
      alive(signal);
      closeDeviceDetail(true); closeRoomEdit(true); closeCentralClimateEdit(true); closeRoomClimate(true);
      document.querySelector<HTMLElement>('.room-sheet-scrim')?.click();
      const panel = !mobile || ['commute', 'quiet'].includes(id);
      setUiModePreference(panel ? 'panel' : 'phone');
      appState.currentRoom = null; layoutManager.finishHide(); endTransition();
      showScreen(id === 'energy' ? 'energy' : ['shopping', 'checked'].includes(id) ? 'notes' : 'home');
      if (!['energy', 'shopping', 'checked'].includes(id)) {
        layoutManager.setHomeView('image'); layoutManager.setAppliedRoom('slot-1', 'wohnzimmer');
        if (panel) appState.currentRoom = 'wohnzimmer';
      }
      await tick(); alive(signal);
      if (!panel && !['energy', 'shopping', 'checked'].includes(id)) {
        const room = appState.rooms.find(r => r.id === 'wohnzimmer');
        const card = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('[data-shell="phone"] .phone-room-card')].find(button => button.getAttribute('aria-label')?.startsWith(`${room?.name},`)), signal);
        alive(signal); (card as HTMLElement).click();
      }
    }
    async function present(id: string, signal: AbortSignal) {
      root.dataset.presentationScene = id;
      const morning = id === 'commute';
      const date = new Date(); date.setHours(morning ? 7 : 19, morning ? 24 : 42, 0, 0);
      setClockPreview(date);
      setAppearanceMode(id === 'energy' ? 'fixed-light' : 'fixed-dark');
      await navigate(id, signal); alive(signal);
      if (id === 'welcome') lightsOff();
      if (id === 'lamp') {
        lightsOff();
        const lamp = appState.rooms.find(r => r.id === 'wohnzimmer')?.lights.find(l => l.entityId === 'light.wohnzimmer_fensterlampe');
        if (lamp) runtime.dispatch({ entityId: lamp.entityId, domain: 'light', service: 'turn_on', data: { brightness: 210 }, queuedAt: Date.now() }, { ...(runtime.merged(lamp.entityId) as LightValue), on: true, brightness: 82 });
      }
      if (['cozy', 'photo', 'illustration', 'finish'].includes(id)) applyScene('wohnzimmer', 'gemuetlich');
      if (id === 'evening') lightsOff();
      if (id === 'commute' || id === 'quiet') {
        setAmbientCityMap(true); void ensureAmbientMapStatus({ immediate: true });
        await refreshCommute(); alive(signal); requestAmbientPreview();
        await waitFor(() => document.querySelector('.ambient.is-on .commute-view-switch'), signal); alive(signal);
        // Preview initially includes the route; quiet explicitly returns to the home view.
        if (id === 'quiet') {
          const button = await waitFor(() => document.querySelector('.commute-view-switch[aria-pressed="true"]'), signal);
          alive(signal); (button as HTMLElement).click();
          await waitFor(() => document.querySelector('.ambient.is-on:not(.has-commute)'), signal);
        } else await waitFor(() => document.querySelector('.commute-traffic-detail.is-drawn'), signal);
      } else if (id === 'shopping' || id === 'checked') {
        await refreshShopping(); alive(signal);
        const section = shopping.sections.find(section => section.items.some(item => item.id === shoppingId)) ?? shopping.sections.find(section => section.items.length);
        const item = section?.items.find(item => item.id === shoppingId) ?? section?.items.find(item => !item.checked) ?? section?.items[0];
        if (!section || !item) throw new Error('Demo shopping list missing');
        shoppingId = item.id;
        if (item.checked !== (id === 'checked')) { await toggleShoppingItem(section.id, item); alive(signal); }
        await waitFor(() => document.querySelector('.notes-screen, .phone-shopping'), signal);
      } else if (id === 'energy') await waitFor(() => document.querySelector('.energy-stage, .phone-energy'), signal);
      else await waitFor(() => document.querySelector('.hero-device-target, .room-sheet.is-open, .room-sheet'), signal);
      await tick(); alive(signal);
      // Decode visible images before the parent starts this scene's reading time.
      await Promise.all([...document.images].filter(img => img.getClientRects().length && img.currentSrc).map(img => img.decode().catch(() => {})));
      alive(signal);
    }
    async function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.source !== 'hauser-story') return;
      const data = event.data;
      if (data.type === 'cancel') cancel();
      if (data.type === 'locale' && ['de', 'en'].includes(data.locale)) await changeLocale(data.locale);
      if (data.type === 'mode') {
        root.dataset.presentation = data.mode === 'explore' ? 'explore' : 'guided';
        if (data.mode === 'explore') { delete root.dataset.presentationScene; cancel(); setClockPreview(null); if (mobile) { wake(); setUiModePreference('phone'); } }
      }
      if (data.type === 'scene' && ['welcome', 'lamp', 'cozy', 'commute', 'photo', 'illustration', 'energy', 'shopping', 'checked', 'evening', 'quiet', 'finish'].includes(data.id)) {
        cancel(); const signal = controller.signal;
        try { if (['de', 'en'].includes(data.locale)) await changeLocale(data.locale); alive(signal); await present(data.id, signal); tell('scene-ready', { requestId: data.requestId }); }
        catch (error) { if (!signal.aborted && !disposed) tell('scene-error', { requestId: data.requestId }); }
      }
    }
    function interaction(event: Event) {
      if (!event.isTrusted || root.dataset.presentation !== 'guided') return;
      cancel(); tell('interaction');
    }
    window.addEventListener('message', receive);
    document.addEventListener('pointerdown', interaction, true);
    document.addEventListener('keydown', interaction, true);
    tell('loading', { phase: 3 });
    void (async () => { setAppearanceMode('fixed-dark'); lightsOff(); await navigate('welcome', controller.signal); await pictures(); if (!disposed) tell('ready'); })().catch(() => { if (!disposed) tell('loading', { phase: 4 }); });
    return () => {
      disposed = true; cancel(); setClockPreview(null);
      delete root.dataset.presentation; delete root.dataset.presentationDevice; delete root.dataset.presentationScene;
      window.removeEventListener('message', receive);
      document.removeEventListener('pointerdown', interaction, true); document.removeEventListener('keydown', interaction, true);
    };
  });
</script>
<style>
  :global(html[data-presentation="guided"][data-presentation-scene="commute"] .ambient-status),
  :global(html[data-presentation="guided"][data-presentation-scene="commute"] .ambient-greeting),
  :global(html[data-presentation="guided"][data-presentation-scene="commute"] .ambient-shopping),
  :global(html[data-presentation="guided"][data-presentation-scene="commute"] .ambient-postits),
  :global(html[data-presentation="guided"][data-presentation-scene="commute"] .ambient-week) { display: none; }
  :global(html[data-presentation-device="mobile"] .demo-badge) { visibility: hidden; pointer-events: none; }
  :global(html[data-presentation-device="mobile"] .room-sheet-title) { font-size: clamp(var(--text-lg), 8vw, var(--text-xl)); overflow-wrap: normal; }
  :global(html[data-presentation="guided"] .demo-badge),
  :global(html[data-presentation="guided"] .status-bar),
  :global(html[data-presentation="guided"] .standby-fab) { visibility: hidden; pointer-events: none; }
</style>
