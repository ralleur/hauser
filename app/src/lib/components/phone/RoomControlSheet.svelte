<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { onDestroy, onMount } from 'svelte';
  import RoomControls from '../RoomControls.svelte';
  import type { Room } from '../../state/app.svelte.ts';
  import { closeDeviceDetail, deviceDetail } from '../../state/overlay.svelte.ts';
  import { closeSceneEdit, sceneEdit } from '../../state/scene-manager.svelte.ts';
  import { createRetryableLazyLoader } from '../../state/lazy-loader.ts';
  import { wrappedFocusIndex, type LayerCloseReason } from '../../state/phone-navigation.svelte.ts';

  let {
    room,
    onclose,
    onouteroutroend,
  }: {
    room: Room;
    onclose: (reason: Exclude<LayerCloseReason, 'back' | 'unmount' | 'navigation' | 'selection'>) => void;
    onouteroutroend: () => void;
  } = $props();

  let dialog: HTMLElement;
  let title: HTMLHeadingElement;
  type NestedLayerId = 'device' | 'scene';
  const nestedLayerLoader = createRetryableLazyLoader({
    device: () => import('../DeviceDetail.svelte'),
    scene: () => import('../SceneEdit.svelte'),
  });
  let nestedLayerRetries = $state<Record<NestedLayerId, number>>({ device: 0, scene: 0 });

  function loadNestedLayer(id: NestedLayerId, _retryVersion: number) {
    return nestedLayerLoader.load(id);
  }

  function retryNestedLayer(id: NestedLayerId): void {
    nestedLayerRetries[id] += 1;
  }

  function closeNestedLayer(id: NestedLayerId): void {
    if (id === 'device') closeDeviceDetail(true);
    else closeSceneEdit(true);
  }

  function prefersReducedMotion(): boolean {
    try {
      return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  function tokenDuration(node: HTMLElement, token: string): number {
    const value = getComputedStyle(node).getPropertyValue(token).trim();
    if (value.endsWith('ms')) return Number.parseFloat(value) || 0;
    if (value.endsWith('s')) return (Number.parseFloat(value) || 0) * 1000;
    return 0;
  }

  function scrimExit(node: HTMLElement) {
    return {
      duration: prefersReducedMotion() ? 0 : tokenDuration(node, '--duration-normal'),
      css: (t: number) => `opacity:${t}`,
    };
  }

  function sheetExit(node: HTMLElement) {
    const reducedMotion = prefersReducedMotion();
    return {
      duration: reducedMotion ? 0 : tokenDuration(node, '--duration-normal'),
      css: reducedMotion
        ? (t: number) => `opacity:${t}`
        : (t: number) => `opacity:${t};transform:translateY(${(1 - t) * 100}%)`,
    };
  }

  function focusable(): HTMLElement[] {
    return dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      : [];
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose('escape');
      return;
    }
    if (event.key !== 'Tab') return;
    const targets = focusable();
    if (targets.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const index = targets.indexOf(document.activeElement as HTMLElement);
    const next = wrappedFocusIndex(index, targets.length, event.shiftKey);
    if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === targets.length - 1)) {
      event.preventDefault();
      targets[next]?.focus();
    }
  }

  function scrim(event: MouseEvent) {
    if (event.target !== event.currentTarget) return;
    onclose('scrim');
  }

  function outerOutroEnd(event: CustomEvent<null>) {
    if (event.target !== event.currentTarget) return;
    onouteroutroend();
  }

  onMount(() => title.focus({ preventScroll: true }));
  onDestroy(() => {
    // Diese Overlays können nur aus den lazy geladenen Raum-Controls geöffnet
    // werden. Ihre Zustände bleiben deshalb in derselben optionalen Closure und
    // werden beim Schließen des Room-Sheets gemeinsam aufgeräumt.
    closeDeviceDetail(true);
    closeSceneEdit(true);
  });
</script>

{#snippet nestedLayerLoadState(id: NestedLayerId, failed: boolean)}
  <div class="light-detail is-open">
    <div class="overlay-scrim" role="presentation"></div>
    <div class="light-detail-panel overlay-panel" role="dialog" aria-modal="true" aria-label={m.phone_area_loading_label()}>
      {#if failed}
        <p role="alert">{m.phone_area_failed()}</p>
        <button class="secondary-btn pressable" type="button" onclick={() => retryNestedLayer(id)}>{m.library_retry()}</button>
        <button class="secondary-btn pressable" type="button" onclick={() => closeNestedLayer(id)}>{m.common_close()}</button>
      {:else}
        <p role="status" aria-live="polite">{m.phone_area_loading()}</p>
      {/if}
    </div>
  </div>
{/snippet}

<div class="room-sheet-scrim" role="presentation" onclick={scrim} onoutroend={outerOutroEnd} out:scrimExit>
  <div class="room-sheet" bind:this={dialog} role="dialog" aria-modal="true" aria-labelledby="room-sheet-title" tabindex="-1" onkeydown={onkeydown} out:sheetExit>
    <header class="room-sheet-header">
      <div>
        <p class="phone-home-kicker">{m.phone_room_control()}</p>
        <h2 bind:this={title} id="room-sheet-title" tabindex="-1">{room.name}</h2>
      </div>
      <button class="room-sheet-close pressable" type="button" aria-label={m.phone_close_room({ room: room.name })} onclick={() => onclose('close')}>
        <span aria-hidden="true">×</span>
      </button>
    </header>

    <div class="room-sheet-scroll">
      <!-- 1:1 die Tablet-Seitenleiste: gleiche Controls, gleiche Long-Press-
           Gesten und Overlays (Geräte-Detail, Szenen-Editor) — eine Erfahrung
           aus einem Guss auf beiden Shells. -->
      <RoomControls {room} />
    </div>
  </div>
</div>

{#if deviceDetail.mode !== 'hidden'}
  {#await loadNestedLayer('device', nestedLayerRetries.device)}
    {@render nestedLayerLoadState('device', false)}
  {:then loaded}
    {@const DeviceDetail = loaded.default}
    <DeviceDetail />
  {:catch}
    {@render nestedLayerLoadState('device', true)}
  {/await}
{/if}
{#if sceneEdit.mode !== 'hidden'}
  {#await loadNestedLayer('scene', nestedLayerRetries.scene)}
    {@render nestedLayerLoadState('scene', false)}
  {:then loaded}
    {@const SceneEdit = loaded.default}
    <SceneEdit />
  {:catch}
    {@render nestedLayerLoadState('scene', true)}
  {/await}
{/if}
