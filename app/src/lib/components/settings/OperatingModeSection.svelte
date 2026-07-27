<script lang="ts">
  /* ── Verbindungen · Betriebsmodus ──
     Die eine Stelle für „echte Dienste oder Demo-Daten?“. Vorher gab es dafür
     zwei konkurrierende Wahrheiten: den globalen Demo-Schalter unter
     „Verbindungen“ und einen eigenen Bibliotheks-Modus unter „Bibliothek“.

     Der Bibliotheks-Modus bleibt erhalten — er ist ein bewusster Override für
     den Fall, dass Jellyfin fehlt, das übrige Panel aber live läuft. Er steht
     hier aber sichtbar unter dem globalen Schalter, statt an anderer Stelle
     ein zweites Mal dasselbe zu versprechen. */
  import Icon from '../Icon.svelte';
  import { settingsValues, setDemoMode, setLibraryMode } from '../../state/settings.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const LIBRARY_MODES = [
    { id: 'auto', label: m.sys_automatic() },
    { id: 'live', label: m.sys_live() },
    { id: 'fake', label: m.sys_demo() },
  ] as const;
</script>

<div class="settings-group">
  <div class="settings-row" data-setting-id="demo-mode">
    <span class="settings-row-icon"><Icon name="i-television-play" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">Demo-Modus</span>
      <span class="settings-row-sub">{m.sys_backend_demo_hint()}</span>
    </div>
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={settingsValues.demoMode} aria-label="Demo-Modus"
            onclick={() => setDemoMode(!settingsValues.demoMode)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>

  <div class="settings-row is-stacked" data-setting-id="library-mode">
    <div class="settings-row-text">
      <span class="settings-row-label">Bibliotheks-Modus</span>
      <span class="settings-row-sub">{m.sys_library_mode_hint()}</span>
    </div>
    <div class="settings-seg" role="radiogroup" aria-label="Bibliotheks-Modus">
      {#each LIBRARY_MODES as mode (mode.id)}
        <button class="settings-seg-btn pressable" type="button" role="radio"
                aria-checked={settingsValues.libraryMode === mode.id}
                class:is-active={settingsValues.libraryMode === mode.id}
                onclick={() => setLibraryMode(mode.id)}>{mode.label}</button>
      {/each}
    </div>
  </div>
</div>
<p class="settings-note">{m.sys_operating_mode_note()}</p>
