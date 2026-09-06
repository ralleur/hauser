<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Rückgängig-Streifen (Paket 6): erscheint nach „Alles aus" und
     Szenenwechsel. Der Befehl ist längst raus — hier steht nur
     fünf Sekunden lang der Rückweg. Erst bei Bedarf geladen, damit der
     Startpfad unberührt bleibt. Der Balken läuft über transform; bei
     `prefers-reduced-motion` steht er still. */
  import { prefersReducedMotion } from '../motion/index.ts';
  import { dismissUndo, runUndo, undoOffer, UNDO_WINDOW_MS, type UndoSubject } from '../state/undo.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  const still = prefersReducedMotion();

  function label(subject: UndoSubject | null): string {
    if (!subject) return '';
    if (subject.kind === 'all-off') return m.undo_all_off();
    return m.undo_scene({ scene: subject.scene ?? '' });
  }
</script>

{#if undoOffer.active}
  {#key undoOffer.deadline}
    <div class="undo-toast" role="status" aria-live="polite" style={`--undo-window:${UNDO_WINDOW_MS}ms`}>
      <span class="undo-label">{label(undoOffer.subject)}</span>
      <button class="primary-btn pressable" type="button" onclick={runUndo}>{m.undo_action()}</button>
      <button class="undo-close pressable" type="button" aria-label={m.common_close()} onclick={dismissUndo}>×</button>
      {#if !still}<span class="undo-bar" aria-hidden="true"></span>{/if}
    </div>
  {/key}
{/if}

<style>
  /* Flächensprache wie die übrigen schwebenden Ebenen: Surface-1, ein Rahmen,
     der Overlay-Schatten. Der Knopf ist der gewöhnliche .primary-btn (Schrift
     auf Fläche invertiert) — kein eigenes Blau, kein eigener Radius. Gold
     trägt allein den ablaufenden Balken: er ist der Interaktionspunkt. */
  .undo-toast {
    position: fixed;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + var(--space-6));
    z-index: 60;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: min(90vw, 32rem);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-2xl);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--elevation-overlay-shadow);
    overflow: hidden;
    transform: translateX(-50%);
    animation: undo-in var(--duration-enter) var(--ease-out) both;
  }

  .undo-label {
    font-size: var(--text-base);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .undo-close {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--touch-min);
    height: var(--touch-min);
    border: none;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-lg);
    line-height: 1;
  }

  /* Restzeit als Balken — nur transform, kein Layout. */
  .undo-bar {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    height: 2px;
    background: var(--color-accent-warm);
    transform-origin: left center;
    animation: undo-drain var(--undo-window) linear both;
  }

  @keyframes undo-in {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  @keyframes undo-drain {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .undo-toast { animation: none; }
  }
</style>
