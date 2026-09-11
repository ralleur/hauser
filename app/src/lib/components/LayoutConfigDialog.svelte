<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { appState } from '../state/app.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import { DEFAULT_LAYOUT_CONFIG, panelSizeOf, widthPreset } from '../state/layout-config.ts';
  import { swipeleft } from '../actions/swipeleft.ts';
  import { prefersReducedMotion } from '../motion/index.ts';
  import TickScale from './TickScale.svelte';
  import { tick } from 'svelte';

  /* Owner-Entscheidung 2026-09-11: kein Titel, kein Übernehmen, kein
     Abbrechen — jede Einstellung gilt sofort. Der Dialog bleibt rechts und
     fliegt von dort herein, über allem, statt etwas zu verschieben. Zu geht
     er per Wisch nach rechts, Tipp daneben oder Escape; auf geht er auch per
     Wisch von rechts nach links auf der Bühne (HomeScreen). */

  let dialog = $state<HTMLElement>();
  let previouslyFocused: HTMLElement | null = null;
  let wasOpen = false;
  const config = $derived(layoutManager.applied);
  /* Der Dialog behält seine Breite, während der Regler die Seitenleiste
     verstellt: die Vorschau läuft im Panel, nicht im Dialog selbst. */
  const panelWidth = $derived(widthPreset(config).totalPercent);
  const secondSlot = $derived(config.slots[1] ?? null);

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

  function close() {
    layoutManager.hide();
    if (prefersReducedMotion()) layoutManager.finishHide();
  }

  function onAnimationEnd(event: AnimationEvent) {
    if (event.target === event.currentTarget && layoutManager.closing) layoutManager.finishHide();
  }

  function closeOnScrim(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
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
    const occupied = new Set(config.slots.map((slot) => slot.roomId ?? fallbackRoomId));
    return appState.rooms.find((room) => !occupied.has(room.id))?.id ?? fallbackRoomId;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if layoutManager.open}
  <div class="layout-dialog-scrim" class:has-two-slots={config.slots.length === 2}
       role="presentation" onclick={closeOnScrim}>
    <div class="layout-dialog" class:is-closing={layoutManager.closing}
         role="dialog" aria-modal="true" aria-label={m.layout_title()}
         tabindex="-1" bind:this={dialog}
         use:swipeleft={{ onSwipe: close, direction: 'right', angle: 70, enabled: !layoutManager.closing }}
         onanimationend={onAnimationEnd}>
      <!-- Kein Titel: oben rechts steht nur der Weg zurück auf Standard. -->
      <header class="layout-dialog-head">
        <button class="text-btn pressable" type="button"
                onclick={() => layoutManager.reset()}>{m.layout_reset()}</button>
      </header>

      <div class="layout-config-section layout-slider-settings">
          <!-- R30: Vollbild ist der gewohnte Stand (ein Raumbild, Raumauswahl
               in der Kontrollfläche). „Alle Räume" zeigt Kacheln statt Bild und
               gibt die Kontrollfläche ganz den Szenen und Geräten. -->
          <div class="layout-slider-setting">
            <div class="layout-slider-head">
              <span>{m.layout_home_view()}</span>
            </div>
            <div class="choice-pill" role="radiogroup" aria-label={m.layout_home_view()}>
              <button class="choice-seg pressable" type="button" role="radio"
                      aria-checked={config.homeView === 'fullscreen'}
                      onclick={() => layoutManager.setHomeView('fullscreen')}>{m.layout_home_view_fullscreen()}</button>
              <button class="choice-seg pressable" type="button" role="radio"
                      aria-checked={config.homeView === 'rooms'}
                      onclick={() => layoutManager.setHomeView('rooms')}>{m.layout_home_view_rooms()}</button>
            </div>
          </div>

          <div class="layout-slider-setting">
            <div class="layout-slider-head">
              <span>{m.layout_size_adjust()}</span>
              <button class="text-btn pressable" type="button"
                      onclick={() => layoutManager.setPanelSize(DEFAULT_LAYOUT_CONFIG.panelSize)}>{m.layout_default()}</button>
            </div>
            <!-- Dieselbe Leiter wie am Lichtdimmer, nur liegend: Der Regler
                 zeigt seine Schritte, statt sie hinter einem Knopf zu
                 verstecken (Owner-Wunsch 2026-09-06). -->
            <TickScale ariaLabel={m.layout_size_aria()} orientation="horizontal" mode="fill"
                       value={panelSizeOf(config)}
                       min={0} max={100} step={1} keyStep={5}
                       onInput={(value) => layoutManager.setPanelSize(value)}
                       format={() => `${Math.round(panelWidth)}%`} />
          </div>

          <div class="layout-slider-setting">
            <div class="layout-slider-head">
              <span>{m.layout_rooms_per_row()}</span>
              <button class="text-btn pressable" type="button"
                      onclick={() => layoutManager.setRoomsPerRow(DEFAULT_LAYOUT_CONFIG.roomsPerRow)}>{m.layout_default()}</button>
            </div>
            <!-- Vier Werte, vier Sprossen: Hier fällt die Leiter mit den
                 möglichen Werten zusammen, und man sieht sofort, wo man steht. -->
            <TickScale ariaLabel={m.layout_rooms_per_row()} orientation="horizontal" mode="fill"
                       value={config.roomsPerRow}
                       min={1} max={4} step={1} keyStep={1} tickCount={4}
                       onInput={(value) => layoutManager.setRoomsPerRow(Math.round(value))}
                       format={(value) => String(Math.round(value))} />
          </div>

          <!-- Zweite Kontrollfläche: unten, und mit festem Raum — sie zeigt
               dauerhaft den gewählten Raum, die erste bleibt die bewegliche. -->
          {#if secondSlot}
            <div class="layout-slider-setting">
              <div class="layout-slider-head">
                <span>{m.layout_second_room()}</span>
                <button class="text-btn danger-btn pressable" type="button"
                        aria-label={m.layout_remove_second()}
                        onclick={() => layoutManager.removeSlot()}>{m.layout_remove_short()}</button>
              </div>
              <div class="layout-room-choice" role="radiogroup" aria-label={m.layout_second_room()}>
                {#each appState.rooms as room (room.id)}
                  <button class="choice-seg pressable" type="button" role="radio"
                          aria-checked={secondSlot.roomId === room.id}
                          onclick={() => layoutManager.setRoom(secondSlot.id, room.id)}>{room.name}</button>
                {/each}
              </div>
            </div>
          {:else}
            <button class="secondary-btn pressable" type="button"
                    onclick={() => layoutManager.addSlot(roomForNewSlot())}>{m.layout_add_second()}</button>
          {/if}
      </div>
    </div>
  </div>
{/if}
