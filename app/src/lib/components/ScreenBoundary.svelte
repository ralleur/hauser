<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* ── Auffangnetz für Bereiche ──

     Ohne dieses Netz ist ein Fehler beim Aufbau eines Bereichs unsichtbar:
     Svelte bricht den Aufbau ab, der Platzhalter „Ansicht wird geladen" bleibt
     für immer stehen, und die Ursache steht nur in der Browser-Konsole — dort
     sucht sie niemand. Ein Haushalt sieht eine Ansicht, die ewig lädt, und
     kann nicht einmal sagen, was schiefging.

     Hier bekommt der Fehler eine Zeile und einen Knopf. Die Ursache steht im
     Klartext dabei, damit sie sich abschreiben lässt; zusätzlich landet sie
     weiterhin in der Konsole, wo Stapelzeilen und Zeitpunkt hängen. */
  import type { Snippet } from 'svelte';
  import { m } from '../../paraglide/messages.js';

  let { children }: { children: Snippet } = $props();

  function causeOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : '';
  }
</script>

<svelte:boundary onerror={(error) => console.error('[hauser] Bereich konnte nicht aufgebaut werden:', error)}>
  {@render children()}

  {#snippet failed(error, reset)}
    <div class="screen-boundary" role="alert">
      <p class="screen-boundary-title">{m.shell_render_failed()}</p>
      {#if causeOf(error)}<p class="screen-boundary-cause">{causeOf(error)}</p>{/if}
      <button class="secondary-btn pressable" type="button" onclick={reset}>{m.shell_retry()}</button>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .screen-boundary {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-5);
  }

  .screen-boundary-title {
    margin: 0;
    font-size: var(--text-lg);
  }

  /* Die Ursache ist ein technischer Satz und darf wie einer aussehen: kleiner,
     ruhiger, umbrechend — sie soll lesbar sein, nicht dominieren. */
  .screen-boundary-cause {
    margin: 0;
    max-width: 60ch;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
</style>
