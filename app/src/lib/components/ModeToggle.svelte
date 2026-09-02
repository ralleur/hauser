<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* ── Umschalter Bearbeiten ⇄ Bedienen (Mitte der Kopfzeile) ──
     Das Zeichen trägt den Zustand: ein Ring mit Kern steht für Bedienen, im
     Bearbeiten-Modus kommen Strahlen dazu — dieselbe Form, eine Stufe „wach".

     Beim Umschalten läuft eine Kreiswelle vom Knopf aus und darunter steht
     kurz, was jetzt gilt. Dieselbe Zeile erklärt den Weg hierher, wenn jemand
     im Bedienen-Modus wiederholt eine Konfiguration zu öffnen versucht. */
  import {
    editMode, modeNotice, dismissNotice, setEditMode,
    editModeNeedsPin, pinMatches, startAutoLock,
  } from '../state/edit-mode.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  let button = $state<HTMLButtonElement>();
  let ripple = $state<{ x: number; y: number; seq: number } | null>(null);
  let pinOpen = $state(false);
  let pinDraft = $state('');
  let pinWrong = $state(false);

  const label = $derived(editMode.active ? m.mode_edit() : m.mode_user());
  const action = $derived(editMode.active ? m.mode_switch_to_user() : m.mode_switch_to_edit());
  const noticeText = $derived.by(() => {
    if (modeNotice.kind === 'edit') return m.mode_announce_edit();
    if (modeNotice.kind === 'user') return m.mode_announce_user();
    if (modeNotice.kind === 'locked') return m.mode_hint_locked();
    return '';
  });

  /* Der Wachhund wird nach jeder Änderung an Modus oder Dauer neu scharf. */
  $effect(() => {
    void editMode.active;
    void editMode.autoLockMinutes;
    return startAutoLock();
  });

  function wave(): void {
    const box = button?.getBoundingClientRect();
    if (!box) return;
    ripple = { x: box.left + box.width / 2, y: box.top + box.height / 2, seq: (ripple?.seq ?? 0) + 1 };
  }

  function activate(): void {
    if (editModeNeedsPin()) {
      pinDraft = '';
      pinWrong = false;
      pinOpen = true;
      return;
    }
    wave();
    setEditMode(!editMode.active);
  }

  function digit(value: string): void {
    if (pinDraft.length >= 8) return;
    pinWrong = false;
    pinDraft += value;
    if (pinDraft.length >= editMode.pin.length) submitPin();
  }

  function submitPin(): void {
    if (!pinMatches(pinDraft)) {
      pinWrong = true;
      pinDraft = '';
      return;
    }
    pinOpen = false;
    pinDraft = '';
    wave();
    setEditMode(true);
  }
</script>

<div class="mode-toggle-wrap">
  <button bind:this={button} class="mode-toggle pressable" type="button"
          aria-pressed={!editMode.active} aria-label={action} title={`${label} · ${action}`}
          onclick={activate}>
    <svg class="mode-toggle-mark" viewBox="0 0 24 24" aria-hidden="true">
      {#if editMode.active}
        <!-- Strahlen nur im Bearbeiten-Modus: der Zustand ist die Form. -->
        <g class="mode-toggle-rays">
          <path d="M12 2.6V0M12 21.4V24M2.6 12H0M21.4 12H24M5.4 5.4L3.5 3.5M18.6 18.6l1.9 1.9M18.6 5.4l1.9-1.9M5.4 18.6L3.5 20.5" />
        </g>
      {/if}
      <circle class="mode-toggle-ring" cx="12" cy="12" r="7.4" />
      <circle class="mode-toggle-core" cx="12" cy="12" r="3.1" />
    </svg>
  </button>

  {#if modeNotice.kind}
    {#key modeNotice.seq}
      <p class="mode-notice" class:is-warning={modeNotice.kind === 'locked'} role="status" aria-live="polite">
        {noticeText}
      </p>
    {/key}
  {/if}
</div>

{#if ripple}
  {#key ripple.seq}
    <span class="mode-ripple" aria-hidden="true"
          style={`--ripple-x:${ripple.x}px;--ripple-y:${ripple.y}px`}
          onanimationend={() => (ripple = null)}></span>
  {/key}
{/if}

{#if pinOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="mode-pin-scrim" onclick={() => (pinOpen = false)}></div>
  <div class="mode-pin" role="dialog" aria-modal="true" aria-label={m.mode_pin_title()}>
    <p class="mode-pin-title">{m.mode_pin_title()}</p>
    <div class="mode-pin-dots" aria-hidden="true">
      {#each Array.from({ length: Math.max(editMode.pin.length, 4) }) as _, index}
        <span class="mode-pin-dot" class:is-filled={index < pinDraft.length}></span>
      {/each}
    </div>
    {#if pinWrong}<p class="mode-pin-wrong" role="alert">{m.mode_pin_wrong()}</p>{/if}
    <div class="mode-pin-pad">
      {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as key (key)}
        <button class="mode-pin-key pressable" type="button" onclick={() => digit(key)}>{key}</button>
      {/each}
      <button class="mode-pin-key is-text pressable" type="button"
              onclick={() => { pinOpen = false; dismissNotice(); }}>{m.hotel_pin_cancel()}</button>
      <button class="mode-pin-key pressable" type="button" onclick={() => digit('0')}>0</button>
      <button class="mode-pin-key is-text pressable" type="button"
              onclick={() => { pinDraft = pinDraft.slice(0, -1); }}>←</button>
    </div>
  </div>
{/if}
