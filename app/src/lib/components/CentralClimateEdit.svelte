<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Zentrale Klimasteuerung als Overlay (Long-Press auf die „Alle Räume"-Pille,
     analog Szenen-Editor). Zeigt dieselbe Fassung wie die Einstellungen unter
     „Räume & Geräte" — Quelle, beteiligte Räume, Versatz. */
  import CentralClimateConfig from './settings/CentralClimateConfig.svelte';
  import {
    centralClimateEdit,
    closeCentralClimateEdit,
    finishCentralClimateEditClose,
  } from '../state/central-climate-overlay.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  // animationend-Fallback (deckt prefers-reduced-motion: 0ms ab)
  $effect(() => {
    if (centralClimateEdit.mode !== 'closing') return;
    const t = setTimeout(finishCentralClimateEditClose, 250);
    return () => clearTimeout(t);
  });

  // Initial-Fokus beim Öffnen (A11y): einmal auf das Panel.
  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (centralClimateEdit.mode === 'open' && panelEl) panelEl.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && centralClimateEdit.mode === 'open') closeCentralClimateEdit();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="room-edit central-climate-edit" class:is-open={centralClimateEdit.mode === 'open'}
     class:is-closing={centralClimateEdit.mode === 'closing'} hidden={centralClimateEdit.mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={() => closeCentralClimateEdit()}></div>
  <div class="room-edit-panel overlay-panel" role="dialog" aria-modal="true"
       aria-label={m.central_climate_settings_title()} tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (centralClimateEdit.mode === 'closing' && e.target === e.currentTarget) finishCentralClimateEditClose(); }}>
    <header class="ld-header">
      <h2 class="ld-title">{m.central_climate_settings_title()}</h2>
      <button class="ld-close pressable" type="button" aria-label={m.common_close()}
              onclick={() => closeCentralClimateEdit()}>×</button>
    </header>

    <div class="ld-body">
      <p class="cce-intro">{m.central_climate_settings_desc()}</p>
      <CentralClimateConfig />
    </div>
  </div>
</div>

<style>
  .cce-intro {
    margin: 0 0 var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }
</style>
