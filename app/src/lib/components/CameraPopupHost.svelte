<script lang="ts">
  import { onMount } from 'svelte';
  import CameraFeed from './CameraFeed.svelte';
  import { cameraPopup, resetCameraPopupTriggers } from '../state/camera-popup.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  let dialog: HTMLDialogElement;
  const active = $derived(cameraPopup.active);
  function close() { cameraPopup.active = null; }
  onMount(() => {
    const changed = () => { close(); resetCameraPopupTriggers(); };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  });
  $effect(() => {
    if (!dialog) return;
    if (!active) { dialog.close(); return; }
    if (!dialog.open) dialog.showModal();
    const current = active.nonce;
    const timer = setTimeout(() => { if (cameraPopup.active?.nonce === current) close(); }, active.seconds * 1000);
    return () => clearTimeout(timer);
  });
</script>
<dialog class="camera-popup-fullscreen" bind:this={dialog!} onclose={close} aria-label={active?.label ?? m.camera_popup_title()}>
  {#if active}
    {#key active.camera}<CameraFeed entityId={active.camera} label={active.label} disableFullscreen={true} pauseInStandby={false} />{/key}
    <button class="secondary-btn pressable" onclick={close} autofocus>{m.camera_fullscreen_close({ label: active.label })}</button>
  {/if}
</dialog>
<style>
  dialog { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: var(--color-surface-0); color: var(--color-text-primary); }
  dialog[open] { display: flex; flex-direction: column; }
  dialog :global(.camera-feed) { flex: 1; min-height: 0; width: 100%; border-radius: 0; display: flex; flex-direction: column; }
  dialog :global(.camera-feed-frame) { flex: 1; min-height: 0; aspect-ratio: auto; }
  dialog :global(.camera-feed-frame img), dialog :global(.camera-feed-frame video) { width: 100%; height: 100%; object-fit: contain; }
  button { margin: var(--space-3); align-self: center; }
</style>
