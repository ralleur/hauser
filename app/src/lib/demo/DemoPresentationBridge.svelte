<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Local website experiment. The bridge exists only in an explicitly embedded
     demo. All actions still use Hauser's real state, navigation and controls. */
  import { onMount, tick } from 'svelte';
  import { appState } from '../state/app.svelte.ts';
  import { showScreen, endTransition, type ScreenId } from '../state/nav.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { setAppearanceMode } from '../state/theme.svelte.ts';
  import { changeLocale } from '../state/locale.svelte.ts';
  import { setUiModePreference, uiMode } from '../state/ui-mode.svelte.ts';
  import { requestAmbientPreview, ambientState } from '../state/ambient.svelte.ts';
  import { setAmbientCityMap } from '../state/settings.svelte.ts';
  import { ensureAmbientMapStatus } from '../state/ambient-map.svelte.ts';
  import { deviceDetail, openDeviceDetail, openRoomEdit, closeDeviceDetail, closeRoomEdit, closeCentralClimateEdit, closeRoomClimate } from '../state/overlay.svelte.ts';

  import { editMode } from '../state/edit-mode.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { resolveRoomHero, loadRoomHero } from '../components/room-hero-assets.ts';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import type { LightValue } from '../adapter/types.ts';

  let story = $state({ chapter: 'light', step: 'tap' });
  $effect(() => {
    // A visitor who discovers the long press can continue at that same point.
    if (deviceDetail.mode === 'open' && story.chapter === 'light' && story.step === 'tap') {
      window.parent.postMessage({ source: 'hauser-demo', type: 'interaction', chapter: 'light', step: 'tap', action: 'detail-open' }, location.origin);
    }
  });

  onMount(() => {
    const root = document.documentElement;
    root.dataset.presentation = 'guided';
    setAppearanceMode('fixed-dark');
    const mobile = new URLSearchParams(location.search).get('device') === 'mobile';
    root.dataset.presentationDevice = mobile ? 'mobile' : 'desktop';
    setUiModePreference(mobile ? 'phone' : 'panel');
    let chapter = 'light';
    let activeStep = 'tap';
    let navigation = 0;
    let disposed = false;
    let cancelRoomWait = () => {};

    function waitForUi(find: () => HTMLElement | undefined): Promise<HTMLElement | undefined> {
      return new Promise(resolve => {
        const finish = (element?: HTMLElement) => { observer.disconnect(); clearTimeout(timeout); cancelRoomWait = () => {}; resolve(element); };
        const check = () => { const element = find(); if (element) finish(element); };
        const observer = new MutationObserver(check);
        const timeout = window.setTimeout(() => finish(), 15000);
        cancelRoomWait = () => finish();
        observer.observe(document.body, { childList: true, subtree: true });
        check();
      });
    }

    async function openMobileRoom() {
      const room = appState.rooms.find(r => r.id === 'wohnzimmer');
      const card = await waitForUi(() => [...document.querySelectorAll<HTMLButtonElement>('[data-shell="phone"] .phone-room-card')]
        .find(button => button.getAttribute('aria-label')?.startsWith(`${room?.name},`)));
      card?.click();
    }

    async function preparePictures() {
      let done = 0;
      // Only the opening room gates the entrance. Other rooms load on demand.
      const room = appState.rooms.find(room => room.id === 'wohnzimmer');
      const variants = ['dark-off', 'dark'] as const;
      const total = room ? variants.length : 0;
      tell('loading', { phase: 3, done, total });
      // Decode both sides of the first interaction before inviting a tap.
      await Promise.all((room ? variants : []).map(async variant => {
        if (!room) return;
        const base = { baseUrl: import.meta.env.BASE_URL, roomId: room.id, config: roomHeroConfig(room.id) };
        const resolution = resolveRoomHero(mobile
          ? { ...base, target: 'phone', variant }
          : { ...base, target: 'panel', sun: undefined, fallbackTheme: 'dark', allAssignedLightsOff: variant === 'dark-off' });
        await loadRoomHero(resolution);
        done++;
        if (!disposed) tell('loading', { phase: 3 + done / total, done, total });
      }));
      if (!disposed) tell('loading', { phase: 4 });
      await document.fonts.ready;
    }

    function tell(type: string, data: Record<string, unknown> = {}) {
      window.parent.postMessage({ source: 'hauser-demo', type, ...data }, location.origin);
    }

    async function turnAllLightsOff() {
      for (const room of appState.rooms) {
        for (const lamp of room.lights) {
          if ((lamp.domain ?? 'light') !== 'light') continue;
          const value = runtime.merged(lamp.entityId) as LightValue | undefined;
          runtime.dispatch(
            { entityId: lamp.entityId, domain: 'light', service: 'turn_off', data: {}, queuedAt: Date.now() },
            { ...value, on: false },
          );
        }
      }
      await tick();
    }

    function wake() {
      if (!ambientState.active) return;
      const ambient = document.querySelector<HTMLElement>('.ambient.is-on');
      ambient?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2, pointerId: 1 }));
      ambient?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2, pointerId: 1 }));
    }

    async function navigate(moment: string, step = moment === 'light' ? 'tap' : moment) {
      if (mobile && moment === 'quiet') return;
      const request = ++navigation;
      cancelRoomWait();
      chapter = moment;
      activeStep = step;
      story.chapter = moment; story.step = step;
      wake();
      closeDeviceDetail(true); closeRoomEdit(true); closeCentralClimateEdit(true); closeRoomClimate(true);
      if (mobile && (moment !== 'light' || step === 'climate')) document.querySelector<HTMLElement>('.room-sheet-scrim')?.click();
      layoutManager.finishHide();
      // The website chooses the shell once. A narrow exhibit inside a desktop
      // page must never turn the panel into the phone app.
      if (moment !== 'light' || mobile || step === 'climate') appState.currentRoom = null;
      if (uiMode.preference !== (mobile ? 'phone' : 'panel')) setUiModePreference(mobile ? 'phone' : 'panel');
      endTransition();
      const screens: Record<string, ScreenId> = { light: 'home', rooms: 'home', energy: 'energy', everyday: 'notes', quiet: 'home' };
      showScreen(screens[moment] ?? 'home');
      if (moment === 'light' || moment === 'rooms') {
        layoutManager.setHomeView(moment === 'light' && step !== 'climate' ? 'image' : 'rooms');
        layoutManager.setAppliedRoom('slot-1', 'wohnzimmer');
        if (moment === 'light' && !mobile && step !== 'climate') appState.currentRoom = 'wohnzimmer';
      }
      if (moment === 'quiet') {
        setAmbientCityMap(true);
        ensureAmbientMapStatus({ immediate: true });
        requestAmbientPreview();
      }
      if (mobile && moment === 'light' && step !== 'climate') {
        await tick();
        await openMobileRoom();
      }
      if (request !== navigation || disposed) return;
      if (step === 'controls') {
        const lamp = appState.rooms.find(r => r.id === 'wohnzimmer')?.lights.find(l => l.entityId === 'light.wohnzimmer_fensterlampe');
        if (lamp) openDeviceDetail('wohnzimmer', lamp.id);
      }
      if (step === 'scenes' && !mobile) {
        appState.currentRoom = 'wohnzimmer';
        layoutManager.setHomeView('fullscreen');
      }
      if (step === 'room-design') {
        editMode.active = true;
        openRoomEdit('wohnzimmer', 'background');
      }
      if (step === 'appearance') {
        editMode.active = true;
        showScreen('system');
        const { settingsSection } = await import('../state/settings-registry.ts');
        const button = await waitForUi(() => [...document.querySelectorAll<HTMLButtonElement>('.settings-nav-btn')]
          .find(el => el.querySelector('.settings-nav-label')?.textContent === settingsSection('appearance').label));
        if (request === navigation && !disposed) button?.click();
        if (mobile && request === navigation && !disposed) {
          const cardStyle = await waitForUi(() => document.querySelector<HTMLElement>('[data-setting-id="card-style"]') ?? undefined);
          if (request === navigation && !disposed) cardStyle?.scrollIntoView({ block: 'start' });
        }
      }
      reportTarget();
    }

    async function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.source !== 'hauser-story') return;
      const data = event.data;
      if (data.type === 'locale' && (data.locale === 'de' || data.locale === 'en')) await changeLocale(data.locale);
      if (data.type === 'moment' && ['light', 'rooms', 'energy', 'everyday', 'quiet'].includes(data.moment)) await navigate(data.moment, data.step);
      if (data.type === 'mode') {
        root.dataset.presentation = data.mode === 'explore' ? 'explore' : 'guided';
        wake();
      }
      if (data.type === 'appearance' && (data.appearance === 'day' || data.appearance === 'evening')) setAppearanceMode(data.appearance === 'day' ? 'fixed-light' : 'fixed-dark');
    }

    function interaction(event: MouseEvent) {
      if (!event.isTrusted) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('button, input, [role="checkbox"], [role="slider"]')) return;
      if (chapter === 'light' && activeStep === 'tap') {
        const lamp = appState.rooms.find(r => r.id === 'wohnzimmer')?.lights.find(l => l.entityId === 'light.wohnzimmer_fensterlampe');
        const button = target.closest('button');
        if ((button?.getAttribute('aria-label') ?? button?.textContent?.trim()) !== lamp?.name) return;
      }
      tell('interaction', { chapter, step: activeStep });
    }

    function ambientTouch(event: PointerEvent) {
      if (chapter === 'quiet' && event.target instanceof Element && event.target.closest('.ambient.is-on')) tell('interaction', { chapter, step: activeStep });
    }

    function reportTarget() {
      const room = appState.rooms.find(r => r.id === 'wohnzimmer');
      const lamp = room?.lights.find(l => l.entityId === 'light.wohnzimmer_fensterlampe');
      const target = lamp && [...document.querySelectorAll<HTMLElement>('.hero-device-target')].find(el => el.getAttribute('aria-label') === lamp.name);
      const rect = target?.getBoundingClientRect();
      tell('target', { rect: rect && rect.width > 0 ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null });
    }

    window.addEventListener('message', receive);
    window.addEventListener('resize', reportTarget);
    document.addEventListener('click', interaction);
    document.addEventListener('pointerup', ambientTouch, true);
    const timer = window.setInterval(reportTarget, 500);
    tell('loading', { phase: 3 });
    void navigate('light').then(preparePictures).then(turnAllLightsOff).then(() => { if (!disposed) tell('ready'); });
    return () => {
      disposed = true;
      navigation++;
      cancelRoomWait();
      delete root.dataset.presentation;
      delete root.dataset.presentationDevice;
      clearInterval(timer);
      window.removeEventListener('message', receive);
      window.removeEventListener('resize', reportTarget);
      document.removeEventListener('click', interaction);
      document.removeEventListener('pointerup', ambientTouch, true);
    };
  });
</script>

<style>
  :global(html[data-presentation-device="mobile"] .demo-badge) {
    visibility: hidden;
    pointer-events: none;
  }
  :global(html[data-presentation-device="mobile"] .room-sheet-title) {
    font-size: clamp(var(--text-lg), 8vw, var(--text-xl));
    overflow-wrap: normal;
  }
  :global(html[data-presentation="guided"] .demo-badge),
  :global(html[data-presentation="guided"] .status-bar),
  :global(html[data-presentation="guided"] .standby-fab) { visibility: hidden; pointer-events: none; }
</style>
