<script lang="ts">
  import { onDestroy, onMount, untrack, type Component } from 'svelte';
  import { runtime } from './lib/adapter/runtime.svelte.ts';
  import { visibleEntityIds } from './lib/state/entities.ts';
  import { initTheme } from './lib/state/theme.svelte.ts';
  import { initDeviceManager } from './lib/state/device-manager.svelte.ts';
  import { measurePressedPaint } from './lib/state/phase4-metrics.svelte.ts';
  import { nav } from './lib/state/nav.svelte.ts';
  import { shellLifecycle } from './lib/state/shell-lifecycle-instance.ts';
  import {
    createLatestShellLoader,
    destroyUiMode,
    initUiMode,
    uiMode,
  } from './lib/state/ui-mode.svelte.ts';
  import { initLocale, localeState } from './lib/state/locale.svelte.ts';
  import { m } from './paraglide/messages.js';

  type ShellModule = { default: Component; shellKind: 'hmi-shell:phone' | 'hmi-shell:panel' };

  let { shellLoaders, initialShell }: {
    shellLoaders: Record<'phone' | 'panel', () => Promise<ShellModule>>;
    initialShell: ShellModule;
  } = $props();

  initLocale();
  initTheme();
  initDeviceManager();
  initUiMode();
  onDestroy(destroyUiMode);

  let NotificationLayerComponent = $state<Component | null>(null);
  let PlayerLayerComponent = $state<Component | null>(null);
  let configuredRoomSensorIds = $state((): string[] => []);

  onMount(() => {
    let cancelled = false;
    let secondFrame = 0;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        // Ein eigener Task nach einem vollständig abgeschlossenen Paint: Shared
        // Config/Auth zuerst, dann HA und erst danach optionale Datenquellen.
        timer = window.setTimeout(() => {
          void import('./lib/state/startup-background.ts')
            .then(({ startBackgroundRuntime }) => startBackgroundRuntime(() => cancelled))
            .then((layers) => {
              if (!layers) return;
              NotificationLayerComponent = layers.notificationLayer;
              PlayerLayerComponent = layers.playerLayer;
              configuredRoomSensorIds = layers.configuredRoomSensorIds;
            })
            .catch(() => {});
        }, 0);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(timer);
    };
  });

  /* ADR-006: Abo auf den sichtbaren Screen verengen. Die im Raum-Overlay
     gewählten Temperatur-/Feuchtesensoren stehen nicht in der Haushalts-Config
     und kommen hier dazu — sonst bekämen sie nie einen Wert. */
  $effect(() => {
    runtime.setVisible(visibleEntityIds(nav.screen).concat(configuredRoomSensorIds()));
  });

  const initialShellSnapshot = untrack(() => initialShell);
  let ShellComponent = $state<Component | null>(initialShellSnapshot.default);
  let loadedShellKind = $state<ShellModule['shellKind'] | null>(initialShellSnapshot.shellKind);
  let shellLoadFailed = $state(false);
  const shellLoader = createLatestShellLoader<ShellModule>({
    phone: () => shellLoaders.phone(),
    panel: () => shellLoaders.panel(),
  });

  $effect(() => {
    const mode = uiMode.effective;
    document.documentElement.dataset.uiMode = mode;
    const expectedKind = `hmi-shell:${mode}` as ShellModule['shellKind'];
    if (ShellComponent && loadedShellKind === expectedKind) return;
    shellLifecycle.prepareChange();
    ShellComponent = null;
    loadedShellKind = null;
    shellLoadFailed = false;
    void shellLoader.load(mode, (loaded) => {
      if (loaded.shellKind !== expectedKind) return;
      loadedShellKind = loaded.shellKind;
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

{#if NotificationLayerComponent}<NotificationLayerComponent />{/if}
{#if PlayerLayerComponent}<PlayerLayerComponent />{/if}
