<script lang="ts">
  import '../../styles/songs.css';
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import {
    HOME_POD_TARGETS, SONG_ERAS, SONG_STYLES, SONG_VOICES, audioProxyUrl,
    deleteCentralSong, downloadSong, fetchCentralSongs,
    homePodAudioUrl, homePodEntityIds, localSongUrl,
    loadGeneratedSongs, pruneLocalSongs, registerCentralSong, removeLocalSong, renameCentralSong, saveGeneratedSongs, songTitle,
    type GeneratedSong, type HomePodTarget, type SongDraft,
  } from '../state/songs.ts';

  let {
    phone = false,
    titleAnchor = $bindable(),
  }: { phone?: boolean; titleAnchor?: HTMLHeadingElement } = $props();

  const draft = $state<SongDraft>({
    idea: '', style: 'Pop', era: 'Heute', voice: 'Weiblich', experimental: 35,
  });
  let songs = $state<GeneratedSong[]>([]);
  let backendOnline = $state<boolean | null>(null);
  let generating = $state(false);
  let listening = $state(false);
  let status = $state<string>(m.songs_ready());
  let error = $state('');
  let castStatus = $state('');
  let localUrls = $state<Record<string, string>>({});
  let downloading = $state<string | null>(null);
  let exporting = $state<string | null>(null);
  let selectedSong = $state<GeneratedSong | null>(null);
  let editingTitle = $state(false);
  let titleDraft = $state('');
  let renaming = $state(false);
  let deleteCandidate = $state<GeneratedSong | null>(null);
  let recognition: { start: () => void; stop: () => void } | null = null;

  onMount(() => {
    void initializeLibrary();
    void checkBackend();
    const SpeechRecognition = (window as typeof window & {
      webkitSpeechRecognition?: new () => {
        lang: string; interimResults: boolean; continuous: boolean;
        onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void;
        onerror: () => void; onend: () => void; start: () => void; stop: () => void;
      };
    }).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const instance = new SpeechRecognition();
      instance.lang = 'de-DE';
      instance.interimResults = false;
      instance.continuous = false;
      instance.onresult = (event) => {
        const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
        if (transcript) draft.idea = transcript;
      };
      instance.onerror = () => { error = m.songs_speech_failed(); };
      instance.onend = () => { listening = false; };
      recognition = instance;
    }
  });

  async function initializeLibrary() {
    const legacy = loadGeneratedSongs();
    for (const song of legacy) {
      try { await registerCentralSong(song); } catch { /* Bereits zentral oder alte Quelldatei nicht mehr vorhanden. */ }
    }
    if (legacy.length) saveGeneratedSongs([]);
    try {
      songs = await fetchCentralSongs();
      await pruneLocalSongs(songs);
      const entries = await Promise.all(songs.map(async (song) => [song.id, await localSongUrl(song)] as const));
      localUrls = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.songs_jukebox_load_failed();
    }
  }

  async function checkBackend() {
    try {
      const response = await fetch('/api/songs/health', { cache: 'no-store' });
      backendOnline = response.ok;
    } catch { backendOnline = false; }
  }

  function toggleListening() {
    error = '';
    if (!recognition) {
      error = m.songs_no_speech_support();
      return;
    }
    if (listening) {
      recognition.stop();
      listening = false;
      return;
    }
    listening = true;
    recognition.start();
  }

  async function generate() {
    const idea = draft.idea.trim();
    if (!idea || generating) return;
    generating = true;
    error = '';
    status = m.songs_writing_lyrics();
    try {
      const response = await fetch('/api/songs/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, idea }),
      });
      const queued = await response.json();
      if (!response.ok || !queued?.data?.task_id) throw new Error(queued?.error || m.songs_start_failed());
      const taskId = String(queued.data.task_id);
      status = queued.data.queue_position > 1
        ? m.songs_queue_position({ position: queued.data.queue_position })
        : m.songs_composing();
      await pollTask(taskId, { ...draft, idea });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.songs_generation_failed();
      status = m.songs_not_generated();
      generating = false;
      await checkBackend();
    }
  }

  async function pollTask(taskId: string, snapshot: SongDraft) {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const response = await fetch('/api/songs/status', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || m.songs_status_failed());
      const task = payload?.data?.[0];
      if (!task || task.status === 0) continue;
      if (task.status === 2) throw new Error(m.songs_engine_failed());
      const results = JSON.parse(task.result || '[]');
      const output = results.find((item: { file?: string; status?: number }) => item.status === 1 && item.file);
      const audioUrl = output?.file ? audioProxyUrl(output.file) : null;
      if (!audioUrl) throw new Error(m.songs_no_audio());
      const sourceSong: GeneratedSong = {
        id: taskId,
        title: songTitle(snapshot.idea),
        idea: snapshot.idea,
        style: snapshot.style,
        era: snapshot.era,
        voice: snapshot.voice,
        duration: Number(output?.metas?.duration) || 0,
        audioUrl,
        createdAt: new Date().toISOString(),
      };
      const song = await registerCentralSong(sourceSong);
      const objectUrl = await downloadSong(song);
      localUrls = { ...localUrls, [song.id]: objectUrl };
      songs = [song, ...songs.filter((entry) => entry.id !== taskId)];
      status = m.songs_done();
      generating = false;
      return;
    }
    throw new Error(m.songs_timeout());
  }

  async function loadOnDevice(song: GeneratedSong) {
    if (localUrls[song.id] || downloading) return;
    downloading = song.id;
    error = '';
    try {
      const objectUrl = await downloadSong(song);
      localUrls = { ...localUrls, [song.id]: objectUrl };
      castStatus = `${song.title} ist jetzt auf diesem Gerät verfügbar.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.songs_load_failed();
    } finally { downloading = null; }
  }

  function openSong(song: GeneratedSong) {
    selectedSong = song;
    titleDraft = song.title;
    editingTitle = false;
  }

  function startRenaming() {
    if (!selectedSong) return;
    titleDraft = selectedSong.title;
    editingTitle = true;
  }

  async function saveTitle() {
    if (!selectedSong || renaming) return;
    const title = titleDraft.trim().replace(/\s+/g, ' ');
    if (!title) {
      error = m.songs_title_empty();
      return;
    }
    if (title === selectedSong.title) {
      editingTitle = false;
      return;
    }
    renaming = true;
    error = '';
    try {
      const updated = await renameCentralSong(selectedSong.id, title);
      songs = songs.map((song) => song.id === updated.id ? updated : song);
      selectedSong = updated;
      titleDraft = updated.title;
      editingTitle = false;
      castStatus = `Song wurde in „${updated.title}“ umbenannt.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.songs_rename_failed();
    } finally { renaming = false; }
  }

  function onTitleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveTitle();
    } else if (event.key === 'Escape') {
      editingTitle = false;
      titleDraft = selectedSong?.title || '';
    }
  }

  async function downloadToDevice(song: GeneratedSong) {
    if (exporting) return;
    exporting = song.id;
    error = '';
    try {
      const response = await fetch(song.audioUrl);
      if (!response.ok) throw new Error(m.songs_mp3_failed());
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${song.title.replace(/[^a-z0-9äöüß _-]/gi, '').trim() || 'Song'}.mp3`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      castStatus = `${song.title} wurde als MP3 heruntergeladen.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.songs_mp3_failed();
    } finally { exporting = null; }
  }

  async function deleteFromDevice(song: GeneratedSong) {
    try {
      await removeLocalSong(song);
      const currentUrl = localUrls[song.id];
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      const next = { ...localUrls };
      delete next[song.id];
      localUrls = next;
      deleteCandidate = null;
      castStatus = `${song.title} wurde von diesem Gerät entfernt.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.songs_local_delete_failed();
    }
  }

  async function deleteEverywhere(song: GeneratedSong) {
    try {
      await deleteCentralSong(song.id);
      await removeLocalSong(song);
      const currentUrl = localUrls[song.id];
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      songs = songs.filter((entry) => entry.id !== song.id);
      const next = { ...localUrls };
      delete next[song.id];
      localUrls = next;
      deleteCandidate = null;
      selectedSong = null;
      castStatus = `${song.title} wurde zentral gelöscht.`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.songs_delete_failed();
    }
  }

  function playOnHomePod(song: GeneratedSong, target: HomePodTarget) {
    const mediaContentId = homePodAudioUrl(song.audioUrl);
    if (!mediaContentId) {
      castStatus = m.songs_handoff_failed();
      return;
    }
    if (runtime.connectionStatus !== 'connected') {
      castStatus = m.songs_ha_disconnected();
      return;
    }
    for (const entityId of homePodEntityIds(target)) {
      runtime.send({
        entityId,
        domain: 'media_player',
        service: 'play_media',
        data: {
          media: {
            media_content_id: mediaContentId,
            media_content_type: 'music',
            title: song.title,
          },
        },
        queuedAt: Date.now(),
      });
    }
    castStatus = target === 'both'
      ? `${song.title} wird an beide HomePods gesendet.`
      : `${song.title} wird an ${HOME_POD_TARGETS[target].label} gesendet.`;
  }

  function stopHomePods() {
    if (runtime.connectionStatus !== 'connected') {
      castStatus = m.songs_ha_disconnected();
      return;
    }
    for (const entityId of homePodEntityIds('both')) {
      runtime.send({ entityId, domain: 'media_player', service: 'media_stop', data: {}, queuedAt: Date.now() });
    }
    castStatus = 'Wiedergabe auf beiden HomePods wird gestoppt.';
  }
</script>

<main class:songs-phone={phone} class="songs-screen" aria-labelledby="songs-title">
  <header class="songs-header">
    <div>
      <p class="songs-kicker">L · A · Y · S · I · E</p>
      <h1 bind:this={titleAnchor} id="songs-title" tabindex="-1">{m.songs_workshop()}</h1>
      <p>{m.songs_intro()}</p>
    </div>
    <span class:online={backendOnline === true} class:offline={backendOnline === false} class="songs-backend-status">
      <span aria-hidden="true"></span>{backendOnline === null ? m.songs_engine_checking() : backendOnline ? m.songs_engine_ready() : m.songs_engine_offline()}
    </span>
  </header>

  <div class="songs-layout">
    <section class="songs-create" aria-labelledby="songs-create-title">
      <h2 id="songs-create-title">{m.songs_prompt()}</h2>
      <div class="songs-idea-row">
        <textarea bind:value={draft.idea} maxlength="800" rows="4" placeholder={m.songs_prompt_example()}></textarea>
        <button class:listening class="songs-mic pressable" type="button" aria-label={listening ? m.songs_stop_recording() : m.songs_record_idea()} aria-pressed={listening} onclick={toggleListening}>
          <Icon name={listening ? 'i-stop' : 'i-microphone'} cls="icon icon-xl" />
          <span>{listening ? m.songs_stop() : m.songs_speak()}</span>
        </button>
      </div>

      <div class="songs-options">
        <label>{m.songs_style()}<select bind:value={draft.style}>{#each SONG_STYLES as option}<option value={option}>{option}</option>{/each}</select></label>
        <label>{m.songs_era()}<select bind:value={draft.era}>{#each SONG_ERAS as option}<option value={option}>{option}</option>{/each}</select></label>
        <label>{m.songs_voice()}<select bind:value={draft.voice}>{#each SONG_VOICES as option}<option value={option}>{option}</option>{/each}</select></label>
      </div>

      <label class="songs-experiment">
        <span><b>{m.songs_experimental()}</b><output>{draft.experimental}%</output></span>
        <input bind:value={draft.experimental} type="range" min="0" max="100" step="5" />
      </label>

      <button class="songs-generate pressable" type="button" disabled={!draft.idea.trim() || generating || backendOnline === false} onclick={generate}>
        <Icon name={generating ? 'i-loading' : 'i-music-note-plus'} cls="icon icon-md" />
        {generating ? m.songs_generating() : m.songs_generate()}
      </button>
      <p class="songs-progress" role="status" aria-live="polite">{status}</p>
      {#if error}<p class="songs-error" role="alert">{error}</p>{/if}
    </section>

    <section class="songs-jukebox" aria-labelledby="songs-jukebox-title">
      <div class="songs-section-title"><div><p class="songs-kicker">{m.songs_synced()}</p><h2 id="songs-jukebox-title">{m.songs_jukebox()}</h2></div><span>{songs.length} Songs</span></div>
      {#if songs.length === 0}
        <div class="songs-empty"><Icon name="i-playlist-music" cls="icon icon-xl" /><p>{m.songs_empty()}</p></div>
      {:else}
        <ol class="songs-list">
          {#each songs as song (song.id)}
            <li>
              <button class="songs-row pressable" type="button" onclick={() => openSong(song)}>
                <span class="songs-row-title">{song.title}</span>
                <span class="songs-row-meta">{song.style} · {Math.round(song.duration)} s</span>
                <span class:local={Boolean(localUrls[song.id])} class="songs-row-local" title={localUrls[song.id] ? m.songs_on_device() : m.songs_central_only()}>
                  <Icon name={localUrls[song.id] ? 'i-check-circle-outline' : 'i-cloud-outline'} cls="icon icon-sm" />
                </span>
                <Icon name="i-chevron-right" cls="icon icon-sm songs-row-chevron" />
              </button>
            </li>
          {/each}
        </ol>
        <p class="songs-cast-status" role="status" aria-live="polite">{castStatus}</p>
      {/if}
    </section>
  </div>
</main>

{#if selectedSong}
  <div class="songs-detail-layer">
    <button class="songs-detail-scrim" type="button" aria-label={m.songs_close_details()} onclick={() => { selectedSong = null; }}></button>
    <div class="songs-detail-dialog" role="dialog" aria-modal="true" aria-label={`Songdetails für ${selectedSong.title}`}>
      <header>
        <div class="songs-detail-heading">
          <p class="songs-kicker">{selectedSong.style} · {selectedSong.era} · {selectedSong.voice}</p>
          {#if editingTitle}
            <div class="songs-title-editor">
              <input bind:value={titleDraft} maxlength="120" aria-label={m.songs_title()} onkeydown={onTitleKeydown} />
              <button class="pressable save" type="button" disabled={renaming || !titleDraft.trim()} onclick={saveTitle}><Icon name={renaming ? 'i-loading' : 'i-check'} cls="icon icon-sm" />{m.songs_save()}</button>
              <button class="pressable" type="button" disabled={renaming} onclick={() => { editingTitle = false; titleDraft = selectedSong?.title || ''; }}>{m.songs_cancel()}</button>
            </div>
          {:else}
            <button class="songs-title-button pressable" type="button" aria-label={m.songs_rename()} onclick={startRenaming}>
              <span>{selectedSong.title}</span><Icon name="i-pencil-outline" cls="icon icon-sm" />
            </button>
          {/if}
          <span class:local={Boolean(localUrls[selectedSong.id])} class="songs-detail-local">
            <Icon name={localUrls[selectedSong.id] ? 'i-check-circle-outline' : 'i-cloud-outline'} cls="icon icon-sm" />
            {localUrls[selectedSong.id] ? m.songs_stored_local() : m.songs_stored_central()}
          </span>
        </div>
        <button class="songs-detail-close pressable" type="button" aria-label={m.songs_close_details()} onclick={() => { selectedSong = null; }}><Icon name="i-close" cls="icon icon-md" /></button>
      </header>

      <audio controls preload="metadata" src={localUrls[selectedSong.id] || selectedSong.audioUrl}><track kind="captions" /></audio>

      <div class="songs-detail-storage">
        {#if localUrls[selectedSong.id]}
          <button class="pressable" type="button" onclick={() => deleteFromDevice(selectedSong!)}><Icon name="i-cellphone-remove" cls="icon icon-sm" />{m.songs_remove_offline()}</button>
        {:else}
          <button class="pressable" type="button" disabled={downloading !== null} onclick={() => loadOnDevice(selectedSong!)}>
            <Icon name={downloading === selectedSong.id ? 'i-loading' : 'i-cellphone-arrow-down'} cls="icon icon-sm" />
            {downloading === selectedSong.id ? m.songs_saving() : m.songs_save_offline()}
          </button>
        {/if}
        <button class="pressable" type="button" disabled={exporting !== null} onclick={() => downloadToDevice(selectedSong!)}>
          <Icon name={exporting === selectedSong.id ? 'i-loading' : 'i-download'} cls="icon icon-sm" />
          {exporting === selectedSong.id ? m.songs_mp3_loading() : m.songs_mp3_download()}
        </button>
      </div>

      <div class="songs-detail-section">
        <h3>{m.songs_play_on_speakers()}</h3>
        <div class="songs-cast-actions" aria-label={`${selectedSong.title} auf HomePods wiedergeben`}>
          <button class="pressable" type="button" onclick={() => playOnHomePod(selectedSong!, 'wohnzimmer')}><Icon name="i-speaker" cls="icon icon-sm" />Wohnzimmer</button>
          <button class="pressable" type="button" onclick={() => playOnHomePod(selectedSong!, 'kueche')}><Icon name="i-speaker" cls="icon icon-sm" />Küche</button>
          <button class="pressable" type="button" onclick={() => playOnHomePod(selectedSong!, 'both')}><Icon name="i-speaker-multiple" cls="icon icon-sm" />{m.songs_both()}</button>
          <button class="pressable songs-cast-stop" type="button" onclick={stopHomePods}><Icon name="i-stop" cls="icon icon-sm" />{m.songs_stop_playback()}</button>
        </div>
      </div>

      <button class="songs-detail-delete pressable" type="button" onclick={() => { deleteCandidate = selectedSong; }}><Icon name="i-delete-outline" cls="icon icon-sm" />{m.songs_delete()}</button>
      <p class="songs-cast-status" role="status" aria-live="polite">{castStatus}</p>
    </div>
  </div>
{/if}

{#if deleteCandidate}
  <div class="songs-delete-layer">
    <button class="songs-delete-scrim" type="button" aria-label={m.songs_delete_cancel()} onclick={() => { deleteCandidate = null; }}></button>
    <div class="songs-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="songs-delete-title">
      <Icon name="i-delete-outline" cls="icon icon-xl" />
      <h2 id="songs-delete-title">„{deleteCandidate.title}“ löschen?</h2>
      <p>{m.songs_delete_hint()}</p>
      <div class="songs-delete-actions">
        <button class="pressable" type="button" disabled={!localUrls[deleteCandidate.id]} onclick={() => deleteFromDevice(deleteCandidate!)}>{m.songs_delete_local()}</button>
        <button class="pressable danger" type="button" onclick={() => deleteEverywhere(deleteCandidate!)}>{m.songs_delete_central()}</button>
        <button class="pressable" type="button" onclick={() => { deleteCandidate = null; }}>{m.songs_cancel()}</button>
      </div>
    </div>
  </div>
{/if}
