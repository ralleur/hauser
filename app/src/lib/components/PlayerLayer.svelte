<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import {
    appState, adjacentEpisode, writeThrough, closePlayer, sendJellyfin,
  } from '../state/app.svelte.ts';
  import { usingLiveLibrary } from '../state/library.svelte.ts';
  import {
    liveStream, liveLoading, liveError,
    startLive, stopLive, reportLiveProgress, attachHls,
  } from '../state/playback.svelte.ts';
  import { slider } from '../actions/slider.ts';
  import { fmtClock } from '../format.ts';

  import { m } from '../../paraglide/messages.js';
  const CHROME_HIDE_MS = 4000;
  const PROGRESS_INTERVAL_MS = 10_000; // Fortschritts-Reporting-Kadenz (docs/08)

  const pb = $derived(appState.playback);
  const withH = $derived(pb ? pb.duration >= 3600 : false);
  const sub = $derived(pb
    ? (pb.ep ? `S${pb.season} E${pb.ep.n} · ${pb.ep.title}` : pb.item.genres.join(' · '))
    : '');

  /* Jellyfin-Item-Id der aktuellen Quelle: Film = Item, Folge = ep.jfId. Der
     Wechsel dieser Id (Folgensprung/Öffnen/Schließen) treibt Start/Stopp der
     Live-Session — pb selbst bleibt beim Folgensprung dasselbe Objekt. */
  const jfItemId = $derived(pb ? (pb.ep?.jfId ?? pb.item.id) : null);

  let videoEl: HTMLVideoElement | undefined = $state();
  let buffering = $state(false);
  let lastPos = 0; // letzte bekannte Position fürs Stopped-Reporting beim Schließen
  // Resume-Ziel: der HLS-Master ist voll-timeline (currentTime = absolut), und
  // hls.js startet bei 0 — StartTimeTicks allein bewegt den Playhead NICHT. Wir
  // springen daher selbst an den Resume-Punkt, sobald das <video> seekbar ist.
  let resumeSeekPos = 0;
  let resumeSeekApplied = false;

  let chromeHidden = $state(false);
  let ccActive = $state(false);
  let chromeTimer: ReturnType<typeof setTimeout> | undefined;

  /* ── Live-Wiedergabe (Funktionsumfang 9, docs/08) ──
     Nur im Live-Modus; der Fake-Pfad (1-Hz-Tick) läuft unverändert weiter. */

  // Session-Start/-Stopp an der jfItemId: bei Öffnen/Folgensprung neue Session,
  // beim Schließen (id→null) meldet die Cleanup den Stopp mit letzter Position.
  $effect(() => {
    if (!usingLiveLibrary) return;
    const id = jfItemId;
    if (!id) return;
    const startPos = untrack(() => appState.playback?.position ?? 0);
    if (appState.playback) appState.playback.live = true; // Fake-Tick abschalten
    lastPos = startPos;
    resumeSeekPos = startPos; // an diesen Punkt springen, sobald seekbar
    resumeSeekApplied = false;
    void startLive(id, startPos);
    return () => stopLive(lastPos);
  });

  // HLS-Quelle ans <video> binden (hls.js/native); Cleanup löst den Player.
  $effect(() => {
    const el = videoEl;
    const url = liveStream()?.url;
    if (!el || !url) return;
    const detach = attachHls(el, url);
    if (untrack(() => appState.playback?.playing)) void el.play().catch(() => {});
    return detach;
  });

  // 10-s-Fortschritt (docs/08) — zusätzlich zu den Event-Reports bei Pause/Seek.
  $effect(() => {
    if (!usingLiveLibrary || !liveStream()) return;
    const iv = setInterval(() => {
      const p = appState.playback;
      if (p?.playing) reportLiveProgress(p.position, false, 'timeupdate');
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(iv);
  });

  function onTimeUpdate() {
    const p = appState.playback;
    const el = videoEl;
    if (!p || !el) return;
    p.position = el.currentTime;
    lastPos = p.position;
    writeThrough(p);
  }
  function onLoadedMeta() {
    const p = appState.playback;
    const el = videoEl;
    if (!p || !el) return;
    if (Number.isFinite(el.duration) && el.duration > 0) p.duration = el.duration;
    applyResumeSeek();
  }

  // Einmalig an den Resume-Punkt springen. currentTime ist absolut (voll-
  // timeline HLS); hls.js lädt daraufhin das Segment an der Stelle nach. Erst
  // ab „seekbar" (Dauer bekannt) sinnvoll — sonst auf canplay erneut versucht.
  function applyResumeSeek() {
    const el = videoEl;
    if (!el || resumeSeekApplied || resumeSeekPos <= 1) return;
    if (!Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = Math.min(resumeSeekPos, el.duration - 1);
    resumeSeekApplied = true;
  }

  function onCanPlay() {
    buffering = false;
    applyResumeSeek(); // Fallback, falls die Dauer erst hier feststand
  }
  function onSeeked() {
    const p = appState.playback;
    if (!p) return;
    reportLiveProgress(p.position, !p.playing, 'seek');
  }
  function onEnded() {
    const p = appState.playback;
    if (!p) return;
    p.playing = false;
    p.position = p.duration;
    writeThrough(p);
    reportLiveProgress(p.duration, true, 'pause');
    pokeChrome();
  }

  function pokeChrome() {
    chromeHidden = false;
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => {
      if (appState.playback?.playing) chromeHidden = true;
    }, CHROME_HIDE_MS);
  }

  /* Öffnen: Chrome zeigen + Auto-Hide armieren; Schließen: Timer weg.
     ccActive resettet pro Wiedergabe-Start (wie renderPlayer im Clickdummy). */
  $effect(() => {
    if (appState.playback) {
      ccActive = false;
      pokeChrome();
    } else {
      clearTimeout(chromeTimer);
      chromeHidden = false;
    }
  });

  /* Ende/Pause von außen (1-Hz-Tick): Chrome kommt zurück */
  $effect(() => {
    if (appState.playback && !appState.playback.playing) pokeChrome();
  });

  function toggle() {
    if (!pb) return;
    // Live: das <video> ist die alleinige Wahrheit für play/pause — direkt
    // steuern; die play/pause-Events spiegeln pb.playing (Icon) und melden an
    // Jellyfin. So kann Icon und Videozustand nicht auseinanderlaufen. Fake:
    // wie gehabt über pb.playing + sendJellyfin.
    if (usingLiveLibrary) {
      const el = videoEl;
      if (el) {
        if (el.paused) { void el.play().catch(() => {}); pb.playing = true; reportLiveProgress(pb.position, false, 'unpause'); }
        else { el.pause(); pb.playing = false; reportLiveProgress(pb.position, true, 'pause'); }
      } else pb.playing = !pb.playing; // Quelle lädt noch — Fallback
      pokeChrome();
      return;
    }
    pb.playing = !pb.playing;
    sendJellyfin(pb.playing ? 'Sessions/Playing' : 'Sessions/Playing/Progress',
      { paused: !pb.playing, position: Math.round(pb.position) });
    pokeChrome();
  }

  function jump(dir: 1 | -1) {
    if (!pb) return;
    const nx = adjacentEpisode(pb, dir);
    if (!nx) return;
    writeThrough(pb);
    Object.assign(pb, {
      season: nx.season, ep: nx.ep, duration: nx.ep.dur,
      position: nx.ep.pos || 0, playing: true,
    });
    ccActive = false; // neue Folge = frisches Chrome (renderPlayer-Pendant)
    // Live: die geänderte ep.jfId treibt den Session-Wechsel (Effekt oben).
    if (!usingLiveLibrary) {
      sendJellyfin('Sessions/Playing', { item: pb.item.id, episode: `S${nx.season}E${nx.ep.n}` });
    }
    pokeChrome();
  }

  function tool(name: 'audio' | 'cc' | 'settings') {
    if (name === 'cc') ccActive = !ccActive; // Mock-Toggle
    sendJellyfin('TrackSelection', { tool: name });
    pokeChrome();
  }

  /* Tap auf die Videofläche: Chrome ein-/ausblenden; Interaktion mit dem
     Chrome selbst resettet nur den Auto-Hide-Timer */
  function stageClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.player-chrome')) return;
    if (chromeHidden) {
      pokeChrome();
    } else if (appState.playback?.playing) {
      clearTimeout(chromeTimer);
      chromeHidden = true;
    }
  }

  function layerPointerdown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('.player-chrome')) pokeChrome();
  }
</script>

<!-- ── Player (docs/07 Screen 8): Vollbild-Layer ÜBER der App inkl. Tab-Bar —
     Wiedergabe ist ein eigener Kontext, kein Tab. Mockup ohne echtes Video
     (HLS-<video> kommt mit dem Jellyfin-Adapter, ADR-009); Transport-Controls
     sind HMI-eigen, keine Browser-Defaults. ── -->
<div class="player-layer" class:is-on={!!pb} class:is-chrome-hidden={chromeHidden}
     aria-hidden={pb ? 'false' : 'true'} onpointerdown={layerPointerdown}>
  {#if pb}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
         — Videofläche: Tap toggelt nur das Chrome (docs/07 Screen 8) -->
    <div class="player-stage" style="--ph:{pb.item.hue}" onclick={stageClick}>
      {#if usingLiveLibrary}
        <!-- Echtes HLS-<video> (ADR-009): eigene Fläche, HMI-Transport-Controls
             liegen als Chrome darüber. Keine Browser-Default-Controls. -->
        <!-- svelte-ignore a11y_media_has_caption — Untertitel via HLS-Tracks, kein <track> -->
        <video bind:this={videoEl} class="player-video" playsinline
               ontimeupdate={onTimeUpdate} onloadedmetadata={onLoadedMeta}
               onended={onEnded} onseeked={onSeeked}
               onwaiting={() => (buffering = true)} oncanplay={onCanPlay}
               onplaying={() => (buffering = false)}></video>
        {#if liveError()}
          <div class="player-overlay">
            <span class="caps-label">{liveError()}</span>
            <button class="btn-hero-ghost pressable" type="button"
                    onclick={() => closePlayer()}>{m.player_back()}</button>
          </div>
        {:else if liveLoading() || !liveStream()}
          <div class="player-overlay"><span class="caps-label" aria-busy="true">{m.player_starting()}</span></div>
        {:else if buffering}
          <div class="player-overlay player-overlay-soft" aria-hidden="true"><span class="player-spinner"></span></div>
        {/if}
      {:else}
        <span class="stage-hint caps-label">Wiedergabe · Mockup — Phase 3: HLS-Video (ADR-009)</span>
      {/if}
      <div class="player-chrome player-top">
        <button class="circle-btn pressable" type="button" aria-label={m.player_back()}
                onclick={() => closePlayer()}><Icon name="i-back" /></button>
        <div class="p-title-wrap">
          <span class="p-title">{pb.item.title}</span>
          <span class="p-sub">{sub}</span>
        </div>
        <div class="p-tools">
          <button class="p-tool pressable" type="button" aria-label={m.player_audio_track()}
                  onclick={() => tool('audio')}><Icon name="i-speaker" cls="icon icon-md" /></button>
          <button class="p-tool pressable" class:is-active={ccActive} type="button" aria-label={m.player_subtitles()}
                  onclick={() => tool('cc')}><Icon name="i-cc" cls="icon icon-md" /></button>
          <button class="p-tool pressable" type="button" aria-label={m.player_settings()}
                  onclick={() => tool('settings')}><Icon name="i-system" cls="icon icon-md" /></button>
        </div>
      </div>
      <div class="player-chrome player-bottom">
        <div class="p-transport">
          <button class="transport-btn pressable" type="button"
                  aria-label={m.player_previous_episode()} disabled={!adjacentEpisode(pb, -1)}
                  onclick={() => jump(-1)}><Icon name="i-prev" /></button>
          <button class="transport-btn transport-play pressable" type="button"
                  aria-label={pb.playing ? 'Pause' : 'Wiedergabe'}
                  onclick={toggle}><Icon name={pb.playing ? 'i-pause' : 'i-play'} cls="icon icon-play" /></button>
          <button class="transport-btn pressable" type="button"
                  aria-label={m.player_next_episode()} disabled={!adjacentEpisode(pb, 1)}
                  onclick={() => jump(1)}><Icon name="i-next" /></button>
        </div>
        <!-- Seek: ValueSlider-Mechanik, aber Plain-Thumb ohne Wert-Badge
             (Video-Seek zeigt Zeit rechts, nicht Prozent im Thumb) -->
        <div class="slider slider-seek" use:slider={{
          value: (pb.position / pb.duration) * 100,
          plain: true,
          onChange: (val, final) => {
            pb.position = (val / 100) * pb.duration;
            writeThrough(pb);
            if (!final) return;
            // Live: das <video> wirklich springen lassen (onseeked meldet dann);
            // Fake: den Seek als Progress loggen.
            if (usingLiveLibrary) {
              if (videoEl) videoEl.currentTime = pb.position;
            } else {
              sendJellyfin('Sessions/Playing/Progress', { seek: true, position: Math.round(pb.position) });
            }
          },
        }}>
          <div class="slider-track"><div class="slider-fill"></div></div>
          <div class="slider-thumb"></div>
        </div>
        <div class="p-time num">
          <span>{fmtClock(pb.position, withH)}</span>
          <span class="p-time-sep">/</span>
          <span>{fmtClock(pb.duration, withH)}</span>
        </div>
      </div>
    </div>
  {/if}
</div>
