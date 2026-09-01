<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import {
    appState, libItem, resumeTarget, epOf, openPlayer,
  } from '../state/app.svelte.ts';
  import { hydrateDetail, isHydrating } from '../state/library.svelte.ts';
  import { jellyfin } from '../adapter/jellyfin.ts';
  import { showScreen } from '../state/nav.svelte.ts';
  import { fmtRuntime, fmtResume } from '../format.ts';

  import { m } from '../../paraglide/messages.js';
  let { phone = false, titleAnchor = $bindable() }: { phone?: boolean; titleAnchor?: HTMLHeadingElement } = $props();
  const item = $derived(libItem(appState.library.currentId));
  const t = $derived(item ? resumeTarget(item) : null);
  const isSeries = $derived(item?.type === 'series');

  // Live: echte Staffeln/Folgen beim Öffnen nachladen (idempotent, No-op im Fake).
  $effect(() => { void hydrateDetail(appState.library.currentId); });

  const backdropUrl = $derived(
    item?.backdropTag
      ? jellyfin.imageUrl(item.id, { type: 'Backdrop', tag: item.backdropTag, maxWidth: 1280 })
      : null,
  );
  // Serie im Live-Modus vor der Hydration: noch keine spielbare Folge.
  const loadingEpisodes = $derived(isSeries && (!item?.seasons?.length || isHydrating(item?.id ?? null)));
  const canPlay = $derived(!!t && (!isSeries || !!t.ep));

  const metaParts = $derived(item ? [
    String(item.year),
    isSeries
      ? item.seasons!.length
        ? `${item.seasons!.length} ${item.seasons!.length === 1 ? m.library_season() : m.library_seasons()}`
        : m.library_series()
      : fmtRuntime(item.runtime!),
    `FSK ${item.fsk}`,
    item.genres.join(' · '),
  ] : []);

  const playLabel = $derived(
    !item || !t ? ''
    : isSeries
      ? t.ep
        ? `${t.resume ? m.library_continue() : m.library_play()} · S${t.season} E${t.ep.n}`
        : m.library_loading_episodes()
      : t.resume ? `Weiterschauen · ${fmtResume(t.pos, t.dur)}` : m.library_play());

  const season = $derived(item?.seasons?.find((s) => s.n === appState.library.season));

  function back() {
    showScreen('library');
  }

  function play(startPos: number) {
    if (!item || !t) return;
    openPlayer(item, isSeries ? { season: t.season!, ep: t.ep! } : null, startPos);
  }

  function playEpisode(epN: number) {
    if (!item) return;
    const seasonN = appState.library.season;
    const ep = epOf(item, seasonN, epN)!;
    openPlayer(item, { season: seasonN, ep }, ep.pos || 0);
  }
</script>

<!-- ── Media Detail (docs/07 Screen 7): Hero + Play/Resume, bei Serien
     Staffel-Pills + Folgenliste. Back-Button → Bibliothek. ── -->
<div class="screen-inner" class:phone-page={phone} class:phone-library-detail={phone}>
  {#if item && t}
    <div class="detail-hero" style="--ph:{item.hue}">
      {#if backdropUrl}<img class="hero-img" src={backdropUrl} alt="" />{/if}
      <button class="circle-btn hero-back pressable" type="button"
              aria-label={m.library_back()} onclick={back}><Icon name="i-back" /></button>
      <div class="hero-scrim"></div>
      <div class="hero-content">
        <h1 class="hero-title" bind:this={titleAnchor} tabindex="-1">{item.title}</h1>
        <div class="hero-meta num">
          {#each metaParts as p, i (i)}{#if i > 0}<span class="meta-dot">·</span>{/if}<span>{p}</span>{/each}
        </div>
        <div class="hero-actions">
          <button class="btn-primary pressable" type="button" disabled={!canPlay} onclick={() => play(t.pos)}>
            <Icon name="i-play" cls="icon icon-md" /><span>{playLabel}</span>
          </button>
          {#if t.resume && canPlay}<button class="btn-hero-ghost pressable" type="button" onclick={() => play(0)}>{m.library_from_start()}</button>{/if}
        </div>
      </div>
    </div>
    <p class="detail-overview">{item.overview}</p>
    {#if isSeries && loadingEpisodes}
      <section class="detail-section">
        <p class="detail-loading caps-label" aria-busy="true">{m.library_loading_episodes()}</p>
      </section>
    {:else if isSeries && season}
      <section class="detail-section">
        <div class="season-row" role="radiogroup" aria-label={m.library_pick_season()}>
          {#each item.seasons! as s (s.n)}
            <button class="season-pill pressable" class:is-active={s.n === appState.library.season}
                    type="button" role="radio" aria-checked={s.n === appState.library.season}
                    onclick={() => { appState.library.season = s.n; }}>Staffel {s.n}</button>
          {/each}
        </div>
        <div class="episode-list">
          {#each season.episodes as ep (ep.n)}
            <button class="episode-row pressable" class:is-watched={ep.watched} type="button"
                    onclick={() => playEpisode(ep.n)}>
              <span class="ep-num num">{ep.n}</span>
              <span class="ep-title">{ep.title}</span>
              <span class="ep-state">
                {#if ep.watched}
                  <Icon name="i-check" cls="icon icon-sm" /><span>{m.library_watched()}</span>
                {:else if ep.pos > 0}
                  <span class="ep-progress"><span class="ep-progress-fill" style="transform:scaleX({(ep.pos / ep.dur).toFixed(3)})"></span></span><span class="num">{m.library_remaining({ minutes: Math.round((ep.dur - ep.pos) / 60) })}</span>
                {:else}
                  <span class="num">{Math.round(ep.dur / 60)} min</span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>
