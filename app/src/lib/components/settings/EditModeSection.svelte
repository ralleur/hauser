<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* ── Oberfläche & Bedienung · Bedienen-Modus ──
     Zwei Regeln rund um den Umschalter in der Kopfzeile: nach welcher Ruhezeit
     das Panel von selbst in den Bedienen-Modus zurückfällt, und ob das
     Verlassen eine PIN verlangt. */
  import Icon from '../Icon.svelte';
  import { editMode, setAutoLockMinutes, setEditPin } from '../../state/edit-mode.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const DEFAULT_MINUTES = 5;

  let pinDraft = $state('');
  let pinEditing = $state(false);

  function savePin(): void {
    setEditPin(pinDraft.trim());
    pinDraft = '';
    pinEditing = false;
  }
</script>

<div class="settings-group">
  <div class="settings-row" data-setting-id="edit-mode-auto-lock">
    <span class="settings-row-icon"><Icon name="i-timer-lock-outline" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_edit_auto_title()}</span>
      <span class="settings-row-sub">{m.sys_edit_auto_hint()}</span>
    </div>
    {#if editMode.autoLockMinutes !== null}
      <input class="settings-input settings-minutes-input" type="number" min="1" max="240" step="1"
             aria-label={m.sys_edit_auto_minutes()}
             value={editMode.autoLockMinutes}
             onchange={(event) => setAutoLockMinutes(
               Math.min(240, Math.max(1, Math.round(event.currentTarget.valueAsNumber || DEFAULT_MINUTES))),
             )} />
      <span class="settings-row-unit">{m.sys_edit_auto_unit()}</span>
    {/if}
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={editMode.autoLockMinutes !== null}
            aria-label={m.sys_edit_auto_toggle()}
            onclick={() => setAutoLockMinutes(editMode.autoLockMinutes === null ? DEFAULT_MINUTES : null)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>

  <div class="settings-row" data-setting-id="edit-mode-pin">
    <span class="settings-row-icon"><Icon name="i-lock" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_edit_pin_title()}</span>
      <span class="settings-row-sub">
        {editMode.pin.length > 0 ? m.sys_edit_pin_set() : m.sys_edit_pin_hint()}
      </span>
    </div>
    {#if pinEditing}
      <input class="settings-input settings-pin-input" type="password" inputmode="numeric"
             autocomplete="off" maxlength="8" aria-label={m.sys_edit_pin_title()}
             bind:value={pinDraft} />
      <button class="secondary-btn pressable" type="button" onclick={savePin}>{m.rem_edit_save()}</button>
    {:else}
      <button class="secondary-btn pressable" type="button"
              onclick={() => { pinDraft = ''; pinEditing = true; }}>
        {editMode.pin.length > 0 ? m.sys_edit_pin_change() : m.sys_edit_pin_add()}
      </button>
    {/if}
    {#if editMode.pin.length > 0 && !pinEditing}
      <button class="secondary-btn danger-btn pressable" type="button"
              onclick={() => setEditPin('')}>{m.sys_edit_pin_remove()}</button>
    {/if}
  </div>
</div>
<p class="settings-note">{m.sys_edit_note()}</p>
