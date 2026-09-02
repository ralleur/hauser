<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { appState } from '../state/app.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { DEFAULT_LAYOUT_CONFIG, panelSizeOf, widthPreset } from '../state/layout-config.ts';
  import { slider } from '../actions/slider.ts';
  import { tick } from 'svelte';

  let dialog = $state<HTMLElement>();
  let previouslyFocused: HTMLElement | null = null;
  let wasOpen = false;
  /* Der Dialog behält seine Breite, während der Regler die Seitenleiste
     verstellt: die Vorschau läuft links im Panel, nicht im Dialog selbst. */
  const panelWidth = $derived(widthPreset(layoutManager.draft, layoutManager.scope).totalPercent);
  const scopeLabel = $derived(layoutManager.scope === 'energy' ? m.nav_energy() : m.nav_home());
  const roomsSliderValue = $derived((layoutManager.draft.roomsPerRow - 1) / 3 * 100);

  function setRoomsFromSlider(value: number): void {
    layoutManager.setRoomsPerRow(1 + Math.round(value * 3 / 100));
  }

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
  <div class="layout-dialog-scrim" class:has-two-slots={layoutManager.draft.slots.length === 2}
       role="presentation" onclick={closeOnScrim}>
    <div class="layout-dialog" role="dialog" aria-modal="true" aria-labelledby="layout-dialog-title"
         tabindex="-1" bind:this={dialog}>
      <header class="layout-dialog-head">
        <h2 id="layout-dialog-title">{m.layout_title()}</h2>
        <button class="dialog-close pressable" type="button" aria-label={m.layout_close()}
                onclick={() => layoutManager.cancel()}>×</button>
      </header>

      <div class="layout-config-section">
        {#if layoutManager.draft.slots.length === 1}
          <button class="secondary-btn pressable" type="button"
                  onclick={() => layoutManager.addSlot(roomForNewSlot())}>{m.layout_add_second()}</button>
        {:else}
          <button class="secondary-btn danger-btn pressable" type="button"
                  onclick={() => layoutManager.removeSlot()}>{m.layout_remove_second()}</button>
        {/if}
      </div>

      <div class="layout-config-section layout-slider-settings">
          <div class="layout-slider-setting">
            <div class="layout-slider-head">
              <span>{m.layout_size_adjust()} · {scopeLabel}</span>
              <button class="text-btn pressable" type="button"
                      onclick={() => layoutManager.setPanelSize(DEFAULT_LAYOUT_CONFIG.panelSize)}>{m.layout_default()}</button>
            </div>
            <div class="slider" role="slider" tabindex="0" aria-label={m.layout_size_aria()}
                 aria-valuemin="28" aria-valuemax="68" aria-valuenow={Math.round(panelWidth)}
                 use:slider={{
                   value: panelSizeOf(layoutManager.draft, layoutManager.scope),
                   onChange: (value) => layoutManager.setPanelSize(value),
                   format: (value) => `${Math.round(28 + value * 0.4)}%`,
                 }}>
              <div class="slider-track"><div class="slider-fill"></div></div>
              <div class="slider-thumb"></div>
            </div>
          </div>

          <div class="layout-slider-setting">
            <div class="layout-slider-head">
              <span>{m.layout_rooms_per_row()}</span>
              <button class="text-btn pressable" type="button"
                      onclick={() => layoutManager.setRoomsPerRow(DEFAULT_LAYOUT_CONFIG.roomsPerRow)}>{m.layout_default()}</button>
            </div>
            <div class="slider" role="slider" tabindex="0" aria-label={m.layout_rooms_per_row()}
                 aria-valuemin="1" aria-valuemax="4" aria-valuenow={layoutManager.draft.roomsPerRow}
                 use:slider={{
                   value: roomsSliderValue,
                   onChange: setRoomsFromSlider,
                   format: (value) => String(1 + Math.round(value * 3 / 100)),
                 }}>
              <div class="slider-track"><div class="slider-fill"></div></div>
              <div class="slider-thumb"></div>
            </div>
          </div>
      </div>

      <footer class="layout-dialog-actions">
        <button class="text-btn pressable" type="button" onclick={() => layoutManager.reset()}>{m.layout_reset()}</button>
        <span class="dialog-action-spacer"></span>
        <button class="secondary-btn pressable" type="button" onclick={() => layoutManager.cancel()}>{m.layout_cancel()}</button>
        <button class="primary-btn pressable" type="button" onclick={() => layoutManager.apply()}>{m.layout_apply()}</button>
      </footer>
    </div>
  </div>
{/if}
