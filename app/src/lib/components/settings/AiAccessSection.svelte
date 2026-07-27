<script lang="ts">
  /* ── KI · Zugang & Modelle ──
     Vorgeschaltet vor allen KI-Funktionen: ist der Agent erreichbar, welche
     Modelle werden aufgerufen, und wo schaltet man die Diagnose ein.

     Der Sinn dieser Sektion ist, dass ein Fehlschlag nicht mehr still
     passiert. Vorher konnte der Tageskommentar unter „Experimentelle
     Features“ eingeschaltet sein, ohne dass irgendwo stand, dass sein
     Backend gar nicht antwortet. */
  import Icon from '../Icon.svelte';
  import { aiChat, aiHealth, checkAiHealth, setAiDebug } from '../../state/ai-customizing.svelte.ts';
  import { AMBIENT_LLM_DEFAULT_MODEL } from '../../state/ambient-copy-client.ts';
  import { SONG_LYRICS_MODEL } from '../../state/songs.ts';
  import { m } from '../../../paraglide/messages.js';

  $effect(() => { void checkAiHealth(); });

  const dot = $derived(
    aiHealth.checking ? 'dot-degraded'
      : aiHealth.status === 'ok' ? 'dot-online'
      : aiHealth.status === 'unknown' ? 'dot-degraded'
      : 'dot-offline',
  );

  const label = $derived(
    aiHealth.checking ? m.sys_service_checking()
      : aiHealth.status === 'ok' ? m.sys_service_reachable()
      : aiHealth.status === 'unauthorized' ? m.sys_service_not_configured()
      : aiHealth.status === 'unknown' ? m.sys_service_checking()
      : m.sys_service_unreachable(),
  );
</script>

<div class="settings-group">
  <div class="settings-row" data-setting-id="ai-access-status">
    <span class="dot {dot}"></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.settings_entry_ai_access_status_label()}</span>
      <span class="settings-row-sub">{m.sys_ai_access_hint()}</span>
    </div>
    <span class="settings-row-value">{label}</span>
    <button class="secondary-btn pressable" type="button" disabled={aiHealth.checking}
            onclick={() => void checkAiHealth()}>{m.sys_check()}</button>
  </div>
</div>

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

<div class="settings-group">
  <div class="settings-row" data-setting-id="ai-debug">
    <span class="settings-row-icon"><Icon name="i-bug-outline" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.settings_entry_ai_debug_label()}</span>
      <span class="settings-row-sub">{m.sys_ai_debug_hint()}</span>
    </div>
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={aiChat.debug} aria-label={m.settings_entry_ai_debug_label()}
            onclick={() => setAiDebug(!aiChat.debug)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>
</div>
