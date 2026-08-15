<script lang="ts">
  /* ── Darstellung · Ambient & Standby ──
     Alles, was das Panel im Ruhezustand zeigt — einschließlich des
     KI-Tageskommentars. Der stand vorher unter „KI · Funktionen“; wer den
     Text im Standby sucht, sucht ihn beim Standby, nicht unter der Technik,
     die ihn erzeugt. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { requestAmbient, requestDeepNightPreview } from '../../state/ambient.svelte.ts';
  import { settingsValues, setAmbientDeepNight, setAmbientHeroText } from '../../state/settings.svelte.ts';
  import { aiHealth } from '../../state/ai-health.svelte.ts';
  import { AMBIENT_LLM_DEFAULT_MODEL } from '../../state/ambient-copy-client.ts';
  import { m } from '../../../paraglide/messages.js';

  /* „offline“ und „unauthorized“ heißen beide: der Schalter unten läuft ins
     Leere. Das wird an der Zeile ausgewiesen, statt es den Nutzer an einem
     stillen Fehlschlag merken zu lassen. */
  const accessMissing = $derived(aiHealth.status === 'offline' || aiHealth.status === 'unauthorized');
</script>

<div class="settings-group">
  <SettingsCardHead icon="i-sleep" tint="cool"
                    title={m.sys_card_standby()} sub={m.sys_card_standby_hint()} />

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

  <div class="settings-row" data-setting-id="ambient-hero-text">
    <span class="settings-row-icon"><Icon name="i-creation" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_ai_hero_text()}</span>
      <span class="settings-row-sub">
        {accessMissing ? m.sys_ai_needs_access() : AMBIENT_LLM_DEFAULT_MODEL}
      </span>
    </div>
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={settingsValues.ambientHeroText}
            aria-label={m.sys_ai_hero_text()}
            onclick={() => setAmbientHeroText(!settingsValues.ambientHeroText)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>
</div>
