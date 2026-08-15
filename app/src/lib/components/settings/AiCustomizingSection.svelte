<script lang="ts">
  /* Public product: the customization agent that edits and deploys this
     repository is intentionally absent. AI_CUSTOMIZING_ENABLED is false, so
     the registry drops this section from the sidebar entirely — this file
     exists only because the section table in SystemScreen is exhaustive. */
  import { AI_CUSTOMIZING_ENABLED } from '../../config/product-capabilities.ts';
</script>

{#if AI_CUSTOMIZING_ENABLED}
  <div data-setting-id="ai-customizing"></div>
{/if}
