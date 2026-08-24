<script lang="ts">
  /* ── Admin-Einstieg, Sperren und Inaktivität ──
     Eine eigene, dünne Ebene über jeder Hoteloberfläche. Sie hängt bewusst
     nicht in App.svelte: der neutrale Zustand lädt diese Shell gar nicht, und
     der Gastzustand soll sie nicht kennen müssen.

     Im Gastzustand ist sie ein dezenter, sichtbarer Einstieg — keine geheime
     Geste. Als Admin ist sie das explizite Schloss und der Inaktivitätswächter;
     beim Ende führt ein Neuladen zurück in den Zustand, den der aktuelle
     Aufenthalt vorgibt. */
  import { onMount } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import HotelPinPad from './HotelPinPad.svelte';
  import {
    hotelSession,
    lockHotelAdmin,
    refreshHotelSession,
    startHotelAdminIdleWatch,
  } from '../state/hotel-session.svelte.ts';

  let { unlocked = false, onSurfaceChange = () => location.reload() }:
    { unlocked?: boolean; onSurfaceChange?: () => void } = $props();

  let padOpen = $state(false);

  onMount(() => {
    // Der Bootstrap hat den Zustand bereits ermittelt; der Wächter darf nicht
    // erst auf den Statusabruf warten und solange „abgelaufen" annehmen.
    hotelSession.unlocked = unlocked;
    void refreshHotelSession();
    if (!unlocked) return;
    return startHotelAdminIdleWatch({ onExpired: onSurfaceChange });
  });

  async function lock(): Promise<void> {
    await lockHotelAdmin();
    onSurfaceChange();
  }
</script>

<div class="hotel-admin" data-testid="hotel-admin-layer">
  {#if unlocked}
    <button type="button" class="hotel-admin__entry" onclick={lock} data-testid="hotel-admin-lock">
      {m.hotel_admin_lock()}
    </button>
  {:else}
    <button type="button" class="hotel-admin__entry" onclick={() => { padOpen = true; }}
            data-testid="hotel-admin-entry">
      {m.hotel_admin_entry()}
    </button>
  {/if}
</div>

{#if padOpen}
  <div class="hotel-admin__backdrop">
    <HotelPinPad onUnlocked={onSurfaceChange} onCancel={() => { padOpen = false; }} />
  </div>
{/if}

<style>
  .hotel-admin {
    position: fixed;
    left: max(var(--space-4), env(safe-area-inset-left));
    bottom: max(var(--space-4), env(safe-area-inset-bottom));
    z-index: 40;
  }

  .hotel-admin__entry {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-family: var(--font-family);
    font-size: var(--text-2xs);
  }

  .hotel-admin__backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-surface-0) 82%, transparent);
  }
</style>
