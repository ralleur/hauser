<script lang="ts">
  /* ── Inhalte · Medien & Musik ──
     Der Bibliotheks-Modus ist ein bewusster Override für den Fall, dass
     Jellyfin fehlt, das übrige Panel aber live läuft. Er steht hier bei den
     Medien statt beim globalen Demo-Schalter — einsortiert wird nach dem
     Objekt, das die Einstellung betrifft, nicht nach der Technik dahinter.

     Die Songtext-Zeile ist reine Anzeige: sie nennt das aufgerufene Modell und
     weist aus, wenn der KI-Zugang fehlt — statt still ins Leere zu laufen. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { settingsValues, setLibraryMode } from '../../state/settings.svelte.ts';
  import { aiHealth } from '../../state/ai-health.svelte.ts';
  import { SONG_LYRICS_MODEL } from '../../state/songs.ts';
  import { IS_DEMO } from '../../demo/demo-mode.ts';
  import { m } from '../../../paraglide/messages.js';

  const LIBRARY_MODES = [
    { id: 'auto', label: () => m.sys_automatic() },
    { id: 'live', label: () => m.sys_live() },
    { id: 'fake', label: () => m.sys_demo() },
  ] as const;

  const accessMissing = $derived(aiHealth.status === 'offline' || aiHealth.status === 'unauthorized');
</script>

<div class="settings-group" data-setting-id="library-mode">
  <SettingsCardHead icon="i-library" tint="cool"
                    title={m.sys_library_mode()} sub={m.sys_library_mode_hint()} />
  <div class="settings-row is-stacked">
    <div class="settings-chips" role="radiogroup" aria-label={m.sys_library_mode()}>
      {#each LIBRARY_MODES as mode (mode.id)}
        <button class="settings-chip pressable" type="button" role="radio"
                aria-checked={settingsValues.libraryMode === mode.id}
                class:is-active={settingsValues.libraryMode === mode.id}
                onclick={() => setLibraryMode(mode.id)}>
          {mode.label()}
          {#if settingsValues.libraryMode === mode.id}<Icon name="i-check" cls="icon" />{/if}
        </button>
      {/each}
    </div>
  </div>
</div>

{#if !IS_DEMO}
  <div class="settings-group">
    <SettingsCardHead icon="i-music-note" tint="cool"
                      title={m.settings_entry_ai_song_lyrics_label()} sub={m.sys_ai_song_lyrics_hint()} />
    <div class="settings-row" data-setting-id="ai-song-lyrics">
      <span class="settings-row-icon"><Icon name="i-creation" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{m.sys_ai_model_lyrics()}</span>
        <span class="settings-row-sub num">{accessMissing ? m.sys_ai_needs_access() : SONG_LYRICS_MODEL}</span>
      </div>
      <span class="settings-row-value">{m.sys_ai_always_on()}</span>
    </div>
  </div>
{/if}
<p class="settings-note">{m.sys_media_note()}</p>
