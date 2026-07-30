<script lang="ts">
  /* Public product: model disclosure remains, while the private Hermes
     customization gateway, health probe and debug switch are omitted. */
  import Icon from '../Icon.svelte';
  import { AMBIENT_LLM_DEFAULT_MODEL } from '../../state/ambient-copy-client.ts';
  import { SONG_LYRICS_MODEL } from '../../state/songs.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<h3 class="caps-label settings-group-label">{m.settings_entry_ai_models_label()}</h3>
<div class="settings-group" data-setting-id="ai-models">
  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-creation" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_ai_model_ambient()}</span>
      <span class="settings-row-sub">{m.sys_ai_models_hint()}</span>
    </div>
    <span class="settings-row-value num">{AMBIENT_LLM_DEFAULT_MODEL}</span>
  </div>
  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-music-note" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_ai_model_lyrics()}</span>
      <span class="settings-row-sub">{m.sys_ai_song_lyrics_hint()}</span>
    </div>
    <span class="settings-row-value num">{SONG_LYRICS_MODEL}</span>
  </div>
</div>
