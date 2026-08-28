<script lang="ts">
  import CameraFeed from './CameraFeed.svelte';
  import { cameraPopouts, type CameraPopout } from '../state/camera-popouts.svelte.ts';

  let { item }: { item: CameraPopout } = $props();
  let root = $state<HTMLElement>();
  let dragging = $state(false);
  let suppressFullscreen = $state(false);
  let pointerId = -1;
  let startPointerX = 0;
  let startPointerY = 0;
  let startLeft = 0;
  let startTop = 0;

  const widthPercent = $derived(24 + item.size * 0.4);
  const positionStyle = $derived([
    `width:${widthPercent}%`,
    ...(item.x === null || item.y === null ? [] : [`left:${item.x}px`, `top:${item.y}px`]),
  ].join(';'));

  function clampPosition(): void {
    if (!root || item.x === null || item.y === null) return;
    const parent = root.parentElement;
    if (!parent) return;
    cameraPopouts.setPosition(
      item.entityId,
      Math.max(0, Math.min(item.x, parent.clientWidth - root.offsetWidth)),
      Math.max(0, Math.min(item.y, parent.clientHeight - root.offsetHeight)),
    );
  }

  function resize(size: number): void {
    cameraPopouts.setSize(item.entityId, size);
    requestAnimationFrame(clampPosition);
  }

  function pointerdown(event: PointerEvent): void {
    if (!root || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('.camera-context-menu')) return;
    const titlebarVisible = cameraPopouts.titlebarVisible(item.entityId);
    if (titlebarVisible && !target.closest('.camera-feed-caption')) return;
    if (!titlebarVisible && !target.closest('.camera-feed-frame')) return;

    const parent = root.parentElement;
    if (!parent) return;
    const bounds = root.getBoundingClientRect();
    const parentBounds = parent.getBoundingClientRect();
    pointerId = event.pointerId;
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    startLeft = bounds.left - parentBounds.left;
    startTop = bounds.top - parentBounds.top;
    dragging = true;
    suppressFullscreen = false;
    root.setPointerCapture(pointerId);
  }

  function pointermove(event: PointerEvent): void {
    if (!root || !dragging || event.pointerId !== pointerId) return;
    const parent = root.parentElement;
    if (!parent) return;
    const deltaX = event.clientX - startPointerX;
    const deltaY = event.clientY - startPointerY;
    if (deltaX !== 0 || deltaY !== 0) suppressFullscreen = true;
    const x = Math.max(0, Math.min(startLeft + deltaX, parent.clientWidth - root.offsetWidth));
    const y = Math.max(0, Math.min(startTop + deltaY, parent.clientHeight - root.offsetHeight));
    cameraPopouts.setPosition(item.entityId, x, y);
  }

  function pointerup(event: PointerEvent): void {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    if (root?.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    pointerId = -1;
    window.setTimeout(() => { suppressFullscreen = false; }, 0);
  }
</script>

<article
  class="camera-popout"
  class:is-dragging={dragging}
  class:titlebar-hidden={!cameraPopouts.titlebarVisible(item.entityId)}
  style={positionStyle}
  bind:this={root}
  onpointerdown={pointerdown}
  onpointermove={pointermove}
  onpointerup={pointerup}
  onpointercancel={pointerup}
>
  <CameraFeed
    entityId={item.entityId}
    label={item.label}
    titlebarVisible={cameraPopouts.titlebarVisible(item.entityId)}
    popoutMode={item.mode}
    disableFullscreen={suppressFullscreen}
    onpopout={() => cameraPopouts.open(item.entityId, item.label, item.roomId)}
    ondock={() => cameraPopouts.dock(item.entityId)}
    onmodechange={(mode) => cameraPopouts.setMode(item.entityId, mode)}
    ontoggletitlebar={() => cameraPopouts.toggleTitlebar(item.entityId)}
    size={item.size}
    onsizechange={resize}
  />
</article>
