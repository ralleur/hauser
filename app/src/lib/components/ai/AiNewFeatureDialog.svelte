<script lang="ts">
  import { tick } from 'svelte';
  import {
    aiChat,
    chooseContinueFeature,
    chooseNewSession,
  } from '../../state/ai-customizing.svelte.ts';

  let dialog = $state<HTMLElement>();
  let previouslyFocused: HTMLElement | null = null;
  let wasOpen = false;

  const open = $derived(!!aiChat.pendingChoice);

  $effect(() => {
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      void tick().then(() => dialog?.focus());
    } else if (!open && wasOpen) {
      void tick().then(() => previouslyFocused?.focus());
    }
    wasOpen = open;
  });

  /* Abbrechen = Dialog schließen, nichts senden — die Rückfrage des Agenten
     bleibt im Verlauf stehen und der Nutzer kann neu formulieren. */
  function dismiss(): void {
    aiChat.pendingChoice = null;
  }

  function closeOnScrim(event: MouseEvent): void {
    if (event.target === event.currentTarget) dismiss();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Escape') {
      dismiss();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if aiChat.pendingChoice}
  <div class="layout-dialog-scrim" role="presentation" onclick={closeOnScrim}>
    <div class="layout-dialog ai-choice-dialog" role="dialog" aria-modal="true"
         aria-labelledby="ai-choice-title" tabindex="-1" bind:this={dialog}>
      <header class="layout-dialog-head">
        <div>
          <span class="caps-label">AI Customizing</span>
          <h2 id="ai-choice-title">Das klingt nach einem neuen Feature</h2>
        </div>
        <button class="dialog-close pressable" type="button" aria-label="Dialog schließen"
                onclick={dismiss}>×</button>
      </header>

      <p class="ai-choice-text">
        Der Agent hält „{aiChat.pendingChoice.name}" für ein eigenes Feature.
        Eine neue Session dafür starten — oder doch „{aiChat.pendingChoice.current}" weiter anpassen?
      </p>

      <div class="ai-choice-actions">
        <button class="primary-btn pressable" type="button" onclick={() => chooseNewSession()}>
          Neue Session „{aiChat.pendingChoice.name}" starten
        </button>
        <button class="secondary-btn pressable" type="button" onclick={() => chooseContinueFeature()}>
          „{aiChat.pendingChoice.current}" weiter anpassen
        </button>
      </div>
    </div>
  </div>
{/if}
