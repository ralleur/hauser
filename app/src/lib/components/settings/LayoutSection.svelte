<script lang="ts">
  /* ── Darstellung · Layout & Bedienung ── */
  import Icon from '../Icon.svelte';
  import { layoutManager } from '../../state/layout-manager.svelte.ts';
  import { widthPreset } from '../../state/layout-config.ts';
  import { settingsValues, setOffConfirmBefore } from '../../state/settings.svelte.ts';
  import { confirmThen, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const layoutSummary = $derived(
    `${layoutManager.applied.slots.length === 1 ? m.sys_one_surface() : m.sys_two_surfaces()} · Breite: ${widthPreset(layoutManager.applied).label}`,
  );
</script>

<div class="settings-group">
  <div class="settings-row" data-setting-id="layout-config">
    <span class="settings-row-icon"><Icon name="i-tune" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_control_surfaces()}</span>
      <span class="settings-row-sub">{layoutSummary}</span>
    </div>
    <button class="secondary-btn pressable" type="button" onclick={() => layoutManager.show()}>{m.sys_configure()}</button>
  </div>

  <div class="settings-row" data-setting-id="layout-reset">
    <span class="settings-row-icon"><Icon name="i-restore" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_reset_default()}</span>
      <span class="settings-row-sub">{m.sys_one_surface_balanced()}</span>
    </div>
    <button class="secondary-btn danger-btn pressable" type="button"
            onclick={() => confirmThen('layout-reset', () => layoutManager.resetAndApply())}>
      {isConfirming('layout-reset') ? m.sys_reset_confirm() : m.sys_reset()}
    </button>
  </div>

  <div class="settings-row" data-setting-id="off-confirm-before">
    <span class="settings-row-icon"><Icon name="i-power" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_off_confirm_title()}</span>
      <span class="settings-row-sub">{m.sys_off_confirm_hint()}</span>
    </div>
    {#if settingsValues.offConfirmBefore !== null}
      <input class="settings-input settings-time-input" type="time" aria-label={m.sys_off_confirm_before()}
             value={settingsValues.offConfirmBefore}
             onchange={(event) => setOffConfirmBefore(event.currentTarget.value || '22:00')} />
    {/if}
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={settingsValues.offConfirmBefore !== null}
            aria-label={m.sys_off_confirm_toggle()}
            onclick={() => setOffConfirmBefore(settingsValues.offConfirmBefore === null ? '22:00' : null)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>
</div>
<p class="settings-note">{m.sys_layout_note()}</p>
