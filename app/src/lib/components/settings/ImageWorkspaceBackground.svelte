<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { roomBlueprint } from '../room-blueprint.ts';
  import { normalizeHeroRoom, roomImageAssetUrl } from '../room-hero-assets.ts';
  import { energyAssetUrl } from '../energy-hero-assets.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { EXTERIOR_HERO_ID } from '../../config/household-config.ts';
  let { roomId }: { roomId: string | null } = $props();
  let blueprint = $state<string | null>(null);
  $effect(() => {
    const config = roomHeroConfig(roomId);
    const url = config ? roomImageAssetUrl(config.assetId, 'light.avif') : roomId === EXTERIOR_HERO_ID
      ? energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun: { day: true }, fallbackTheme: 'light' })
      : `${import.meta.env.BASE_URL}hero/${normalizeHeroRoom(roomId)}-light.avif`;
    let current = true;
    void roomBlueprint(url).then(value => { if (current) blueprint = value; });
    return () => { current = false; };
  });
</script>
<div class="workspace-background" style:background-image={blueprint ? `url("${blueprint}")` : undefined} aria-hidden="true"></div>
<style>
  .workspace-background { position: fixed; inset: 0; z-index: -1; background-size: cover; background-position: center; opacity: .5; pointer-events: none; }
</style>
