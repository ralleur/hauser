<script lang="ts">
  import { onMount } from 'svelte';
  import type { ScreenId } from '../../state/nav.svelte.ts';
  import { PHONE_NAV_REORDERABLE, moveNavTarget, navTargetLabel, navTargetForScreen, phoneNavOrder, type PhoneNavTarget } from '../../state/phone-nav-order.svelte.ts';
  import { wrappedFocusIndex, type LayerCloseReason } from '../../state/phone-navigation.svelte.ts';
  import PhoneNavIcon from './PhoneNavIcon.svelte';
  import { m } from '../../../paraglide/messages.js';

  let {
    current,
    onclose,
    onselect,
    onouteroutroend,
  }: {
    current: ScreenId;
    onclose: (reason: Exclude<LayerCloseReason, 'back' | 'unmount' | 'navigation' | 'selection'>) => void;
    onselect: (target: PhoneNavTarget) => void;
    onouteroutroend: () => void;
  } = $props();

  let dialog: HTMLElement;
  let firstTarget = $state<HTMLButtonElement>();
  let arranging = $state(false);

  function rememberFirstTarget(node: HTMLButtonElement) {
    if (!firstTarget) firstTarget = node;
    return { destroy: () => { if (firstTarget === node) firstTarget = undefined; } };
  }

  function tokenDuration(node: HTMLElement, token: string): number {
    const value = getComputedStyle(node).getPropertyValue(token).trim();
    if (value.endsWith('ms')) return Number.parseFloat(value) || 0;
    if (value.endsWith('s')) return (Number.parseFloat(value) || 0) * 1000;
    return 0;
  }

  function scrimExit(node: HTMLElement) {
    const reducedMotion = prefersReducedMotion();
    return {
      duration: reducedMotion ? 0 : tokenDuration(node, '--duration-normal'),
      css: (t: number) => `opacity:${t}`,
    };
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
    if (!dialog) return [];
    return [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute('hidden'));
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

  onMount(() => {
    firstTarget?.focus({ preventScroll: true });
  });
</script>

<div class="more-sheet-scrim" role="presentation" onclick={scrim} onoutroend={outerOutroEnd} out:scrimExit>
  <div class="more-sheet" bind:this={dialog} role="dialog" aria-modal="true" aria-labelledby="more-sheet-title" tabindex="-1" onkeydown={onkeydown} out:sheetExit>
    <header>
      <h2 id="more-sheet-title">{m.nav_more()}</h2>
      <div class="more-sheet-header-actions">
        {#if PHONE_NAV_REORDERABLE}
          <button class="more-sheet-action more-arrange-toggle pressable" type="button"
                  aria-label={arranging ? m.phone_arrange_end() : m.phone_arrange_start()}
                  aria-pressed={arranging} onclick={() => (arranging = !arranging)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5-5 5 5M17 15l-5 5-5-5" /></svg>
          </button>
        {/if}
        <button class="more-sheet-action more-sheet-close pressable" type="button" aria-label={m.phone_more_close()} onclick={() => onclose('close')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19" /></svg>
        </button>
      </div>
    </header>
    {#if !arranging}
      <div class="more-sheet-list">
        {#each phoneNavOrder.order.slice(3) as id (id)}
          <button use:rememberFirstTarget class="more-sheet-target pressable" type="button" aria-current={navTargetForScreen(current) === id ? 'page' : undefined} onclick={() => onselect(id)}>
            <span class="more-sheet-target-icon"><PhoneNavIcon {id} /></span>
            <span>{navTargetLabel(id)}</span>
            <svg class="more-sheet-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        {/each}
      </div>
    {:else}
      <div class="more-sheet-list" aria-label={m.phone_nav_order()}>
        {#each phoneNavOrder.order as id, index (id)}
          <div class="more-arrange-row">
            <span class="more-sheet-target-icon"><PhoneNavIcon {id} /></span>
            <span>{navTargetLabel(id)}</span>
            <span class="more-arrange-actions">
              <button class="more-arrange-btn pressable" type="button" aria-label="{navTargetLabel(id)} nach oben" disabled={index === 0} onclick={() => moveNavTarget(id, -1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg>
              </button>
              <button class="more-arrange-btn pressable" type="button" aria-label="{navTargetLabel(id)} nach unten" disabled={index === phoneNavOrder.order.length - 1} onclick={() => moveNavTarget(id, 1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6" /></svg>
              </button>
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
