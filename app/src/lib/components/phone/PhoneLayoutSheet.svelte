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
  import Icon from '../Icon.svelte';
  import { dragreorder } from '../../actions/dragreorder.ts';
  import { openCentralClimateEdit } from '../../state/overlay.svelte.ts';
  import {
    QUICK_FIELDS, addQuickItem, canAddQuick, moveQuickItem, quickBarItems, quickEdit, removeQuickItem, resetQuickBar,
    usedFields, type QuickItem, type QuickKind,
  } from '../../state/phone-quick-bar.svelte.ts';

  /* Die vier Felder der Schnellaktions-Leiste (wie die iOS-App): belegt in
     Gold, jede Belegung eine Zeile mit Griff und Minus, darunter was noch
     passt. Ein Tipp auf die Zeile öffnet, was dahinter liegt. */
  const quickItems = $derived(quickBarItems());
  const used = $derived(usedFields(quickItems));
  let quickListEl = $state<HTMLElement>();
  const ADD_OPTIONS: { kind: QuickKind; label: () => string }[] = [
    { kind: 'off', label: () => m.quick_off() },
    { kind: 'climate', label: () => m.quick_add_climate() },
    { kind: 'climateCompact', label: () => m.quick_climate_compact() },
    { kind: 'action', label: () => m.quick_action() },
  ];
  const addable = $derived(ADD_OPTIONS.filter((option) => canAddQuick(quickItems, option.kind)));
  function quickTitle(item: QuickItem): string {
    if (item.kind === 'off') return m.quick_off();
    if (item.kind === 'climate') return m.quick_climate();
    if (item.kind === 'climateCompact') return m.quick_climate_compact();
    return item.name || m.quick_action();
  }
  function quickMeta(item: QuickItem): string {
    if (item.kind === 'off') return m.quick_meta_off();
    if (item.kind === 'climate') return m.quick_meta_climate();
    if (item.kind === 'climateCompact') return m.quick_meta_compact();
    const steps = item.steps.length === 0 ? m.quick_meta_empty() : item.steps.length === 1 ? m.quick_meta_step() : m.quick_meta_steps({ count: String(item.steps.length) });
    return `${m.quick_meta_off()} · ${steps}`;
  }
  function quickIcon(item: QuickItem): string {
    if (item.kind === 'off') return 'i-power';
    if (item.kind === 'climate') return 'i-plus-minus';
    if (item.kind === 'climateCompact') return 'i-thermometer';
    return item.icon;
  }
  function openQuick(item: QuickItem): void {
    if (item.kind === 'action') quickEdit.id = item.id;
    else if (item.kind === 'climate' || item.kind === 'climateCompact') openCentralClimateEdit();
  }
  function addQuick(kind: QuickKind): void {
    const item = addQuickItem(kind);
    /* Ein neuer Knopf ist leer — gleich belegen, statt ihn erst suchen zu müssen. */
    if (item && kind === 'action') quickEdit.id = item.id;
  }

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
        <button class="pls-reset pressable" type="button" onclick={() => { resetPhoneLayout(); resetQuickBar(); }}>{m.layout_default()}</button>
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

    {#if phoneLayout.quickActions}
      <div class="pls-row pls-quick">
        <div class="pls-fields" aria-hidden="true">
          {#each Array.from({ length: QUICK_FIELDS }, (_, index) => index) as field (field)}
            <span class="pls-field" class:is-used={field < used}></span>
          {/each}
        </div>
        <p class="pls-quick-count">{m.quick_fields_used({ used: String(used), all: String(QUICK_FIELDS) })}</p>
        <ul class="pls-quick-list" bind:this={quickListEl}>
          {#each quickItems as item (item.id)}
            <li class="pls-quick-row" data-reorder-row={item.id}>
              <button class="cfg-handle" type="button" aria-label={quickTitle(item)} disabled={quickItems.length < 2}
                      use:dragreorder={{ id: item.id, list: () => quickListEl, enabled: quickItems.length > 1, onReorder: moveQuickItem }}>
                <Icon name="i-dots-grid" cls="icon icon-sm" />
              </button>
              <button class="pls-quick-open pressable" type="button" onclick={() => openQuick(item)}>
                <span class="pls-quick-icon is-{item.kind}" aria-hidden="true"><Icon name={quickIcon(item)} cls="icon icon-md" /></span>
                <span class="pls-quick-label">
                  <span>{quickTitle(item)}</span>
                  <small>{quickMeta(item)}</small>
                </span>
              </button>
              <button class="pls-quick-remove pressable" type="button" aria-label={m.quick_remove()} onclick={() => removeQuickItem(item.id)}>
                <Icon name="i-minus" cls="icon icon-sm" />
              </button>
            </li>
          {/each}
        </ul>
        {#if addable.length === 0}
          <p class="pls-quick-count">{m.quick_full()}</p>
        {:else}
          <div class="pls-quick-add">
            {#each addable as option (option.kind)}
              <button class="pls-quick-chip pressable" type="button" onclick={() => addQuick(option.kind)}>
                <Icon name="i-plus" cls="icon icon-sm" />{option.label()}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
