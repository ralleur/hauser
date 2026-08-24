<script lang="ts">
  /* ── Admin-PIN im bestehenden Hauser-Stil ──
     Bewusst eigenständig gestylt: dieser Dialog erscheint auch auf der
     neutralen Fläche, die das globale App-Stylesheet gar nicht lädt. */
  import { m } from '../../paraglide/messages.js';
  import { hotelSession, unlockHotelAdmin } from '../state/hotel-session.svelte.ts';
  import { appendPinDigit, deletePinDigit, pinReadyToSubmit } from '../hotel-mode-ui.ts';

  let { onUnlocked, onCancel }: { onUnlocked: () => void; onCancel: () => void } = $props();

  let pin = $state('');

  const feedback = $derived.by(() => {
    switch (hotelSession.feedback) {
      case 'mismatch': return m.hotel_pin_wrong();
      case 'rate-limited': return m.hotel_pin_wait();
      case 'not-configured': return m.hotel_pin_missing();
      case 'unavailable': return m.hotel_pin_unavailable();
      default: return '';
    }
  });

  function press(digit: string): void {
    pin = appendPinDigit(pin, digit);
  }

  async function submit(): Promise<void> {
    if (!pinReadyToSubmit(pin) || hotelSession.busy) return;
    const unlocked = await unlockHotelAdmin(pin);
    pin = '';
    if (unlocked) onUnlocked();
  }
</script>

<div class="hotel-pin" role="dialog" aria-modal="true" aria-label={m.hotel_admin_title()} data-testid="hotel-pin-pad">
  <h2>{m.hotel_admin_title()}</h2>

  <div class="hotel-pin__dots" aria-hidden="true">
    {#each Array.from({ length: Math.max(pin.length, 6) }) as _, index}
      <span class="hotel-pin__dot" class:is-filled={index < pin.length}></span>
    {/each}
  </div>

  <p class="hotel-pin__feedback" role="status" aria-live="polite">{feedback}</p>

  <div class="hotel-pin__grid">
    {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as digit}
      <button type="button" class="hotel-pin__key" onclick={() => press(digit)}>{digit}</button>
    {/each}
    <button type="button" class="hotel-pin__key is-quiet" onclick={() => { pin = deletePinDigit(pin); }}
            aria-label={m.hotel_pin_delete()}>←</button>
    <button type="button" class="hotel-pin__key" onclick={() => press('0')}>0</button>
    <button type="button" class="hotel-pin__key is-primary" disabled={!pinReadyToSubmit(pin) || hotelSession.busy}
            onclick={submit}>{m.hotel_pin_confirm()}</button>
  </div>

  <button type="button" class="hotel-pin__cancel" onclick={onCancel}>{m.hotel_pin_cancel()}</button>
</div>

<style>
  .hotel-pin {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-6);
    border-radius: var(--radius-2xl);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    font-family: var(--font-family);
  }

  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--font-weight-semibold);
  }

  .hotel-pin__dots {
    display: flex;
    gap: var(--space-2);
    min-height: 12px;
  }

  .hotel-pin__dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
  }

  .hotel-pin__dot.is-filled {
    background: var(--color-text-primary);
    border-color: var(--color-text-primary);
  }

  .hotel-pin__feedback {
    margin: 0;
    min-height: var(--text-base);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-align: center;
  }

  .hotel-pin__grid {
    display: grid;
    grid-template-columns: repeat(3, 72px);
    gap: var(--space-3);
  }

  .hotel-pin__key {
    height: 64px;
    border-radius: var(--radius-xl);
    border: 1px solid var(--color-border);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-family: var(--font-family);
    font-size: var(--text-md);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .hotel-pin__key:active { transform: scale(0.96); }

  .hotel-pin__key.is-quiet { color: var(--color-text-secondary); }

  .hotel-pin__key.is-primary {
    font-size: var(--text-xs);
    background: var(--color-accent-cool);
    border-color: var(--color-accent-cool);
    color: var(--color-text-on-accent);
  }

  .hotel-pin__key:disabled { opacity: 0.4; }

  .hotel-pin__cancel {
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-family);
    font-size: var(--text-xs);
  }
</style>
