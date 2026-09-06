<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Erkannte Flächen über dem laufenden Raumbild (Paket 13, Simulator).
     Die Diagnose zeigt dieselben Polygone auf der Bildliste; hier liegen sie
     auf der echten Bühne, in derselben Verzerrung wie das Bild. Damit lässt
     sich beurteilen, ob das Wetter im richtigen Fenster zieht — und ob die
     übrigen Arten dort sitzen, wo später etwas darauf aufsetzen soll.

     Wird nur vom Simulator eingeblendet und deshalb erst bei Bedarf geladen;
     der Startpfad sieht diese Datei nie. Beschriftung englisch wie der
     Katalog, das ist Werkstatt-Vokabular. */
  import { regionColor } from '../room-images/region-colors.ts';
  import type { RoomImageRegion } from '../state/room-image-library-client.ts';

  const { regions }: { regions: readonly RoomImageRegion[] } = $props();

  function points(region: RoomImageRegion): string {
    return region.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');
  }

  /* Beschriftung an den obersten linken Punkt, damit sie die Fläche nicht
     verdeckt und bei mehreren Flächen derselben Art unterscheidbar bleibt. */
  function anchor(region: RoomImageRegion): { x: number; y: number } {
    const top = region.points.reduce((best, point) => (point.y < best.y ? point : best), region.points[0]);
    return { x: Math.min(96, top.x * 100 + 0.6), y: Math.max(3, top.y * 100 - 1) };
  }
</script>

<svg class="region-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  {#each regions as region, index (index)}
    <polygon points={points(region)}
             fill={regionColor(region.kind)} fill-opacity="0.28"
             stroke={regionColor(region.kind)} stroke-width="1.5"
             vector-effect="non-scaling-stroke" />
  {/each}
</svg>
<div class="region-overlay-labels" aria-hidden="true">
  {#each regions as region, index (index)}
    <span class="region-overlay-label"
          style:left={`${anchor(region).x}%`}
          style:top={`${anchor(region).y}%`}
          style:--region-color={regionColor(region.kind)}>{region.kind}</span>
  {/each}
</div>

<style>
  .region-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* Über den Bildebenen und der Wetterschicht, unter dem Lampenlicht. */
    z-index: 2;
    pointer-events: none;
  }

  .region-overlay-labels {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }

  .region-overlay-label {
    position: absolute;
    transform: translateY(-100%);
    padding: 1px 5px;
    border-radius: var(--radius-sm, 4px);
    background: var(--region-color);
    color: #fff;
    font-size: 11px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.35);
    white-space: nowrap;
  }
</style>
