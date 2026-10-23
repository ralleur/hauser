<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { bodyPortal } from '../../actions/body-portal.ts';
  import ImageWorkspaceBackground from './ImageWorkspaceBackground.svelte';
  import { onMount } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import '../../../styles/room-images.css';
  import RoomImageEditor from './RoomImageEditor.svelte';
  let { roomId, name, initialAction = null, onclose, onarrange }: { roomId: string; name: string; initialAction?: 'generate' | 'manual' | 'library' | null; onclose: () => void; onarrange?: () => void } = $props();
  let dialog: HTMLDivElement;
  onMount(() => { const previous = document.activeElement; dialog.focus(); return () => { if (previous instanceof HTMLElement) previous.focus(); }; });
  function keydown(event: KeyboardEvent) {
    if (event.target instanceof Element && event.target.closest('.room-image-wizard') !== dialog) return;
    if (event.key === 'Escape' && event.target instanceof Node && dialog.contains(event.target)) { event.stopPropagation(); onclose(); }
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select, input:not([hidden]), a[href]')].filter(item => item.getClientRects().length > 0);
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }
</script>
<div use:bodyPortal class="room-image-wizard-layer image-workspace-layer on-image" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
  <ImageWorkspaceBackground roomId={roomId} />
  <div bind:this={dialog} class="room-image-wizard image-editor-dialog" role="dialog" aria-modal="true" aria-label={`${name} · ${m.img_edit()}`} tabindex="-1" onkeydown={keydown}>
    <header class="room-image-wizard-head"><div><span class="caps-label">{m.img_edit()}</span><h2>{name}</h2></div><button class="dialog-close pressable" type="button" aria-label={m.common_close()} onclick={onclose}>×</button></header>
    <RoomImageEditor {roomId} {initialAction} {onarrange} onleave={onclose} />
  </div>
</div>
<style>
  .image-editor-dialog { max-width: calc(var(--space-8) * 24); }
  .image-editor-dialog:has(:global(.image-setup)) { max-width: calc(var(--space-8) * 40); }
</style>
