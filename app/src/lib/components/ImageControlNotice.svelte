<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { imageControlStatus, layoutManager } from '../state/layout-manager.svelte.ts';
  const mapping = $derived(imageControlStatus());
</script>
{#if layoutManager.applied.homeView === 'image' && mapping.missing > 0}
  <p class="mapping-notice" role="status">{m.img_control_mapping_notice({ count: mapping.missing })}</p>
{/if}
<style>
  .mapping-notice { margin: var(--space-3) 0 0; padding: var(--space-3); border: 1px solid var(--color-accent-warm); border-radius: var(--radius-md); background: var(--overlay-control-background); color: var(--color-text-primary); font-size: var(--text-sm); line-height: 1.5; }
</style>
