<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Flächenerkennung ansehen (Paket 13): jedes Bildset mit den Polygonen, die
     das Sehmodell gefunden hat, farbig darübergelegt — eine Farbe je Art. Der
     Zweck ist genau einer: beurteilen, ob die Erkennung taugt, bevor etwas
     darauf aufbaut. Deshalb hängt die Ansicht in der versteckten Diagnose und
     nicht in den Einstellungen. Die Artnamen bleiben englische Schlüssel; das
     ist kein Produkttext, sondern das Vokabular des Katalogs.
     Erkennen kostet einen Modellaufruf; er wird nur auf Knopfdruck ausgelöst. */
  import { onMount } from 'svelte';
  import {
    detectRoomImageRegions,
    loadRoomImageLibrary,
    type RoomImageLibraryAsset,
    type RoomImageRegion,
  } from '../state/room-image-library-client.ts';
  import { m } from '../../paraglide/messages.js';
  import { regionColor } from '../room-images/region-colors.ts';

  let assets = $state<RoomImageLibraryAsset[]>([]);
  let loadError = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let failures = $state<Record<string, string>>({});

  onMount(() => {
    void loadRoomImageLibrary()
      .then((library) => { assets = library.assets; })
      .catch((error: unknown) => {
        loadError = error instanceof Error ? error.message : m.rimg_regions_failed();
      });
  });

  async function detect(asset: RoomImageLibraryAsset): Promise<void> {
    busy = asset.assetId;
    const { [asset.assetId]: _gone, ...rest } = failures;
    failures = rest;
    try {
      const regions = await detectRoomImageRegions(asset.assetId);
      assets = assets.map((entry) => (entry.assetId === asset.assetId ? { ...entry, regions } : entry));
    } catch (error: unknown) {
      failures = {
        ...failures,
        [asset.assetId]: error instanceof Error ? error.message : m.rimg_regions_failed(),
      };
    } finally {
      busy = null;
    }
  }

  /* Punkte in Anteilen → SVG-Polygon in Prozent des Viewports. Das Bild
     darunter füllt dieselbe Fläche, damit beides deckungsgleich liegt. */
  function polygonPoints(region: RoomImageRegion): string {
    return region.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');
  }

  function color(kind: string): string {
    return regionColor(kind);
  }

  /** Welche Arten das Set gefunden hat, mit Anzahl — als knappe Legende. */
  function summary(asset: RoomImageLibraryAsset): string {
    const counts = new Map<string, number>();
    for (const region of asset.regions?.regions ?? []) {
      counts.set(region.kind, (counts.get(region.kind) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => `${kind} ${count}`).join(' · ');
  }

  /* `variants.light` ist bereits die vollständige Adresse — sie hier noch
     einmal zusammenzusetzen ergab einen doppelten Pfad und 404. */
  function heroUrl(asset: RoomImageLibraryAsset): string {
    return asset.variants.light;
  }
</script>

<section class="region-debug">
  <h3>{m.diag_regions_title()}</h3>
  <p class="region-debug-hint">{m.diag_regions_hint()}</p>

  {#if loadError}
    <p class="region-debug-error" role="alert">{loadError}</p>
  {:else if assets.length === 0}
    <p class="region-debug-hint">{m.diag_regions_empty()}</p>
  {/if}

  {#each assets as asset (asset.assetId)}
    <figure class="region-debug-item">
      <div class="region-debug-stage">
        <img src={heroUrl(asset)} alt="" loading="lazy" />
        {#if asset.regions}
          <svg class="region-debug-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {#each asset.regions.regions as region, index (index)}
              <polygon points={polygonPoints(region)}
                       fill={color(region.kind)} fill-opacity="0.35"
                       stroke={color(region.kind)} stroke-width="0.4"
                       vector-effect="non-scaling-stroke" />
            {/each}
          </svg>
        {/if}
      </div>
      <figcaption>
        <span class="region-debug-count num">
          {#if asset.regions}
            {summary(asset) || m.diag_regions_none()}
          {:else}
            {m.diag_regions_none()}
          {/if}
        </span>
        <button class="secondary-btn pressable" type="button"
                disabled={busy !== null}
                onclick={() => detect(asset)}>
          {busy === asset.assetId ? m.diag_regions_running() : m.diag_regions_detect()}
        </button>
      </figcaption>
    </figure>
    {#if failures[asset.assetId]}
      <p class="region-debug-error" role="alert">{failures[asset.assetId]}</p>
    {/if}
  {/each}
</section>

<style>
  .region-debug {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
    display: grid;
    gap: var(--space-3);
  }

  .region-debug h3 {
    margin: 0;
    font-size: var(--text-base);
  }

  .region-debug-hint {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .region-debug-error {
    margin: 0;
    color: var(--color-danger, #d9534f);
    font-size: var(--text-sm);
  }

  .region-debug-item {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  /* Bild und Polygone teilen sich exakt dieselbe Fläche — sonst zeigt die
     Kontrolle an der falschen Stelle hin. */
  .region-debug-stage {
    position: relative;
    aspect-ratio: 3 / 2;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface-2);
  }

  .region-debug-stage img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .region-debug-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .region-debug-item figcaption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }
</style>
