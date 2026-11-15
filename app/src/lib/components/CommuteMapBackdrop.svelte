<script module lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-only
  // One native-resolution texture survives switching home/commute. No SVG tree
  // or geometry parsing is repeated during the zoom/route animation.
  let cached: { roads: unknown; areas: unknown; key: string; canvas: HTMLCanvasElement } | undefined;
</script>

<script lang="ts">
  import { appState } from '../state/app.svelte.ts';
  import type { CommuteRoute, MapPoint } from '../state/commute.ts';
  let { roads, areas, width, height, scale, tx, ty, colors }: {
    roads: MapPoint[][]; areas: NonNullable<CommuteRoute['areas']>;
    width: number; height: number; scale: number; tx: number; ty: number; colors: boolean;
  } = $props();
  let canvas = $state<HTMLCanvasElement>();
  $effect(() => {
    if (!canvas || !width || !height || !scale) return;
    const target = canvas, mapRoads = roads, mapAreas = areas;
    const ratio = window.devicePixelRatio || 1;
    const key = [width, height, scale, tx, ty, colors, appState.theme, ratio].join(':');
    const frame = requestAnimationFrame(() => {
      target.width = Math.ceil(width * ratio); target.height = Math.ceil(height * ratio);
      const output = target.getContext('2d')!;
      if (cached?.roads === mapRoads && cached.areas === mapAreas && cached.key === key) {
        output.drawImage(cached.canvas, 0, 0); return;
      }
      const image = document.createElement('canvas');
      image.width = target.width; image.height = target.height;
      const context = image.getContext('2d')!;
      const style = getComputedStyle(target);
      const token = (name: string) => style.getPropertyValue(name).trim();
      context.setTransform(scale * ratio, 0, 0, scale * ratio, tx * ratio, ty * ratio);
      function path(points: MapPoint[], result: Path2D) {
        points.forEach(([x, y], i) => { if (i) result.lineTo(x, y); else result.moveTo(x, y); });
      }
      if (colors) for (const layer of ['green', 'water']) {
        // Composite a whole layer once: overlapping parks keep the same opacity.
        const layerImage = document.createElement('canvas');
        layerImage.width = image.width; layerImage.height = image.height;
        const ink = layerImage.getContext('2d')!;
        ink.setTransform(scale * ratio, 0, 0, scale * ratio, tx * ratio, ty * ratio);
        ink.fillStyle = token(`--ambient-map-${layer}`);
        for (const area of mapAreas) if (area.layer === layer) {
          const polygon = new Path2D();
          for (const ring of area.rings) { path(ring, polygon); polygon.closePath(); }
          ink.fill(polygon, 'evenodd');
        }
        context.save(); context.resetTransform();
        context.globalAlpha = Number(token(`--ambient-map-${layer}-opacity`));
        context.drawImage(layerImage, 0, 0); context.restore();
      }
      const streets = new Path2D();
      for (const road of mapRoads) path(road, streets);
      context.strokeStyle = token('--color-text-primary');
      context.globalAlpha = Number(token('--opacity-ambient-map'));
      context.lineWidth = parseFloat(token('--commute-line-thin')) / scale;
      context.lineCap = context.lineJoin = 'round';
      context.stroke(streets);
      cached = { roads: mapRoads, areas: mapAreas, key, canvas: image };
      output.drawImage(image, 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas { display: block; width: 100%; height: 100%; }
</style>
