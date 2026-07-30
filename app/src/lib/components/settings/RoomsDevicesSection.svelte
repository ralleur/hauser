<script lang="ts">
  import SetupWizard from '../SetupWizard.svelte';
  import { settingsValues } from '../../state/settings.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<div data-setting-id="household-setup">
  {#if settingsValues.demoMode}
    <p class="settings-empty">{m.sys_demo_no_function_ha()}</p>
  {:else}
    <SetupWizard mode="reconfigure" embedded />
  {/if}
</div>