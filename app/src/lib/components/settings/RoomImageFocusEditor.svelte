<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { roomImageFocus, setRoomImageFocus } from '../../state/room-display-config.svelte.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  let { roomId, imageUrl }: { roomId: string; imageUrl: string } = $props();
  let target = $state<'phone' | 'panel'>('phone');
  const point = $derived(roomImageFocus(roomId, target) ?? roomHeroConfig(roomId)?.focus[target] ?? { x: 0.5, y: 0.5 });
  function adjust(axis: 'x' | 'y', value: string) {
    setRoomImageFocus(roomId, target, { ...point, [axis]: Number(value) / 100 });
  }
</script>

<div class="focus-editor">
  <select aria-label={m.img_focus_target()} bind:value={target}>
    <option value="phone">{m.img_focus_phone()}</option><option value="panel">{m.img_focus_panel()}</option>
  </select>
  <div class="focus-preview" role="img" aria-label={m.img_focus()} style:background-image={`url("${imageUrl}")`}
       style:background-position={`${point.x * 100}% ${point.y * 100}%`} style:aspect-ratio={target === 'phone' ? '9 / 16' : '16 / 10'}></div>
  <label>{m.img_focus_horizontal()}<input type="range" min="0" max="100" value={point.x * 100} oninput={event => adjust('x', event.currentTarget.value)} /></label>
  <label>{m.img_focus_vertical()}<input type="range" min="0" max="100" value={point.y * 100} oninput={event => adjust('y', event.currentTarget.value)} /></label>
</div>

<style>
  .focus-editor { display: grid; gap: var(--space-3); padding-block: var(--space-3); }
  .focus-preview { width: min(100%, calc(var(--space-8) * 8)); max-height: calc(var(--space-8) * 12); background-size: cover; border-radius: var(--radius-lg); }
  label { display: grid; gap: var(--space-2); }
  input, select { min-height: var(--touch-min); }
</style>
