<script lang="ts">
  import { onDestroy, type Component } from 'svelte';
  import { runtime } from './lib/adapter/runtime.svelte.ts';
  import { visibleEntityIds } from './lib/state/entities.ts';
  import { initTheme } from './lib/state/theme.svelte.ts';
  import { initDeviceManager } from './lib/state/device-manager.svelte.ts';
  import { measurePressedPaint } from './lib/state/phase4-metrics.svelte.ts';
  import { initFamilyCalendar } from './lib/state/calendar.svelte.ts';
  import { initReminders } from './lib/state/reminders.svelte.ts';
  import { initShopping } from './lib/state/shopping.svelte.ts';
  import { nav } from './lib/state/nav.svelte.ts';
  import { shellLifecycle } from './lib/state/shell-lifecycle-instance.ts';
  import {
    createLatestShellLoader,
    destroyUiMode,
    initUiMode,
    uiMode,
  } from './lib/state/ui-mode.svelte.ts';
  import NotificationLayer from './lib/components/NotificationLayer.svelte';
  import PlayerLayer from './lib/components/PlayerLayer.svelte';
  import { notifications } from './lib/state/notifications.svelte.ts';
  import { initLocale, localeState } from './lib/state/locale.svelte.ts';
  import { m } from './paraglide/messages.js';

  type ShellModule = { default: Component; shellKind: 'hmi-shell:phone' | 'hmi-shell:panel' };

  let { shellLoaders }: {
    shellLoaders: Record<'phone' | 'panel', () => Promise<ShellModule>>;
  } = $props();

  initLocale();
  initTheme();
  initDeviceManager();
  initFamilyCalendar();
  initReminders();
  initShopping();
  initUiMode();
  notifications.init();
  onDestroy(destroyUiMode);

  $effect(() => {
    runtime.setVisible(visibleEntityIds(nav.screen));
  });

  let ShellComponent = $state<Component | null>(null);
  let shellLoadFailed = $state(false);
  const shellLoader = createLatestShellLoader<ShellModule>({
    phone: () => shellLoaders.phone(),
    panel: () => shellLoaders.panel(),
  });

  $effect(() => {
    const mode = uiMode.effective;
    document.documentElement.dataset.uiMode = mode;
    shellLifecycle.prepareChange();
    ShellComponent = null;
    shellLoadFailed = false;
    void shellLoader.load(mode, (loaded) => {
      if (loaded.shellKind !== `hmi-shell:${mode}`) return;
      ShellComponent = loaded.default;
    }).catch(() => {
      shellLoadFailed = true;
    });
  });

  function pressedFeedback(e: PointerEvent) {
    const el = (e.target as HTMLElement).closest<HTMLButtonElement>('.pressable');
    if (!el || el.disabled) return;
    const startedAt = performance.now();
    el.classList.add('is-pressed');
    measurePressedPaint(el, startedAt);
    const release = () => el.classList.remove('is-pressed');
    el.addEventListener('pointerup', release, { once: true });
    el.addEventListener('pointercancel', release, { once: true });
    el.addEventListener('pointerleave', release, { once: true });
  }
</script>

<svelte:document onpointerdown={pressedFeedback} />

{#key localeState.current}
{#if ShellComponent}
  <ShellComponent />
{:else if shellLoadFailed}
  <main class="shell-load-state" role="alert">{m.shell_load_failed()}</main>
{:else}
  <main class="shell-load-state" role="status" aria-live="polite">{m.shell_loading()}</main>
{/if}
{/key}

<NotificationLayer />
<PlayerLayer />
