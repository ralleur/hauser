<script lang="ts">
  import { runtime, configuredHaUrl } from '../adapter/runtime.svelte.ts';
  import type { CameraValue } from '../adapter/types.ts';

  let { entityId, label }: { entityId: string; label: string } = $props();
  let failed = $state(false);

  const camera = $derived(runtime.merged(entityId) as CameraValue | undefined);
  const source = $derived.by(() => {
    const picture = camera?.entityPicture;
    if (!camera?.available || !picture) return null;
    const streamPath = picture.replace('/api/camera_proxy/', '/api/camera_proxy_stream/');
    return new URL(streamPath, `${configuredHaUrl()}/`).toString();
  });

  $effect(() => {
    void source;
    failed = false;
  });
</script>

<figure class="camera-feed">
  <figcaption class="camera-feed-caption">
    <span>{label}</span>
    <span class="camera-feed-status" class:is-live={source && !failed}>
      {source && !failed ? 'Live' : 'Nicht verfügbar'}
    </span>
  </figcaption>
  <div class="camera-feed-frame">
    {#if source && !failed}
      <img src={source} alt={`Livebild ${label}`} onerror={() => { failed = true; }} />
    {:else}
      <p>Kamerabild nicht verfügbar</p>
    {/if}
  </div>
</figure>
