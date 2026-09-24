<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* „Heute" am Panel (wie die iOS-App): die Tagesbilanz als Scheibe rechts
     neben der Wand. Kein Schleier — die Wand bleibt daneben lesbar; ein Tipp
     außerhalb der Scheibe schließt. Zustandsmaschine wie das Last-Overlay. */
  import EnergyBalanceView from './EnergyBalanceView.svelte';
  import { m } from '../../paraglide/messages.js';
  import { intlLocale } from '../state/locale.svelte.ts';
  import type { EnergyBalance } from '../state/energy-balance.ts';

  interface Props {
    mode: 'hidden' | 'open' | 'closing';
    balance: EnergyBalance;
    onRequestClose: () => void;
    onClosed: () => void;
  }
  let { mode, balance, onRequestClose, onClosed }: Props = $props();

  const until = $derived(m.energy_balance_until({
    time: new Date().toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }),
  }));

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && mode === 'open') onRequestClose();
  }
  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (mode === 'open' && panelEl) panelEl.focus();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div class="energy-load-overlay is-docked" class:is-open={mode === 'open'}
     class:is-closing={mode === 'closing'} hidden={mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={onRequestClose}></div>
  <div class="elo-panel ebo-panel overlay-panel on-image" role="dialog" aria-modal="true"
       aria-label={m.period_today()} tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (mode === 'closing' && e.target === e.currentTarget) onClosed(); }}>
    <header class="elo-header">
      <div class="elo-title-group">
        <span class="caps-label">{until}</span>
        <h2 class="elo-title">{m.period_today()}</h2>
      </div>
      <button class="elo-close pressable" type="button" aria-label={m.energy_split_close()}
              onclick={onRequestClose}>×</button>
    </header>
    <EnergyBalanceView {balance} />
  </div>
</div>

<style>
  .is-docked { place-items: center end; }
  .is-docked :global(.overlay-scrim) { background: transparent; }
  .ebo-panel { width: min(100%, 680px); max-height: calc(100% - var(--space-6)); overflow: auto; }
</style>
