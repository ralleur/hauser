<script lang="ts">
  import { standalone } from '../state/standalone.svelte.ts';
  import { IS_DEMO } from '../demo/demo-mode.ts';
  import { m } from '../../paraglide/messages.js';

  // Dezenter Hinweis nur im normalen Safari-Tab — nie in der installierten App.
  // Einmal weggetippt, bleibt er für die Session weg (Kiosk-Betrieb wird nicht gestört).
  // In der öffentlichen Demo entfällt er: dort geht es ums Ansehen, nicht ums Installieren.
  let dismissed = $state(false);
  const show = $derived(!standalone.active && !dismissed && !IS_DEMO);
</script>

{#if show}
  <div class="pwa-hint" role="note">
    <span class="pwa-hint-text">
      {m.pwa_install_intro()} <strong>{m.pwa_install_share()}</strong> →
      <strong>{m.pwa_install_add()}</strong>.
    </span>
    <button class="pwa-hint-close pressable" type="button"
            aria-label={m.pwa_install_close()} onclick={() => (dismissed = true)}>×</button>
  </div>
{/if}
