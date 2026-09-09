<script lang="ts">
  import { tokenDuration } from '../../motion/index.ts';
  import { onMount } from 'svelte';
  import type { ScreenId } from '../../state/nav.svelte.ts';
  import {
    PHONE_NAV_REORDERABLE, navTargetLabel, navTargetForScreen, phoneNavOrder,
    type PhoneNavTarget,
  } from '../../state/phone-nav-order.svelte.ts';
  import { phoneTargetVisible } from '../../state/module-config.svelte.ts';
  import { wrappedFocusIndex, type LayerCloseReason } from '../../state/phone-navigation.svelte.ts';
  import PhoneNavIcon from './PhoneNavIcon.svelte';
  import { SHEET_SWIPE_IGNORE, swipedown } from '../../actions/swipedown.ts';
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

  /* Abgeschaltete Module fallen sofort heraus; die gespeicherte Reihenfolge
     bleibt bestehen. */
  const visibleOrder = $derived(phoneNavOrder.order.filter((id) => phoneTargetVisible(id)));

  let dialog: HTMLElement;
  let arranging = $state(false);
  /* Der Editor kommt erst auf Zuruf: er waere sonst Teil des Startpfads. */
  let ArrangeComponent = $state<typeof import('./PhoneNavArrange.svelte').default | null>(null);

  async function startArranging(): Promise<void> {
    arranging = true;
    ArrangeComponent ??= (await import('./PhoneNavArrange.svelte')).default;
  }

  function scrimExit(node: HTMLElement) {
    const reducedMotion = prefersReducedMotion();
    return {
      duration: reducedMotion ? 0 : tokenDuration(node, 'normal'),
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
      duration: reducedMotion ? 0 : tokenDuration(node, 'normal'),
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

  /* Der Fokus landet auf dem Dialog selbst, nicht auf der ersten Zeile: sonst
     legt der Browser seinen Fokusrahmen um einen Eintrag, den niemand
     ausgewählt hat. Die Tab-Falle unten hält ihn trotzdem im Sheet. */
  onMount(() => {
    dialog?.focus({ preventScroll: true });
  });
</script>

<div class="more-sheet-scrim" role="presentation" onclick={scrim} onoutroend={outerOutroEnd} out:scrimExit>
  <div class="more-sheet" class:is-arranging={arranging} bind:this={dialog} role="dialog" aria-modal="true"
       aria-labelledby="more-sheet-title" tabindex="-1" onkeydown={onkeydown} out:sheetExit
       use:swipedown={{ onSwipe: () => onclose('close'), surface: () => dialog,
                        atTop: (t) => Boolean(t?.closest('.more-sheet-grip, .more-sheet header'))
                                      || (dialog?.scrollTop ?? 0) <= 0,
                        ignore: SHEET_SWIPE_IGNORE }}>
    <!-- Der Griff sagt, wohin das Sheet geht: nach unten weg. Wischen gilt auf
         der ganzen Fläche, solange die Liste oben steht. -->
    <span class="more-sheet-grip" aria-hidden="true"></span>

    {#if !arranging}
      <header>
        <div class="more-sheet-heading">
          <h2 id="more-sheet-title">{m.nav_more()}</h2>
          <p class="more-sheet-subtitle">{m.phone_more_subtitle()}</p>
        </div>
        {#if PHONE_NAV_REORDERABLE}
          <button class="more-sheet-action pressable" type="button"
                  aria-label={m.phone_arrange_start()} onclick={startArranging}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
          </button>
        {/if}
      </header>

      <!-- Alles an einem Ort: die Liste zeigt auch, was unten schon steht —
           wer hier sucht, will nicht erst wissen, wo etwas hängt. -->
      <div class="more-sheet-list">
        {#each visibleOrder as id (id)}
          <button class="more-sheet-target pressable" type="button"
                  aria-current={navTargetForScreen(current) === id ? 'page' : undefined}
                  onclick={() => onselect(id)}>
            <span class="more-sheet-target-icon"><PhoneNavIcon {id} /></span>
            <span>{navTargetLabel(id)}</span>
            <svg class="more-sheet-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        {/each}
      </div>
    {:else}
      {#if ArrangeComponent}
        {@const Arrange = ArrangeComponent}
        <Arrange visibleOrder={visibleOrder} ondone={() => (arranging = false)} />
      {:else}
        <p class="more-arrange-loading" role="status">{m.phone_view_preparing()}</p>
      {/if}
    {/if}
  </div>
</div>
