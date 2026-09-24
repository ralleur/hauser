<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* ── Umschalter Bearbeiten ⇄ Bedienen (Mitte der Kopfzeile) ──
     Das Hauser-h trägt den Zustand: im Bedienen-Modus steht es allein, im
     Bearbeiten-Modus sitzt der goldene Punkt darüber (Owner-Vorlage
     2026-09-24).

     Beim Umschalten federt der Punkt hinein oder poppt nach oben weg, und
     rechts neben dem h steht zwei Sekunden, was jetzt gilt. Die Zeile unter
     dem Knopf bleibt dem Hinweis vorbehalten, der im Bedienen-Modus den Weg
     zur Konfiguration erklärt. */
  import { editMode, modeNotice, dismissNotice } from '../state/edit-mode.svelte.ts';
  import {
    setEditMode, editModeNeedsPin, pinMatches, startAutoLock,
  } from '../state/edit-mode-controls.ts';
  import { m } from '../../paraglide/messages.js';
  import { roomImageActivity } from '../state/room-image-activity.svelte.ts';

  /* Das h des Signets im 512er-Raster — einmal hier, für den Knopf und für
     den Sperr-Hinweis, der es an die Stelle des Wortes „Bearbeiten" setzt. */
  const H_PATH = 'M168 96V416M168 300C168 222 344 222 344 300V416';
  const MARK = '\uE000';

  let button = $state<HTMLButtonElement>();
  let ripple = $state<{ x: number; y: number; seq: number } | null>(null);
  let pinOpen = $state(false);
  let pinDraft = $state('');
  let pinWrong = $state(false);

  const label = $derived(editMode.active ? m.mode_edit() : m.mode_user());
  /* Läuft im Hintergrund ein Raumbild-Auftrag, dreht sich dasselbe Zeichen und
     sagt daneben knapp, woran gerade gearbeitet wird (Paket 13). */
  const busyText = $derived(roomImageActivity.stage === 'set'
    ? m.mode_busy_set()
    : roomImageActivity.stage === 'regions' ? m.mode_busy_regions() : null);
  const action = $derived(editMode.active ? m.mode_switch_to_user() : m.mode_switch_to_edit());
  const lockedHint = $derived(m.mode_hint_locked({ mark: MARK }).split(MARK));
  const switched = $derived(modeNotice.kind === 'edit' || modeNotice.kind === 'user');
  /* Der Punkt: ruhend im Bearbeiten-Modus, beim Wechsel mit Auftritt oder
     Abgang. Der Abgang bleibt stehen, bis die Ansage vorbei ist — seine
     Animation endet unsichtbar. */
  const dot = $derived(modeNotice.kind === 'user' ? 'leaving'
    : !editMode.active ? null
    : modeNotice.kind === 'edit' ? 'arriving' : 'resting');

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
    <!-- Das Signet im 512er-Raster; das h steht darin genau mittig. -->
    <svg class="mode-toggle-mark" class:is-busy={busyText !== null} viewBox="0 0 512 512" aria-hidden="true">
      <g class="mode-toggle-h"><path d={H_PATH} /></g>
      {#if dot}
        {#key modeNotice.seq}
          <circle class="mode-toggle-dot" class:is-arriving={dot === 'arriving'}
                  class:is-leaving={dot === 'leaving'} cx="344" cy="140" r="44" />
        {/key}
      {/if}
    </svg>
  </button>

  {#if busyText && !switched}
    <span class="mode-busy" role="status" aria-live="polite">{busyText}</span>
  {/if}
  {#if switched}
    {#key modeNotice.seq}
      <p class="mode-label" role="status" aria-live="polite">
        <span aria-hidden="true">{modeNotice.kind === 'edit' ? m.mode_edit() : m.mode_user()}</span>
        <span class="mode-label-sr">{modeNotice.kind === 'edit' ? m.mode_announce_edit() : m.mode_announce_user()}</span>
      </p>
    {/key}
  {:else if modeNotice.kind === 'locked'}
    {#key modeNotice.seq}
      <!-- Das h steht im Satz dort, wo es oben zu tippen ist. -->
      <p class="mode-notice is-warning" role="status" aria-live="polite">
        {lockedHint[0]}<svg class="mode-notice-mark" viewBox="136 64 240 384" role="img"
             aria-label={m.mode_edit()}><path d={H_PATH} /></svg>{lockedHint.slice(1).join('')}
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
