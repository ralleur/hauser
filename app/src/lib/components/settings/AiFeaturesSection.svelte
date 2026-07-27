<script lang="ts">
  /* ── KI · Funktionen ──
     Alles, was einen erreichbaren KI-Zugang voraussetzt und Abrufkosten
     verursacht — an einer Stelle statt verteilt über „AI Customizing“ und
     „Experimentelle Features“.

     Jede Zeile nennt das aufgerufene Modell und wird sichtbar wirkungslos,
     wenn der Agent nicht erreichbar ist (Zustand kommt aus „Zugang & Modelle“).
     Der Feature-Chat selbst bleibt in seiner eigenen Komponente. */
  import Icon from '../Icon.svelte';
  import AiCustomizingPane from '../ai/AiCustomizingPane.svelte';
  import { aiHealth } from '../../state/ai-customizing.svelte.ts';
  import { settingsValues, setAmbientHeroText } from '../../state/settings.svelte.ts';
  import { AMBIENT_LLM_DEFAULT_MODEL } from '../../state/ambient-copy-client.ts';
  import { SONG_LYRICS_MODEL } from '../../state/songs.ts';
  import { m } from '../../../paraglide/messages.js';

  /* „offline“ und „unauthorized“ heißen beide: die Schalter unten laufen ins
     Leere. Das wird an jeder Funktionszeile ausgewiesen, statt es den Nutzer
     an einem stillen Fehlschlag merken zu lassen. */
  const accessMissing = $derived(aiHealth.status === 'offline' || aiHealth.status === 'unauthorized');
</script>

<h3 class="caps-label settings-group-label">{m.sys_ai_features_group()}</h3>
<div class="settings-group">
  <div class="settings-row" data-setting-id="ambient-hero-text">
    <span class="settings-row-icon"><Icon name="i-creation" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_ai_hero_text()}</span>
      <span class="settings-row-sub">
        {accessMissing
          ? m.sys_ai_needs_access()
          : `Tageskommentar mit ${AMBIENT_LLM_DEFAULT_MODEL}; ausgeschaltet bleibt nur die Datumszeile sichtbar.`}
      </span>
    </div>
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={settingsValues.ambientHeroText}
            aria-label={m.sys_ai_hero_text()}
            onclick={() => setAmbientHeroText(!settingsValues.ambientHeroText)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>

  <div class="settings-row" data-setting-id="ai-song-lyrics">
    <span class="settings-row-icon"><Icon name="i-music-note" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.settings_entry_ai_song_lyrics_label()}</span>
      <span class="settings-row-sub">
        {accessMissing ? m.sys_ai_needs_access() : `${m.sys_ai_song_lyrics_hint()} (${SONG_LYRICS_MODEL})`}
      </span>
    </div>
    <span class="settings-row-value">{m.sys_ai_always_on()}</span>
  </div>
</div>

<AiCustomizingPane />
