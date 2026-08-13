<script lang="ts">
  import { onMount } from 'svelte';
  import { runtime, configuredHaUrl } from '../adapter/runtime.svelte.ts';
  import type { CameraValue } from '../adapter/types.ts';
  import { doubletap } from '../actions/doubletap.ts';

  let { entityId, label }: { entityId: string; label: string } = $props();
  let failed = $state(false);
  let frame = $state<HTMLDivElement>();
  let fullscreen = $state(false);

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

  onMount(() => {
    const syncFullscreen = () => { fullscreen = document.fullscreenElement === frame; };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  });

  function openFullscreen(): void {
    if (!frame || fullscreen || !source || failed) return;
    void frame.requestFullscreen().catch(() => {});
  }

  function closeFullscreen(): void {
    if (document.fullscreenElement === frame) void document.exitFullscreen();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (fullscreen) closeFullscreen();
    else openFullscreen();
  }
</script>

<figure class="camera-feed">
  <figcaption class="camera-feed-caption">
    <span>{label}</span>
    <span class="camera-feed-status" class:is-live={source && !failed}>
      {source && !failed ? 'Live' : 'Nicht verfügbar'}
    </span>
  </figcaption>
  <div
    class="camera-feed-frame"
    class:is-fullscreen={fullscreen}
    bind:this={frame}
    role="button"
    tabindex={source && !failed ? 0 : -1}
    aria-disabled={!source || failed}
    aria-label={source && !failed ? (fullscreen ? `${label} Vollbild schließen` : `${label} im Vollbild öffnen`) : undefined}
    aria-pressed={source && !failed ? fullscreen : undefined}
    onclick={openFullscreen}
    onkeydown={onKeydown}
    use:doubletap={{ enabled: fullscreen, onDoubleTap: closeFullscreen }}
  >
    {#if source && !failed}
      <img src={source} alt={`Livebild ${label}`} onerror={() => { failed = true; }} />
    {:else}
      <p>Kamerabild nicht verfügbar</p>
    {/if}
  </div>
</figure>
