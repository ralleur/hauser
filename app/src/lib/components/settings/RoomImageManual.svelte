<script lang="ts">
  /* Selbst zeichnen lassen — der Konfig-Screen dazu (R55, Gegenstück zur
     iOS-App). Je Fassung (Tag, Abend mit Licht, Nacht ohne Licht, trüb;
     draußen ohne Nacht-aus) steht, ob ein Bild da ist, nur abgeleitet oder
     fehlt, und darunter die drei Schritte: welches Eingabebild, welcher
     Wortlaut, das fertige Bild hochladen. Erst das Tagbild — die anderen
     entstehen daraus; ohne eigenes Abend- und Nachtbild bleibt das
     abgedunkelte Tagbild. Dazu die Fenster von Hand. */
  import '../../../styles/room-images.css';
  import { m } from '../../../paraglide/messages.js';
  import { EXTERIOR_HERO_ID } from '../../config/household-config.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import {
    loadRoomImageLibrary,
    setRoomImageRegions,
    type RoomImageLibraryAsset,
    type RoomImageRegion,
  } from '../../state/room-image-library-client.ts';
  import {
    resetRoomBackgroundVariant,
    uploadRoomBackgroundVariant,
    type RoomBackgroundVariant,
  } from '../../state/room-background-client.ts';
  import { reloadRoomRegions } from '../../state/room-regions.svelte.ts';
  import { buildRoomImagePrompt } from '../../room-images/room-image-prompt-policy-v1.ts';

  let { roomId, managing = false, refreshKey = false, onchangeway }: { roomId: string; managing?: boolean; refreshKey?: boolean; onchangeway?: () => void } = $props();

  const exterior = $derived(roomId === EXTERIOR_HERO_ID);
  const variants = $derived<RoomBackgroundVariant[]>(exterior ? ['light', 'dark', 'overcast'] : ['light', 'dark', 'dark-off', 'overcast']);
  const OWN_KEY: Record<RoomBackgroundVariant, string> = { light: 'light', dark: 'dark', 'dark-off': 'darkOff', overcast: 'overcast' };

  let assets = $state<RoomImageLibraryAsset[]>([]);
  let loadError = $state<string | null>(null);
  const asset = $derived.by(() => {
    const assetId = roomHeroConfig(roomId)?.assetId;
    return assetId ? assets.find((entry) => entry.assetId === assetId) ?? null : null;
  });
  const manualSet = $derived(asset?.assetId.startsWith('manual_') ?? false);
  const hasLight = $derived(asset !== null);
  const showWording = $derived(!managing || asset?.origin === 'manual' || (manualSet && !asset?.origin));
  const originLabel = $derived(asset?.origin === 'manual' ? m.rimg_way_chip_manual()
    : asset?.origin === 'upload' ? m.room_background_custom()
    : asset?.origin === 'apple' ? 'Apple'
    : asset?.origin === 'cloudflare' ? 'Cloudflare'
    : asset?.origin === 'chatgpt' ? 'ChatGPT'
    : asset?.origin === 'openai' ? 'OpenAI'
    : manualSet ? m.rimg_manage_origin_legacy() : m.rimg_wizard_entry());

  type Status = 'present' | 'derived' | 'missing' | 'wizard';
  function status(variant: RoomBackgroundVariant): Status {
    if (!asset) return 'missing';
    const key = OWN_KEY[variant];
    const url = (asset.variants as Record<string, string | undefined>)[key];
    if (!url) return 'missing';
    if (!manualSet) return 'wizard';
    if (variant === 'light' || asset.manual?.own.includes(key)) return 'present';
    return 'derived';
  }
  function variantUrl(variant: RoomBackgroundVariant): string | null {
    if (!asset) return null;
    return (asset.variants as Record<string, string | undefined>)[OWN_KEY[variant]] ?? null;
  }
  function name(variant: RoomBackgroundVariant): string {
    if (variant === 'light') return m.rimg_manual_v_light();
    if (variant === 'dark') return exterior ? m.rimg_manual_v_night() : m.rimg_manual_v_dark();
    if (variant === 'dark-off') return m.rimg_manual_v_dark_off();
    return m.rimg_manual_v_overcast();
  }
  function statusLine(variant: RoomBackgroundVariant): { text: string; tone: string } {
    const current = status(variant);
    if (current === 'present') return { text: m.rimg_manual_s_present(), tone: 'is-present' };
    if (current === 'wizard') return { text: m.rimg_manual_s_wizard(), tone: 'is-present' };
    if (current === 'derived') return { text: m.rimg_manual_s_derived(), tone: 'is-derived' };
    if (variant === 'light') return { text: m.rimg_manual_s_missing_light(), tone: 'is-missing' };
    if (variant === 'overcast') return { text: m.rimg_manual_s_missing_overcast(), tone: 'is-missing' };
    return { text: m.rimg_manual_s_missing(), tone: 'is-missing' };
  }

  /* Aufgeklappt ist zuerst, was fehlt oder nur abgeleitet ist. */
  let open = $state<RoomBackgroundVariant | null>(null);
  let touched = $state(false);
  const firstOpen = $derived(variants.find((variant) => !['present', 'wizard'].includes(status(variant))) ?? 'light');
  function isOpen(variant: RoomBackgroundVariant): boolean { return !touched && !managing ? variant === firstOpen : open === variant; }
  function toggle(variant: RoomBackgroundVariant) {
    const next = isOpen(variant) ? null : variant;
    touched = true;
    open = next;
  }

  let busy = $state<RoomBackgroundVariant | null>(null);
  let message = $state<{ variant: RoomBackgroundVariant; text: string; error: boolean } | null>(null);
  let copied = $state<RoomBackgroundVariant | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  let fileInput = $state<HTMLInputElement>();
  let uploadFor = $state<RoomBackgroundVariant>('light');

  $effect(() => { void roomHeroConfig(roomId)?.assetId; void refreshKey; void load(); });
  async function load() {
    try {
      assets = (await loadRoomImageLibrary()).assets;
      loadError = null;
    } catch (failure) {
      loadError = failure instanceof Error ? failure.message : m.rimg_err_library_response();
    }
  }

  /* Der Wortlaut je Fassung: der des Assistenten — Tag aus Komposition und
     Stil, die anderen lassen alles stehen und ändern nur das Licht. */
  function wording(variant: RoomBackgroundVariant): string {
    const spec = {
      stylePreset: exterior ? 'hauser-exterior-v1' as const : 'hauser-room-v1' as const,
      declutter: 'light' as const,
      tone: 'neutral' as const,
      preserveFeatures: ['windows' as const, 'doors' as const, 'built_ins' as const],
    };
    if (variant === 'light') return `${buildRoomImagePrompt('composition', spec)} ${buildRoomImagePrompt('style-light', spec)}`;
    return buildRoomImagePrompt(variant, spec);
  }

  async function copy(variant: RoomBackgroundVariant) {
    const text = wording(variant);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        const done = document.execCommand('copy');
        field.remove();
        if (!done) throw new Error('copy rejected');
      }
      copied = variant;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = null; }, 2_500);
    } catch {
      message = { variant, text: m.rimg_access_err_copy(), error: true };
    }
  }

  function pick(variant: RoomBackgroundVariant) {
    uploadFor = variant;
    fileInput?.click();
  }

  async function chosen(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const variant = uploadFor;
    if (!file || busy) return;
    busy = variant;
    message = null;
    try {
      await uploadRoomBackgroundVariant(roomId, variant, file, showWording ? 'manual' : 'upload');
      await load();
      await reloadRoomRegions();
      message = { variant, text: m.rimg_manual_saved(), error: false };
      /* Das Tagbild führt weiter zur nächsten Fassung; jede andere bleibt offen, damit „Gespeichert“ zu sehen ist. */
      touched = true;
      open = variant === 'light' ? (variants.find((entry) => entry !== 'light') ?? null) : variant;
    } catch (failure) {
      message = { variant, text: failure instanceof Error ? failure.message : m.room_background_failed(), error: true };
    } finally {
      busy = null;
    }
  }

  async function reset(variant: Exclude<RoomBackgroundVariant, 'light'>) {
    if (busy) return;
    busy = variant;
    message = null;
    try {
      await resetRoomBackgroundVariant(roomId, variant);
      await load();
      await reloadRoomRegions();
      touched = true;
      open = variant;
    } catch (failure) {
      message = { variant, text: failure instanceof Error ? failure.message : m.room_background_failed(), error: true };
    } finally {
      busy = null;
    }
  }

  // ── Fenster von Hand ──
  type Rect = { x: number; y: number; w: number; h: number };
  let marking = $state(false);
  let rects = $state<Rect[]>([]);
  let drawing = $state<Rect | null>(null);
  let dragStart: { x: number; y: number } | null = null;
  let windowsBusy = $state(false);
  let windowsMessage = $state<string | null>(null);
  const windowCount = $derived(asset?.regions?.regions.filter((region) => region.kind === 'window').length ?? 0);
  /* Kleiner als drei Promille der Fläche ist ein verrutschter Klick, kein Fenster. */
  const MIN_AREA = 0.003;

  function rectOf(region: RoomImageRegion): Rect {
    const xs = region.points.map((point) => point.x);
    const ys = region.points.map((point) => point.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  function startMarking() {
    rects = (asset?.regions?.regions ?? []).filter((region) => region.kind === 'window').map(rectOf);
    windowsMessage = null;
    marking = true;
  }
  function unit(event: PointerEvent): { x: number; y: number } {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }
  function normalized(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragStart = unit(event);
    drawing = null;
  }
  function pointerMove(event: PointerEvent) {
    if (!dragStart) return;
    drawing = normalized(dragStart, unit(event));
  }
  function pointerUp(event: PointerEvent) {
    if (!dragStart) return;
    const rect = normalized(dragStart, unit(event));
    dragStart = null;
    drawing = null;
    if (rect.w * rect.h >= MIN_AREA) rects = [...rects, rect];
  }
  function removeRect(index: number) {
    rects = rects.filter((_, position) => position !== index);
  }
  function region(rect: Rect): RoomImageRegion {
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      kind: 'window',
      points: [
        { x: round(rect.x), y: round(rect.y) }, { x: round(rect.x + rect.w), y: round(rect.y) },
        { x: round(rect.x + rect.w), y: round(rect.y + rect.h) }, { x: round(rect.x), y: round(rect.y + rect.h) },
      ],
    };
  }
  async function saveWindows() {
    if (!asset || windowsBusy) return;
    windowsBusy = true;
    windowsMessage = null;
    try {
      const others = (asset.regions?.regions ?? []).filter((entry) => entry.kind !== 'window');
      await setRoomImageRegions(asset.assetId, [...others, ...rects.map(region)]);
      await load();
      await reloadRoomRegions();
      marking = false;
      windowsMessage = m.rimg_manual_windows_saved();
    } catch (failure) {
      windowsMessage = failure instanceof Error ? failure.message : m.rimg_regions_failed();
    } finally {
      windowsBusy = false;
    }
  }
</script>

<input bind:this={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif" onchange={chosen} />

<section class="room-image-manual" class:is-managing={managing} aria-label={managing ? m.rimg_manage_current() : m.rimg_manual_title()}>
  {#if managing}
    <div class="room-image-current-head">
      {#if asset}<img class="room-image-current-thumb" src={asset.variants.light} alt={m.room_background_preview()} />{/if}
      <div class="room-image-manual-text">
        <h3>{m.rimg_manage_current()}</h3>
        <small>{m.rimg_manage_origin()}</small>
        <strong>{asset ? originLabel : m.rimg_lib_loading()}</strong>
      </div>
      <button class="secondary-btn pressable" type="button" onclick={onchangeway}>{m.rimg_way_change()}</button>
    </div>
  {:else}
  <div class="room-image-manual-head">
    <h3 id="room-image-manual-title">{m.rimg_manual_title()}</h3>
    <p>{m.rimg_manual_intro()}</p>
    <div class="room-image-way-actions">
      <a class="secondary-btn pressable" href="https://gemini.google.com/app" target="_blank" rel="noreferrer">{m.rimg_manual_gemini()}</a>
      <a class="secondary-btn pressable" href="https://chatgpt.com/" target="_blank" rel="noreferrer">{m.rimg_manual_chatgpt()}</a>
      <a class="secondary-btn pressable" href="https://www.bing.com/images/create" target="_blank" rel="noreferrer">{m.rimg_manual_bing()}</a>
    </div>
  </div>
  {/if}
  {#if loadError}<p class="room-image-alert is-error" role="alert">{loadError}</p>{/if}

  {#if marking && asset}
    <section class="room-image-windows-editor">
      <p>{m.rimg_manual_windows_hint()}</p>
      <div class="room-image-windows-stage" role="application" aria-label={m.rimg_manual_windows_mark()}
           style:background-image={`url("${asset.variants.light}")`}
           onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={pointerUp} onpointercancel={() => { dragStart = null; drawing = null; }}>
        {#each rects as rect, index (index)}
          <button class="room-image-window-rect pressable" type="button" aria-label={m.rimg_manual_remove()}
                  style:left={`${rect.x * 100}%`} style:top={`${rect.y * 100}%`} style:width={`${rect.w * 100}%`} style:height={`${rect.h * 100}%`}
                  onpointerdown={(event) => event.stopPropagation()} onclick={() => removeRect(index)}></button>
        {/each}
        {#if drawing}
          <span class="room-image-window-rect is-drawing" aria-hidden="true"
                style:left={`${drawing.x * 100}%`} style:top={`${drawing.y * 100}%`} style:width={`${drawing.w * 100}%`} style:height={`${drawing.h * 100}%`}></span>
        {/if}
      </div>
      <p class="room-image-manual-status is-present">{m.rimg_manual_windows_count({ count: rects.length })}</p>
      <footer class="room-image-wizard-actions">
        <button class="secondary-btn pressable" type="button" disabled={windowsBusy} onclick={() => { marking = false; }}>{m.rimg_way_back()}</button>
        <button class="secondary-btn pressable" type="button" disabled={windowsBusy || rects.length === 0} onclick={() => { rects = []; }}>{m.rimg_manual_windows_clear()}</button>
        <button class="primary-btn pressable" type="button" disabled={windowsBusy} onclick={saveWindows}>{m.rimg_manual_windows_save()}</button>
      </footer>
      {#if windowsMessage}<p class="room-image-alert is-error" role="alert">{windowsMessage}</p>{/if}
    </section>
  {:else}
    {#if !exterior}
      <article class="room-image-manual-card room-image-manual-windows">
        <div class="room-image-manual-row">
          <span class="room-image-manual-thumb is-icon" aria-hidden="true">▭</span>
          <span class="room-image-manual-text">
            <strong>{m.rimg_manual_windows()}</strong>
            <small class={`room-image-manual-status ${windowCount ? 'is-present' : 'is-missing'}`}>
              {windowCount ? m.rimg_manual_windows_count({ count: windowCount }) : m.rimg_manual_windows_none()}
            </small>
          </span>
          <button class="secondary-btn pressable" type="button" disabled={!hasLight} onclick={startMarking}>
            {windowCount ? m.rimg_manual_windows_change() : m.rimg_manual_windows_mark()}
          </button>
        </div>
        {#if windowsMessage}<p class="room-image-alert" role="status">{windowsMessage}</p>{/if}
      </article>
    {/if}
    {#if managing}<h3 class="room-image-versions-title">{m.rimg_manage_versions()}</h3>{/if}
    {#each variants as variant (variant)}
      {@const line = statusLine(variant)}
      {@const url = variantUrl(variant)}
      <article class="room-image-manual-card" class:is-open={isOpen(variant)}>
        <button class="room-image-manual-row pressable" type="button" aria-expanded={isOpen(variant)} onclick={() => toggle(variant)}>
          <span class="room-image-manual-thumb" style:background-image={url && status(variant) !== 'missing' ? `url("${url}")` : undefined}></span>
          <span class="room-image-manual-text">
            <strong>{name(variant)}</strong>
            <small class={`room-image-manual-status ${line.tone}`}>{line.text}</small>
          </span>
          <span class="room-image-manual-chevron" aria-hidden="true">›</span>
        </button>
        {#if isOpen(variant)}
          <div class="room-image-manual-steps">
            {#if showWording}
            <div class="room-image-manual-step">
              <span class="room-image-step" aria-hidden="true">1</span>
              <div>
                <strong>{m.rimg_manual_step_input()}</strong>
                {#if variant === 'light'}
                  <p>{exterior ? m.rimg_manual_input_light_exterior() : m.rimg_manual_input_light()}</p>
                {:else}
                  <p>{m.rimg_manual_input_other()}</p>
                  {#if hasLight && asset}
                    <a class="secondary-btn pressable" href={asset.variants.light} download={`hauser-${roomId}-light.avif`}>{m.rimg_manual_download_light()}</a>
                  {:else}
                    <small class="room-image-manual-status is-derived">{m.rimg_manual_light_first()}</small>
                  {/if}
                {/if}
              </div>
            </div>
            <div class="room-image-manual-step">
              <span class="room-image-step" aria-hidden="true">2</span>
              <div>
                <strong>{m.rimg_manual_step_wording()}</strong>
                <p>{variant === 'light' ? m.rimg_manual_wording_light() : m.rimg_manual_wording_other()}</p>
                <button class="primary-btn pressable" type="button" onclick={() => copy(variant)}>{copied === variant ? m.rimg_manual_copied() : m.rimg_manual_copy()}</button>
              </div>
            </div>
            {/if}
            {#if manualSet || !managing}
            <div class="room-image-manual-step">
              {#if showWording}<span class="room-image-step" aria-hidden="true">3</span>{/if}
              <div>
                <strong>{m.rimg_manual_step_result()}</strong>
                <p>{m.rimg_manual_result_hint()}</p>
                <div class="room-image-way-actions">
                  <button class="primary-btn pressable" type="button" disabled={busy !== null || (variant !== 'light' && !manualSet)} onclick={() => pick(variant)}>
                    {busy === variant ? m.room_background_saving() : status(variant) === 'present' ? m.rimg_manual_replace() : m.rimg_manual_upload()}
                  </button>
                  {#if variant !== 'light' && status(variant) === 'present'}
                    <button class="secondary-btn pressable" type="button" disabled={busy !== null} onclick={() => reset(variant)}>
                      {variant === 'overcast' ? m.rimg_manual_remove() : m.rimg_manual_derive_again()}
                    </button>
                  {/if}
                </div>
                {#if variant !== 'light' && !manualSet && hasLight}
                  <small class="room-image-manual-status is-derived">{m.rimg_manual_wizard_note()}</small>
                {/if}
                {#if message && message.variant === variant}
                  <p class="room-image-alert" class:is-error={message.error} role="status">{message.text}</p>
                {/if}
              </div>
            </div>
            {:else}
              {#if url}<img class="room-image-version-preview" src={url} alt={name(variant)} />{/if}
              <p>{m.rimg_manage_assistant_hint()}</p>
              <button class="secondary-btn pressable" type="button" onclick={onchangeway}>{m.rimg_way_change()}</button>
            {/if}
          </div>
        {/if}
      </article>
    {/each}


  {/if}
</section>
