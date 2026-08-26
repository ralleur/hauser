<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { appState } from '../state/app.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { WIDTH_PRESETS, type LayoutSlotId } from '../state/layout-config.ts';
  import { tick } from 'svelte';

  let dialog = $state<HTMLElement>();
  let previouslyFocused: HTMLElement | null = null;
  let wasOpen = false;

  $effect(() => {
    if (layoutManager.open && !wasOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      layoutManager.reconcileRooms(appState.rooms.map((room) => room.id));
      void tick().then(() => dialog?.focus());
    } else if (!layoutManager.open && wasOpen) {
      void tick().then(() => previouslyFocused?.focus());
    }
    wasOpen = layoutManager.open;
  });

  function closeOnScrim(event: MouseEvent) {
    if (event.target === event.currentTarget) layoutManager.cancel();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      layoutManager.cancel();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
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

  function roomForNewSlot(): string | null {
    const fallbackRoomId = appState.rooms[0]?.id ?? null;
    const occupied = new Set(layoutManager.draft.slots.map((slot) => slot.roomId ?? fallbackRoomId));
    return appState.rooms.find((room) => !occupied.has(room.id))?.id ?? fallbackRoomId;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if layoutManager.open}
  <div class="layout-dialog-scrim" role="presentation" onclick={closeOnScrim}>
    <div class="layout-dialog" role="dialog" aria-modal="true" aria-labelledby="layout-dialog-title"
         tabindex="-1" bind:this={dialog}>
      <header class="layout-dialog-head">
        <div>
          <span class="caps-label">Home &amp; Energie</span>
          <h2 id="layout-dialog-title">{m.layout_title()}</h2>
        </div>
        <button class="dialog-close pressable" type="button" aria-label={m.layout_close()}
                onclick={() => layoutManager.cancel()}>×</button>
      </header>

      <div class="layout-config-section">
        <h3>Kontrollflächen (Home)</h3>
        <div class="layout-slot-settings">
          {#each layoutManager.draft.slots as slot, index (slot.id)}
            <label>
              <span>Fläche {index + 1} · Raumkontext</span>
              <select value={slot.roomId ?? ''}
                      onchange={(event) => layoutManager.setRoom(slot.id as LayoutSlotId, event.currentTarget.value || null)}>
                {#each appState.rooms as room (room.id)}
                  <option value={room.id}>{room.name}</option>
                {/each}
              </select>
            </label>
          {/each}
        </div>
        {#if layoutManager.draft.slots.length === 1}
          <button class="secondary-btn pressable" type="button"
                  onclick={() => layoutManager.addSlot(roomForNewSlot())}>{m.layout_add_second()}</button>
        {:else}
          <button class="secondary-btn danger-btn pressable" type="button"
                  onclick={() => layoutManager.removeSlot()}>{m.layout_remove_second()}</button>
        {/if}
      </div>

      <fieldset class="layout-config-section">
        <legend>Breite anpassen (Home &amp; Energie)</legend>
        <div class="width-presets">
          {#each WIDTH_PRESETS as preset (preset.id)}
            <label class:is-selected={layoutManager.draft.widthPreset === preset.id}>
              <input type="radio" name="layout-width" value={preset.id}
                     checked={layoutManager.draft.widthPreset === preset.id}
                     onchange={() => layoutManager.setWidth(preset.id)} />
              <strong>{preset.label}</strong>
              <small>{preset.slotMinPx}px Mindestbreite · Hero mindestens {preset.heroMinPx}px</small>
            </label>
          {/each}
        </div>
      </fieldset>

      <footer class="layout-dialog-actions">
        <button class="text-btn pressable" type="button" onclick={() => layoutManager.reset()}>{m.layout_reset()}</button>
        <span class="dialog-action-spacer"></span>
        <button class="secondary-btn pressable" type="button" onclick={() => layoutManager.cancel()}>{m.layout_cancel()}</button>
        <button class="primary-btn pressable" type="button" onclick={() => layoutManager.apply()}>{m.layout_apply()}</button>
      </footer>
    </div>
  </div>
{/if}
