<script lang="ts">
  import Icon from './Icon.svelte';
  import { relativeDuration, type HmiNotification } from '../state/notifications.ts';

  import { m } from '../../paraglide/messages.js';
  let { item, now, ondismiss }: { item: HmiNotification; now: number; ondismiss: () => void } = $props();
  let tile = $state<HTMLElement | null>(null);
  let drag = $state(0);
  let startX = 0;
  let startedAt = 0;
  let dragging = $state(false);
  const elapsed = $derived(relativeDuration(item.createdAt, now));
  const sourceLabel = $derived(item.source.endsWith('washer')
    ? m.notif_washer()
    : item.source.endsWith('dryer') ? m.notif_dryer() : item.source);

  function pointerdown(event: PointerEvent): void {
    startX = event.clientX;
    startedAt = performance.now();
    dragging = true;
    tile?.setPointerCapture(event.pointerId);
  }

  function pointermove(event: PointerEvent): void {
    if (!dragging) return;
    drag = Math.max(0, event.clientX - startX);
  }

  function pointerup(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    const elapsedMs = Math.max(1, performance.now() - startedAt);
    const velocity = drag / elapsedMs;
    if (tile && (drag >= tile.clientWidth * 0.3 || velocity > 0.3)) ondismiss();
    else drag = 0;
    tile?.releasePointerCapture(event.pointerId);
  }
</script>

<article bind:this={tile} class="notification-tile is-{item.type}" class:is-dragging={dragging}
         style={`--notification-drag:${drag}px`}
         onpointerdown={pointerdown} onpointermove={pointermove} onpointerup={pointerup} onpointercancel={pointerup}>
  <div class="notification-icon"><Icon name={item.icon ?? 'i-bell'} cls="icon icon-xl" /></div>
  <div class="notification-copy">
    <span class="notification-source"><span class="notification-dot"></span>{sourceLabel}</span>
    <strong>{item.title}</strong>
    <span class="notification-time num">{item.state === 'done' ? m.notif_ago() : m.notif_since()} {elapsed}</span>
  </div>
  <button class="notification-dismiss pressable" type="button" aria-label={`${item.title} bestätigen`}
          onclick={(event) => { event.stopPropagation(); ondismiss(); }}><Icon name="i-close" cls="icon icon-md" /></button>
</article>
