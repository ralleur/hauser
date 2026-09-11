<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Layout-Blatt des Telefon-Home: kommt per Wisch nach links auf dem Raster
     von rechts herein und klebt dabei am Finger — wie die Kontrollfläche des
     Panels (Owner-Entscheidung 2026-09-11). `drag` ist der Fingerstand der
     Geste auf dem Raster (≤ 0), solange sie läuft; danach sagt `open`, wo das
     Blatt hingehört, und die Transition aus den Tokens bringt es dorthin.
     Zu geht es per Wisch nach rechts (ebenfalls am Finger): jeder Zug nach
     rechts lässt es beim Loslassen schnell hinausfliegen, kein Einrasten,
     kein ganzer Weg. Außerdem Tipp daneben, Escape oder das X. Jede
     Einstellung gilt sofort. */
  import { swipeleft } from '../../actions/swipeleft.ts';
  import {
    PHONE_ROOMS_PER_ROW, phoneLayout, resetPhoneLayout, setPhoneQuickActions, setPhoneRoomsPerRow,
  } from '../../state/phone-layout.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  let { open, drag, onclose }: { open: boolean; drag: number | null; onclose: () => void } = $props();
  let dialog = $state<HTMLElement>();
  let width = $state(0);
  let closing = $state(false);
  /* Fingerstand beim Zuziehen (≥ 0). */
  let closeDrag = $state<number | null>(null);
  /* Erster Frame: ohne laufende Geste startet das Blatt außerhalb und fährt
     dann herein, sonst stünde es ohne Bewegung da. */
  let entered = $state(false);
  $effect(() => {
    const frame = requestAnimationFrame(() => { entered = true; });
    return () => cancelAnimationFrame(frame);
  });
  $effect(() => { if (open && entered) dialog?.focus(); });

  const dragging = $derived(drag !== null || closeDrag !== null);
  /* Verschiebung in Pixeln vom eingefahrenen Stand aus (0 = ganz drin). */
  const shift = $derived.by(() => {
    if (closeDrag !== null) return closeDrag;
    if (drag !== null) return Math.max(0, width + drag);
    if (closing || !open || !entered) return width;
    return 0;
  });
  const progress = $derived(width > 0 ? Math.max(0, Math.min(1, 1 - shift / width)) : (open ? 1 : 0));

  function close(): void {
    if (closing) return;
    closing = true;
  }
  function onTransitionEnd(event: TransitionEvent) {
    if (closing && event.target === event.currentTarget && event.propertyName === 'transform') onclose();
  }
  /* Fallback ohne Transition (reduced motion: 0 ms) */
  $effect(() => {
    if (!closing) return;
    const t = setTimeout(onclose, 300);
    return () => clearTimeout(t);
  });
  function onScrim(event: MouseEvent) {
    if (event.target === event.currentTarget) close();
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }
</script>

<div class="more-sheet-scrim phone-layout-scrim" class:is-dragging={dragging} class:is-closing={closing} role="presentation"
     style:opacity={progress} onclick={onScrim}>
  <div class="more-sheet phone-layout-sheet" class:is-dragging={dragging} class:is-closing={closing}
       role="dialog" aria-modal="true" aria-label={m.phone_layout_title()}
       tabindex="-1" bind:this={dialog} bind:clientWidth={width} onkeydown={onKeydown}
       style:transform={`translateX(${shift}px)`} ontransitionend={onTransitionEnd}
       use:swipeleft={{
         onSwipe: close, direction: 'right', move: false, threshold: 12, angle: 70, enabled: open && !closing,
         onDrag: (travel) => { closeDrag = travel; },
         onDragEnd: () => { closeDrag = null; },
       }}>
    <header>
      <div class="more-sheet-heading">
        <h2>{m.phone_layout_title()}</h2>
      </div>
      <div class="more-sheet-header-actions">
        <button class="pls-reset pressable" type="button" onclick={resetPhoneLayout}>{m.layout_default()}</button>
        <button class="more-sheet-action pressable" type="button" aria-label={m.common_close()} onclick={close}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19" /></svg>
        </button>
      </div>
    </header>

    <div class="pls-row">
      <span class="pls-label">{m.layout_rooms_per_row()}</span>
      <div class="pls-pill" role="radiogroup" aria-label={m.layout_rooms_per_row()}>
        {#each PHONE_ROOMS_PER_ROW as value (value)}
          <button class="pls-seg pressable" type="button" role="radio"
                  aria-checked={phoneLayout.roomsPerRow === value}
                  onclick={() => setPhoneRoomsPerRow(value)}>{value}</button>
        {/each}
      </div>
    </div>

    <div class="pls-row is-switch">
      <span class="pls-label" id="phone-quick-actions-label">{m.phone_layout_quick_actions()}</span>
      <button class="pls-switch pressable" type="button" role="switch"
              aria-checked={phoneLayout.quickActions} class:is-on={phoneLayout.quickActions}
              aria-labelledby="phone-quick-actions-label"
              onclick={() => setPhoneQuickActions(!phoneLayout.quickActions)}>
        <span class="pls-switch-knob"></span>
      </button>
    </div>
  </div>
</div>
