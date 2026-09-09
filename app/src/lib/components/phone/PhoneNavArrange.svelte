<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Editor der unteren Leiste — laedt erst, wenn jemand ihn oeffnet: der
     Startpfad des Telefons traegt sonst Markup, Griff-Geste und Texte mit, die
     die meisten Sitzungen nie brauchen. */
  import { dragreorder } from '../../actions/dragreorder.ts';
  import PhoneNavIcon from './PhoneNavIcon.svelte';
  import {
    PHONE_NAV_SLOTS, navTargetLabel, phoneNavOrder, phoneNavPinnedCount, pinNavTarget,
    reorderNavTarget, restoreNavOrder, unpinNavTarget, type PhoneNavTarget,
  } from '../../state/phone-nav-order.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  let {
    visibleOrder,
    ondone,
  }: {
    visibleOrder: PhoneNavTarget[];
    ondone: () => void;
  } = $props();

  let listEl = $state<HTMLElement>();
  let draggingId = $state<PhoneNavTarget | null>(null);
  /* Stand beim Oeffnen — „Abbrechen" stellt ihn wieder her. */
  const orderBefore = [...phoneNavOrder.order];

  /* Die untere Leiste hat vier Plaetze; bleibt hinter den festen etwas uebrig,
     haelt „Mehr" den letzten. */
  const pinnedCount = $derived(phoneNavPinnedCount(visibleOrder.length));
  const pinned = $derived(visibleOrder.slice(0, pinnedCount));
  const rest = $derived(visibleOrder.slice(pinnedCount));
  const usedSlots = $derived(pinnedCount + (rest.length > 0 ? 1 : 0));

  function cancel(): void {
    restoreNavOrder(orderBefore);
    ondone();
  }
</script>

      <header class="more-arrange-header">
        <button class="more-sheet-action pressable" type="button"
                aria-label={m.phone_nav_arrange_cancel()} onclick={cancel}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19" /></svg>
        </button>
        <button class="more-arrange-done pressable" type="button" onclick={ondone}>
          {m.phone_nav_arrange_done()}
        </button>
      </header>

      <div class="more-arrange-intro">
        <h2 id="more-sheet-title">{m.phone_nav_arrange_title()}</h2>
        <p>{m.phone_nav_arrange_desc()}</p>
      </div>

      <!-- Eine einzige Zeilenfolge, zwei Überschriften: die Ziehgeste kennt
           keine Bereichsgrenze, sie zählt nur Zeilen. Wer eine Kategorie über
           die Überschrift hinaufzieht, hat sie damit unten fixiert. -->
      <div class="more-arrange" bind:this={listEl} aria-label={m.phone_nav_order()}>
        <div class="more-arrange-group">
          <div class="more-arrange-group-head">
            <h3>{m.phone_nav_pinned_title()}</h3>
            <span class="more-arrange-count">{m.phone_nav_pinned_count({ used: usedSlots, total: PHONE_NAV_SLOTS })}</span>
          </div>
          <p class="more-arrange-group-desc">{m.phone_nav_pinned_desc()}</p>

          <div class="more-arrange-rows">
            {#each pinned as id (id)}
              {@render arrangeRow(id, true)}
            {/each}
            {#if rest.length > 0}
              <!-- „Mehr" hält den letzten Platz, solange dahinter etwas liegt:
                   ohne diesen Zugang wäre der Rest unerreichbar. -->
              <div class="more-arrange-row is-fixed">
                <span class="more-arrange-handle is-empty" aria-hidden="true"></span>
                <span class="more-sheet-target-icon"><PhoneNavIcon id="more" /></span>
                <span class="more-arrange-name">{m.nav_more()}</span>
                <span class="more-arrange-lock">{m.phone_nav_more_fixed()}</span>
              </div>
            {/if}
          </div>
        </div>

        {#if rest.length > 0}
          <div class="more-arrange-group">
            <div class="more-arrange-group-head">
              <h3>{m.phone_nav_rest_title()}</h3>
            </div>
            <p class="more-arrange-group-desc">{m.phone_nav_rest_desc()}</p>

            <div class="more-arrange-rows">
              {#each rest as id (id)}
                {@render arrangeRow(id, false)}
              {/each}
            </div>
          </div>
        {/if}
      </div>

{#snippet arrangeRow(id: PhoneNavTarget, isPinned: boolean)}
  <div class="more-arrange-row" class:is-dragging={draggingId === id} data-reorder-row={id}>
    <button class="more-arrange-handle" type="button" aria-label={m.phone_nav_drag({ name: navTargetLabel(id) })}
            disabled={visibleOrder.length < 2}
            use:dragreorder={{
              id,
              list: () => listEl,
              enabled: visibleOrder.length > 1,
              onReorder: (target, index) => reorderNavTarget(target as PhoneNavTarget, index, visibleOrder),
              onDragChange: (dragging) => { draggingId = dragging ? id : null; },
            }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" /></svg>
    </button>
    <span class="more-sheet-target-icon"><PhoneNavIcon {id} /></span>
    <span class="more-arrange-name">{navTargetLabel(id)}</span>
    {#if isPinned}
      <button class="more-arrange-slot is-remove pressable" type="button"
              aria-label={m.phone_nav_unpin({ name: navTargetLabel(id) })}
              onclick={() => unpinNavTarget(id, visibleOrder)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>
      </button>
    {:else}
      <button class="more-arrange-slot is-add pressable" type="button"
              aria-label={m.phone_nav_pin({ name: navTargetLabel(id) })}
              onclick={() => pinNavTarget(id, visibleOrder)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
      </button>
    {/if}
  </div>
{/snippet}
