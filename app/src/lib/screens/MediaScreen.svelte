<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { appState } from '../state/app.svelte.ts';
  import {
    mergedMedia, mediaStateLabel, mediaPending, mediaReconcile, mediaPosition,
    toggleMedia, setVolume, playPreset, skipTrack, type Preset,
  } from '../state/media.svelte.ts';
  import { slider } from '../actions/slider.ts';
  import { pulse } from '../actions/pulse.ts';
  import { fmtTime } from '../format.ts';
  import type { MediaValue } from '../adapter/types.ts';

  import { m } from '../../paraglide/messages.js';
  let { phone = false, titleAnchor = $bindable() }: { phone?: boolean; titleAnchor?: HTMLHeadingElement } = $props();
  const current = $derived(appState.media.current);
  const player = $derived(mergedMedia(current));         // gemergte Sicht (ADR-017)
  const position = $derived(mediaPosition(current));      // lokale Simulation
  const pending = $derived(mediaPending(current));        // 5-s-Timeout → Dot
  const idle = $derived(player.available && !player.track);

  /* Widerspruch (docs/02): Play/Pause → Wobble, Volume → 300-ms-Korrektur.
     Ein media_player-Entity, also aus dem optimistisch/Server-Diff ableiten,
     welches Control reagiert. seq global monoton → alte Events beim Player-
     Wechsel (kleinere seq) werden ignoriert. */
  let playWobble = $state(0);
  let volumeCorrect = $state(0);
  let seenSeq = 0;
  $effect(() => {
    const ev = mediaReconcile(current);
    if (!ev || ev.seq <= seenSeq) return;
    seenSeq = ev.seq;
    const o = ev.optimistic as Partial<MediaValue>;
    const s = ev.server as MediaValue;
    if (o.playing !== undefined && o.playing !== s.playing) playWobble++;
    if (o.volume !== undefined && o.volume !== s.volume) volumeCorrect++;
  });

  /* Raum-Auswahl: reiner Anzeige-Wechsel (Flow 3: kein HA-Command) */
  function selectPlayer(id: string) {
    if (id === current) return;
    appState.media.current = id;
  }

  function playPresetOn(preset: Preset) {
    playPreset(current, preset);
  }
</script>

<!-- ── Media (docs/07 Screen 3): MediaControl Expanded + Room-Selector ── -->
<div class="screen-inner" class:phone-page={phone} class:phone-media={phone}>
  <h1 class="screen-title" bind:this={titleAnchor} tabindex="-1">Media</h1>
  <section class="detail-section">
    <span class="caps-label">{m.media_room()}</span>
    <div class="select-grid">
      {#each appState.media.players as p (p.id)}
        {@const pv = mergedMedia(p.id)}
        <button class="ghost-card pressable" class:is-active={p.id === current} class:is-unavailable={!pv.available}
                type="button" data-player={p.id} role="radio" aria-checked={p.id === current}
                onclick={() => selectPlayer(p.id)}>
          <span class="ghost-card-value">{p.name}</span>
          <span class="ghost-card-label">{mediaStateLabel(pv)}</span>
        </button>
      {/each}
    </div>
  </section>

  <div class="media-layout">
    <section class="detail-section">
      <span class="caps-label">{m.media_playback()}</span>
      <!-- key: Raum-Wechsel baut die Karte neu auf (wie renderMedia() im
           Clickdummy) — sonst behielte der Slider den Paint des Vor-Players -->
      {#key current}
      <div class="player-card" class:is-unavailable={!player.available} class:is-idle={idle}>
        <div class="player-track">
          {#if !player.available}
            <Icon name="i-media" cls="icon icon-xl" /><span class="player-title is-muted">{m.media_unavailable()}</span><span class="player-artist">{m.media_player_unreachable()}</span>
          {:else if idle}
            <Icon name="i-media" cls="icon icon-xl" /><span class="player-title is-muted">{m.media_no_playback()}</span><span class="player-artist">{m.media_pick_preset()}</span>
          {:else}
            <span class="player-title">{player.track}</span><span class="player-artist">{player.artist}</span>
          {/if}
        </div>

        <div class="player-progress" class:is-hidden={!player.duration}>
          <div class="progress-track"><div class="progress-fill" style="transform:scaleX({player.duration ? position / player.duration : 0})"></div></div>
          <div class="progress-times">
            <span>{fmtTime(position)}</span>
            <span>{fmtTime(player.duration)}</span>
          </div>
        </div>

        <div class="transport">
          <button class="transport-btn pressable" type="button"
                  aria-label={m.media_previous_track()} disabled={!(player.available && player.track)}
                  onclick={() => skipTrack(current, 'prev')}>
            <Icon name="i-prev" />
          </button>
          <button class="transport-btn transport-play pressable" type="button"
                  aria-label={player.playing ? m.media_pause() : m.media_playback()} disabled={!(player.available && player.track)}
                  use:pulse={{ seq: playWobble, cls: 'is-wobble', ms: 200 }}
                  onclick={() => toggleMedia(current)}>
            <Icon name={player.playing ? 'i-pause' : 'i-play'} cls="icon icon-play" />
            {#if pending}<span class="pending-dot" aria-hidden="true"></span>{/if}
          </button>
          <button class="transport-btn pressable" type="button"
                  aria-label={m.media_next_track()} disabled={!(player.available && player.track)}
                  onclick={() => skipTrack(current, 'next')}>
            <Icon name="i-next" />
          </button>
        </div>

        <div class="player-volume" class:is-disabled={!player.available}>
          <Icon name="i-speaker" cls="icon icon-md" />
          <div class="slider" use:slider={{
            value: player.volume,
            disabled: !player.available,
            correct: volumeCorrect,
            onChange: (val, final) => {
              // Nur der Release dispatcht (docs/02 Slider); der Thumb folgt
              // während des Drags dem Finger (Slider-Action).
              if (final) setVolume(current, val);
            },
          }}>
            <div class="slider-track"><div class="slider-fill"></div></div>
            <div class="slider-thumb num">{player.volume}</div>
          </div>
        </div>

        <div class="player-source">
          <span class="caps-label">{m.media_source()}</span>
          <span class="source-value">{player.available ? (player.source ?? '—') : '—'}</span>
        </div>
      </div>
      {/key}
    </section>

    <section class="detail-section">
      <span class="caps-label">{m.media_presets()}</span>
      <div class="preset-grid">
        {#each appState.media.presets as pr, i (i)}
          <button class="ghost-card pressable" type="button" data-preset={i} disabled={!player.available}
                  onclick={() => playPresetOn(pr)}>
            <span class="ghost-card-label">{pr.label}</span>
            <span class="ghost-card-value">{pr.value}</span>
          </button>
        {/each}
      </div>
    </section>
  </div>
</div>
