<script lang="ts">
  /* ── System · Updates ── */
  import Icon from '../Icon.svelte';
  import { appState } from '../../state/app.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<div class="settings-group" data-setting-id="update-list">
  {#each appState.system.updates as u (u.name)}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-download" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{u.name}</span>
      </div>
      <span class="settings-row-value num">{u.from} <span class="settings-arrow">→</span> {u.to}</span>
    </div>
  {/each}
</div>
<p class="settings-note">{m.sys_updates_note()}</p>
