<script lang="ts">
  /* ── Darstellung · Ambient & Standby ── */
  import Icon from '../Icon.svelte';
  import { requestAmbient, requestDeepNightPreview } from '../../state/ambient.svelte.ts';
  import { settingsValues, setAmbientDeepNight } from '../../state/settings.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<div class="settings-group">
  <div class="settings-row" data-setting-id="standby-now">
    <span class="settings-row-icon"><Icon name="i-sleep" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_standby()}</span>
      <span class="settings-row-sub">{m.sys_standby_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button" onclick={() => requestAmbient()}>{m.sys_start_now()}</button>
  </div>

  <div class="settings-row" data-setting-id="ambient-deep-night">
    <span class="settings-row-icon"><Icon name="i-weather-night" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_deep_night()}</span>
      <span class="settings-row-sub">{m.sys_deep_night_hint()}</span>
    </div>
    <div class="settings-row-actions">
      <button class="secondary-btn pressable" type="button"
              onclick={requestDeepNightPreview}>{m.sys_preview()}</button>
      <button class="settings-switch pressable" type="button" role="switch"
              aria-checked={settingsValues.ambientDeepNight}
              aria-label={m.sys_deep_night_toggle()}
              onclick={() => setAmbientDeepNight(!settingsValues.ambientDeepNight)}>
        <span class="settings-switch-knob"></span>
      </button>
    </div>
  </div>
</div>
