<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  import { onMount } from 'svelte';
  import { runtime, configuredHaUrl, configuredHaTransport } from '../adapter/runtime.svelte.ts';
  import type { CameraValue } from '../adapter/types.ts';
  import { doubletap } from '../actions/doubletap.ts';
  import { longpress } from '../actions/longpress.ts';
  import { slider } from '../actions/slider.ts';
  import type { CameraPopoutMode } from '../state/camera-popouts.svelte.ts';

  let {
    entityId,
    label,
    titlebarVisible = true,
    popoutMode = null,
    disableFullscreen = false,
    onpopout = null,
    ondock = null,
    onmodechange = null,
    ontoggletitlebar = null,
    size = 25,
    onsizechange = null,
  }: {
    entityId: string;
    label: string;
    titlebarVisible?: boolean;
    popoutMode?: CameraPopoutMode | null;
    disableFullscreen?: boolean;
    onpopout?: (() => void) | null;
    ondock?: (() => void) | null;
    onmodechange?: ((mode: CameraPopoutMode) => void) | null;
    ontoggletitlebar?: (() => void) | null;
    size?: number;
    onsizechange?: ((size: number) => void) | null;
  } = $props();
  let failed = $state(false);
  let source = $state<string | null>(null);
  let frame = $state<HTMLDivElement>();
  let root = $state<HTMLElement>();
  let fullscreen = $state(false);
  let menuOpen = $state(false);
  let resizeOpen = $state(false);
  const menuAvailable = $derived(onpopout !== null && ontoggletitlebar !== null);

  /* Fortlaufend nachgeladene Standbilder statt MJPEG: Für Kameras, die HA
     per ffmpeg aus einem Stream bedient, beendet `camera_proxy_stream` die
     Antwort ohne ein einziges Bild, das Standbild kommt dagegen zuverlässig.
     Das nächste Bild wird verdeckt geladen und erst fertig eingetauscht. */
  const CAMERA_REFRESH_MS = 1000;
  const CAMERA_RETRY_MS = 5000;

  const camera = $derived(runtime.merged(entityId) as CameraValue | undefined);
  const snapshotUrl = $derived.by(() => {
    const picture = camera?.entityPicture;
    if (!camera?.available || !picture) return null;
    /* Im App-Modus reicht der eigene Server das Bild durch — der Browser
       kennt dort weder eine HA-Adresse noch einen Token. */
    const base = configuredHaTransport() === 'gateway' ? location.href : `${configuredHaUrl()}/`;
    return new URL(picture, base).toString();
  });
  const live = $derived(snapshotUrl !== null && !failed);

  $effect(() => {
    const url = snapshotUrl;
    source = null;
    failed = false;
    if (!url) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loader: HTMLImageElement | null = null;
    const loadFrame = () => {
      const next = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
      loader = new Image();
      loader.onload = () => {
        if (stopped) return;
        source = next;
        failed = false;
        timer = setTimeout(loadFrame, CAMERA_REFRESH_MS);
      };
      loader.onerror = () => {
        if (stopped) return;
        failed = true;
        timer = setTimeout(loadFrame, CAMERA_RETRY_MS);
      };
      loader.src = next;
    };
    loadFrame();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (loader) { loader.onload = null; loader.onerror = null; loader.src = ''; }
    };
  });

  onMount(() => {
    const syncFullscreen = () => { fullscreen = document.fullscreenElement === frame; };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  });

  function openFullscreen(): void {
    if (disableFullscreen || !frame || fullscreen || !live) return;
    void frame.requestFullscreen().catch(() => {});
  }

  function closeFullscreen(): void {
    if (document.fullscreenElement === frame) void document.exitFullscreen();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (fullscreen) closeFullscreen();
    else openFullscreen();
  }

  function openMenu(): void {
    if (menuAvailable) {
      menuOpen = true;
      resizeOpen = false;
    }
  }

  function togglePopout(): void {
    menuOpen = false;
    if (popoutMode) ondock?.();
    else onpopout?.();
  }

  function togglePopoutMode(): void {
    onmodechange?.(popoutMode === 'always' ? 'room' : 'always');
  }

  function toggleTitlebar(): void {
    menuOpen = false;
    ontoggletitlebar?.();
  }

  function closeOutside(event: PointerEvent): void {
    if (menuOpen && root && !root.contains(event.target as Node)) {
      menuOpen = false;
      resizeOpen = false;
    }
  }

  function openContextMenu(event: MouseEvent): void {
    if (!menuAvailable) return;
    event.preventDefault();
    openMenu();
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    openMenu();
  }
</script>

<svelte:document onpointerdown={closeOutside} />

<figure
  class="camera-feed"
  class:camera-feed-titlebar-hidden={!titlebarVisible}
  bind:this={root}
>
  {#if titlebarVisible}
    <figcaption class="camera-feed-caption">
      <span>{label}</span>
      <span class="camera-feed-status" class:is-live={live}>
        {live ? m.camera_status_live() : m.camera_status_unavailable()}
      </span>
    </figcaption>
  {/if}
  <div
    class="camera-feed-frame"
    class:is-fullscreen={fullscreen}
    bind:this={frame}
    role="button"
    tabindex={live ? 0 : -1}
    aria-haspopup={menuAvailable ? 'menu' : undefined}
    aria-expanded={menuAvailable ? menuOpen : undefined}
    aria-disabled={!live}
    aria-label={live ? (fullscreen
      ? m.camera_fullscreen_close({ label })
      : m.camera_fullscreen_open({ label })) : undefined}
    aria-pressed={live ? fullscreen : undefined}
    onclick={openFullscreen}
    onkeydown={onKeydown}
    oncontextmenu={openContextMenu}
    use:longpress={{ enabled: menuAvailable, onLongPress: openMenu }}
    use:doubletap={{ enabled: fullscreen, onDoubleTap: closeFullscreen }}
    onkeydowncapture={onMenuKeydown}
  >
    {#if source && !failed}
      <img src={source} alt={m.camera_live_alt({ label })} />
    {:else if !live}
      <p>{m.camera_unavailable()}</p>
    {/if}
  </div>

  {#if menuOpen}
    <div class="camera-context-menu" role="menu" aria-label={m.camera_context_menu()}>
      <button class="camera-context-option pressable" type="button" role="menuitem"
              onclick={togglePopout}>
        {popoutMode ? m.camera_dock() : m.camera_popout()}
      </button>
      {#if popoutMode}
        <button class="camera-context-option pressable" type="button" role="menuitem"
                onclick={togglePopoutMode}>
          {popoutMode === 'always' ? m.camera_show_with_room() : m.camera_show_always()}
        </button>
      {/if}
      <button class="camera-context-option pressable" type="button" role="menuitem"
              onclick={toggleTitlebar}>
        {titlebarVisible ? m.camera_hide_titlebar() : m.camera_show_titlebar()}
      </button>
      {#if popoutMode}
        <button class="camera-context-option pressable" type="button" role="menuitem"
                aria-expanded={resizeOpen} onclick={() => { resizeOpen = !resizeOpen; }}>
          {m.camera_resize()}
        </button>
        {#if resizeOpen}
          <div class="camera-size-control" role="none">
            <div class="slider" role="slider" tabindex="0" aria-label={m.camera_resize()}
                 aria-valuemin="0" aria-valuemax="100" aria-valuenow={size}
                 use:slider={{ value: size, onChange: (value) => onsizechange?.(value) }}>
              <div class="slider-track"><div class="slider-fill"></div></div>
              <div class="slider-thumb"></div>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</figure>
