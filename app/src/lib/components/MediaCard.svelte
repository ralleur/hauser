<script lang="ts">
  /* MediaCard (docs/08): echtes Jellyfin-Poster (Primary-Image mit tag+maxWidth)
     sobald ein `primaryTag` vorliegt, sonst der Farbton-Platzhalter (Fake-Daten
     bzw. Serien/Filme ohne Artwork). Resume-Fortschrittsbalken unten im Poster. */
  import { continueInfo, openMediaItem, type LibraryItem } from '../state/app.svelte.ts';
  import { jellyfin } from '../adapter/jellyfin.ts';

  let { item }: { item: LibraryItem } = $props();

  let imgFailed = $state(false);
  const posterUrl = $derived(
    item.primaryTag && !imgFailed
      ? jellyfin.imageUrl(item.id, { type: 'Primary', tag: item.primaryTag, maxWidth: 300 })
      : null,
  );

  const cw = $derived(continueInfo(item));
  const meta = $derived(
    cw
      ? cw.meta
      : item.type === 'series'
        ? item.seasons!.length
          ? `${item.year} · ${item.seasons!.length} ${item.seasons!.length === 1 ? 'Staffel' : 'Staffeln'}`
          : `${item.year} · Serie`
        : String(item.year),
  );
</script>

<button class="media-card pressable" type="button" data-item={item.id}
        onclick={() => openMediaItem(item.id)}>
  <span class="poster" style="--ph:{item.hue}">
    {#if posterUrl}
      <img class="poster-img" src={posterUrl} alt="" loading="lazy" onerror={() => (imgFailed = true)} />
    {:else}
      <span class="poster-genre caps-label">{item.genres[0]}</span>
      <span class="poster-title">{item.title}</span>
    {/if}
    {#if cw}<span class="card-progress"><span class="card-progress-fill" style="transform:scaleX({cw.frac.toFixed(3)})"></span></span>{/if}
  </span>
  <span class="card-title">{item.title}</span>
  <span class="card-meta num">{meta}</span>
</button>
