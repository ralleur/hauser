<script lang="ts">
  /* Public product: only non-code-modifying AI functions remain here. The
     repository/deploying customization agent is intentionally absent. */
  import Icon from '../Icon.svelte';
  import { settingsValues, setAmbientHeroText } from '../../state/settings.svelte.ts';
  import { AMBIENT_LLM_DEFAULT_MODEL } from '../../state/ambient-copy-client.ts';
  import { SONG_LYRICS_MODEL } from '../../state/songs.ts';
  import { IS_DEMO } from '../../demo/demo-mode.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<h3 class="caps-label settings-group-label">{m.sys_ai_features_group()}</h3>
<div class="settings-group">
  <div class="settings-row" data-setting-id="ambient-hero-text">
    <span class="settings-row-icon"><Icon name="i-creation" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_ai_hero_text()}</span>
      <span class="settings-row-sub">
        Tageskommentar mit {AMBIENT_LLM_DEFAULT_MODEL}; ausgeschaltet bleibt nur die Datumszeile sichtbar.
      </span>
    </div>
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={settingsValues.ambientHeroText}
            aria-label={m.sys_ai_hero_text()}
            onclick={() => setAmbientHeroText(!settingsValues.ambientHeroText)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>

  {#if !IS_DEMO}
    <div class="settings-row" data-setting-id="ai-song-lyrics">
      <span class="settings-row-icon"><Icon name="i-music-note" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{m.settings_entry_ai_song_lyrics_label()}</span>
        <span class="settings-row-sub">{m.sys_ai_song_lyrics_hint()} ({SONG_LYRICS_MODEL})</span>
      </div>
      <span class="settings-row-value">{m.sys_ai_always_on()}</span>
    </div>
  {/if}
</div>
