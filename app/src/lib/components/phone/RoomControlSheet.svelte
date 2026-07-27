<script lang="ts">
  import { onMount } from 'svelte';
  import RoomControls from '../RoomControls.svelte';
  import type { Room } from '../../state/app.svelte.ts';
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
</script>

<div class="room-sheet-scrim" role="presentation" onclick={scrim} onoutroend={outerOutroEnd} out:scrimExit>
  <div class="room-sheet" bind:this={dialog} role="dialog" aria-modal="true" aria-labelledby="room-sheet-title" tabindex="-1" onkeydown={onkeydown} out:sheetExit>
    <header class="room-sheet-header">
      <div>
        <p class="phone-home-kicker">Raumsteuerung</p>
        <h2 bind:this={title} id="room-sheet-title" tabindex="-1">{room.name}</h2>
      </div>
      <button class="room-sheet-close pressable" type="button" aria-label={`${room.name} schließen`} onclick={() => onclose('close')}>
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
