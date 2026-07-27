<script lang="ts">
  import { iconAssetUrlFromId } from '../state/icon-path.ts';

  let { name, cls = 'icon' }: { name: string; cls?: string } = $props();
  const assetUrl = $derived(iconAssetUrlFromId(name));
</script>

{#if assetUrl}
  <span class={`${cls} tabler-icon-mask`} style={`--icon-url:url("${assetUrl}")`} aria-hidden="true"></span>
{:else}
  <svg class={cls} aria-hidden="true"><use href={`#${name}`} /></svg>
{/if}
