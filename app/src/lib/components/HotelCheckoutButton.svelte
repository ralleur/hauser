<script lang="ts">
  /* ── Gast-Checkout ──
     Ein dezenter Einstieg, ein eindeutiger Bestätigungsdialog, danach sofort
     eine neutrale Fläche. Der Gast kann das nicht rückgängig machen — deshalb
     die ausdrückliche Rückfrage. Nach dem Erfolg wird neu geladen: der
     Hotel-Bootstrap setzt die Oberfläche dann auf den neutralen Zustand. */
  import { m } from '../../paraglide/messages.js';
  import {
    askHotelCheckout,
    cancelHotelCheckout,
    confirmHotelCheckout,
    hotelCheckout,
  } from '../state/hotel-checkout.svelte.ts';

  let { onCheckedOut = () => location.reload() }: { onCheckedOut?: () => void } = $props();

  async function confirm(): Promise<void> {
    if (await confirmHotelCheckout()) onCheckedOut();
  }
</script>

{#if hotelCheckout.phase !== 'done'}
  <div class="hotel-checkout" data-testid="hotel-checkout">
    <button type="button" class="hotel-checkout__entry" onclick={askHotelCheckout}
            data-testid="hotel-checkout-entry">
      {m.hotel_checkout_action()}
    </button>
  </div>
{/if}

{#if hotelCheckout.phase === 'confirming' || hotelCheckout.phase === 'sending' || hotelCheckout.phase === 'failed'}
  <div class="hotel-checkout__backdrop">
    <div class="hotel-checkout__dialog" role="dialog" aria-modal="true"
         aria-label={m.hotel_checkout_confirm_title()}>
      <h2>{m.hotel_checkout_confirm_title()}</h2>
      <p>{m.hotel_checkout_confirm_hint()}</p>
      {#if hotelCheckout.phase === 'failed'}
        <p class="hotel-checkout__error" role="alert">{m.hotel_checkout_failed()}</p>
      {/if}
      <div class="hotel-checkout__actions">
        <button type="button" class="hotel-checkout__cancel" onclick={cancelHotelCheckout}
                disabled={hotelCheckout.phase === 'sending'}>{m.hotel_checkout_cancel()}</button>
        <button type="button" class="hotel-checkout__confirm" onclick={confirm}
                disabled={hotelCheckout.phase === 'sending'}
                data-testid="hotel-checkout-confirm">{m.hotel_checkout_confirm()}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .hotel-checkout {
    position: fixed;
    right: max(var(--space-4), env(safe-area-inset-right));
    bottom: max(var(--space-4), env(safe-area-inset-bottom));
    z-index: 40;
  }

  .hotel-checkout__entry {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-family: var(--font-family);
    font-size: var(--text-2xs);
  }

  .hotel-checkout__backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-surface-0) 82%, transparent);
  }

  .hotel-checkout__dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 34ch;
    padding: var(--space-6);
    border-radius: var(--radius-2xl);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-family: var(--font-family);
  }

  .hotel-checkout__dialog h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--font-weight-semibold);
  }

  .hotel-checkout__dialog p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .hotel-checkout__error { color: var(--color-error); }

  .hotel-checkout__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .hotel-checkout__cancel,
  .hotel-checkout__confirm {
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    font-family: var(--font-family);
    font-size: var(--text-xs);
  }

  .hotel-checkout__cancel {
    background: none;
    color: var(--color-text-secondary);
  }

  .hotel-checkout__confirm {
    background: var(--color-accent-warm);
    border-color: var(--color-accent-warm);
    color: var(--color-text-on-accent);
  }

  .hotel-checkout__cancel:disabled,
  .hotel-checkout__confirm:disabled { opacity: 0.5; }
</style>
