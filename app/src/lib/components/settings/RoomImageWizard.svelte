<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import '../../../styles/room-images.css';
  import { m } from '../../../paraglide/messages.js';
  import RoomImageAccess from './RoomImageAccess.svelte';
  import Icon from '../Icon.svelte';
  import { createRoomImageClient, type RoomImageFocus, type RoomImageMimeType, type RoomImageUpload } from '../../state/room-image-client.ts';
  import { createRoomImageWizardController, type RoomImageWizardState } from '../../state/room-image-wizard-state.ts';
  import { getRoomImageAccess, type RoomImageAccessStatus } from '../../state/room-image-access.ts';
  import { appState } from '../../state/app.svelte.ts';
  import { IS_DEMO } from '../../demo/demo-mode.ts';
  import { assignRoomImage, loadRoomImageLibrary } from '../../state/room-image-library-client.ts';
  import {
    initialRoomImageFocus,
    projectRoomImageCrop,
    roomImagePhaseLabel,
    viewForRoomImageJob,
    type RoomImageWizardView,
  } from './room-image-wizard-ui.ts';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  const controller = createRoomImageWizardController({ api: createRoomImageClient() });
  let wizardState = $state<RoomImageWizardState>(controller.state());
  let view = $state<RoomImageWizardView>('upload');
  let dialog = $state<HTMLElement>();
  let previouslyFocused: HTMLElement | null = null;
  let fileInput = $state<HTMLInputElement>();
  let captureInput = $state<HTMLInputElement>();
  let file: File | null = $state(null);
  let objectUrl = $state<string | null>(null);
  let upload = $state<RoomImageUpload | null>(null);
  let uploadBusy = $state(false);
  let localError = $state<string | null>(null);
  let zoom = $state(1);
  let centerX = $state(0.5);
  let centerY = $state(0.5);
  /* Der Bildausschnitt bleibt mittig: die Perspektivkorrektur veraendert das
     Motiv ohnehin, wer etwas anderes will, macht ein neues Foto. */
  const focus: RoomImageFocus = initialRoomImageFocus();
  /* Beispielbilder aus dem Projekt: sie zeigen im leeren Zustand, worauf der
     Assistent hinauslaeuft, und liegen in jedem Build unter public/. */
  const ASSET_BASE = import.meta.env.BASE_URL;
  const candidateCount = 1 as const; // 1 Stilvariante + Komposition = 2 Kandidaten

  let consentConfirmed = $state(false);
  let selectedCandidateId = $state<string | null>(null);
  let finalCostConfirmed = $state(false);
  let retryConfirmed = $state(false);
  let fullscreenUrl = $state<string | null>(null);
  let assignRoomId = $state('');
  let assignBusy = $state(false);
  let assignError = $state<string | null>(null);
  let assignNotice = $state<string | null>(null);
  let wasOpen = false;

  /* Demo: statt eines eigenen Uploads stehen mitgelieferte Beispielfotos zur
     Wahl. Ab dem Zuschnitt ist der Ablauf identisch zum echten Assistenten. */
  let demoSources = $state<{ id: string; label: string; url: string }[]>([]);
  let demoSourceId = $state<string | null>(null);
  if (IS_DEMO) {
    void import('../../demo/demo-room-images.ts').then((demo) => {
      demoSources = demo.demoRoomImageSources();
    });
  }

  const unsubscribe = controller.subscribe((next) => {
    wizardState = next;
    if (next.job) view = viewForRoomImageJob(next.job);
  });

  const cropProjection = $derived(upload ? projectRoomImageCrop(upload.width, upload.height, { zoom, centerX, centerY }) : null);
  const currentPreview = $derived(IS_DEMO ? objectUrl : (wizardState.sourcePreviewUrl ?? objectUrl));
  const capabilityEnabled = $derived(wizardState.capability.public?.enabled === true);
  const busy = $derived(uploadBusy || wizardState.lifecycle === 'loading');
  const roomOptions = $derived(appState.rooms.map((room) => ({ id: room.id, name: room.name })));
  /* Der OpenAI-Zugang ist nur beim ersten Mal ein eigener Schritt. Steht er,
     bleibt im Kopf nur ein Chip, ueber den man ihn wieder aufklappen kann. */
  let accessStatus = $state<RoomImageAccessStatus | null>(null);
  let accessOpen = $state(false);
  const accessConfigured = $derived(IS_DEMO || accessStatus?.configured === true);
  const showAccess = $derived(!IS_DEMO && (accessOpen || !accessConfigured));
  /* Auf dem Tablet direkt aufnehmen; am Desktop ignoriert der Browser capture
     ohnehin, deshalb dort nur die Dateiauswahl. */
  const canCapture = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  /* Der Prompt folgt der erprobten Vorlage und wertet diese Felder nicht aus;
     der Contract verlangt sie weiterhin. */
  const roomImageFixedAdjustments = () => ({
    declutter: 'light' as const,
    tone: 'neutral' as const,
    preserveFeatures: ['windows' as const, 'doors' as const, 'built_ins' as const],
  });

  $effect(() => {
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resetLocalDraft();
      void Promise.all([controller.loadCapability(), controller.loadCapabilityDetails()]);
      if (!IS_DEMO) void loadAccess();
      void controller.resume();
      void tick().then(() => dialog?.focus());
    } else if (!open && wasOpen) {
      controller.close();
      fullscreenUrl = null;
      void tick().then(() => previouslyFocused?.focus());
    }
    wasOpen = open;
  });

  onDestroy(() => {
    unsubscribe();
    controller.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  async function loadAccess() {
    try {
      accessStatus = await getRoomImageAccess();
    } catch {
      accessStatus = { configured: false, mode: null, source: null };
    }
  }

  function resetLocalDraft() {
    demoSourceId = null;
    file = null;
    upload = null;
    uploadBusy = false;
    localError = null;
    zoom = 1;
    centerX = 0.5;
    centerY = 0.5;
    consentConfirmed = false;
    accessOpen = false;
    selectedCandidateId = null;
    finalCostConfirmed = false;
    retryConfirmed = false;
    assignRoomId = '';
    assignBusy = false;
    assignError = null;
    assignNotice = null;
    view = wizardState.job ? viewForRoomImageJob(wizardState.job) : 'upload';
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function requestClose() {
    onclose();
  }

  function closeOnScrim(event: MouseEvent) {
    if (event.target === event.currentTarget) requestClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      if (fullscreenUrl) fullscreenUrl = null;
      else requestClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function chooseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const selected = input.files?.[0] ?? null;
    input.value = '';
    if (!selected || uploadBusy || !capabilityEnabled) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
      localError = m.rimg_err_format();
      return;
    }
    if (selected.size > 12 * 1024 * 1024) {
      localError = m.rimg_err_size();
      return;
    }
    uploadBusy = true;
    localError = null;
    try {
      if (upload) await controller.deleteUpload(upload.uploadId);
      upload = await controller.upload(selected, selected.type as RoomImageMimeType);
      file = selected;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(selected);
      zoom = 1;
      centerX = 0.5;
      centerY = 0.5;
    } catch (error) {
      localError = error instanceof Error ? error.message : m.rimg_err_prepare();
    } finally {
      uploadBusy = false;
    }
  }

  async function chooseDemoSource(source: { id: string; label: string; url: string }) {
    if (uploadBusy) return;
    uploadBusy = true;
    localError = null;
    try {
      const demo = await import('../../demo/demo-room-images.ts');
      demo.selectDemoRoomImageSource(source.id);
      const blob = await (await fetch(source.url)).blob();
      const selected = new File([blob], `${source.id}.webp`, { type: 'image/webp' });
      if (upload) await controller.deleteUpload(upload.uploadId);
      upload = await controller.upload(selected, 'image/webp');
      file = selected;
      demoSourceId = source.id;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(selected);
      zoom = 1;
      centerX = 0.5;
      centerY = 0.5;
    } catch (error) {
      localError = error instanceof Error ? error.message : m.rimg_err_prepare();
    } finally {
      uploadBusy = false;
    }
  }

  async function startMainJob() {
    if (!upload || !consentConfirmed || busy || !capabilityEnabled) return;
    if (!cropProjection) {
      localError = m.rimg_err_crop();
      return;
    }
    localError = null;
    try {
      await controller.createMainJob({
        kind: 'main_candidates',
        uploadId: upload.uploadId,
        crop: cropProjection.crop,
        canonicalCropPixels: cropProjection.canonicalCropPixels,
        focus,
        stylePreset: 'hauser-room-v1',
        adjustments: roomImageFixedAdjustments(),
        candidateCount,
        noticeVersion: 'room-image-v1',
        costConfirmed: true,
        confirmedProviderCalls: 2,
      });
    } catch (error) {
      localError = error instanceof Error ? error.message : m.rimg_err_start();
    }
  }

  async function startFinalJob() {
    const job = wizardState.job;
    if (!job || job.kind !== 'main_candidates' || job.status !== 'succeeded' || !selectedCandidateId || !finalCostConfirmed || busy || !capabilityEnabled) return;
    await controller.createFinalJob({
      kind: 'variant_set',
      parentJobId: job.jobId,
      candidateId: selectedCandidateId,
      focus,
      noticeVersion: 'room-image-v1',
      costConfirmed: true,
      confirmedProviderCalls: 2,
    });
  }

  async function retryJob() {
    if (!retryConfirmed || busy) return;
    retryConfirmed = false;
    await controller.retry();
  }

  async function discardJob() {
    await controller.discard();
    resetLocalDraft();
  }

  /* Punkt 4+5: optional zuweisen, danach den Wizard vollstaendig zuruecksetzen,
     damit direkt ein neues Bildset erstellt werden kann. */
  async function finishWizard(asset: { assetId: string; focus: RoomImageFocus } | null) {
    if (assignBusy) return;
    if (asset && assignRoomId) {
      assignBusy = true;
      assignError = null;
      try {
        const library = await loadRoomImageLibrary();
        await assignRoomImage(assignRoomId, { assetId: asset.assetId, focus: asset.focus }, library.householdEtag);
        assignNotice = m.rimg_assigned();
      } catch (error) {
        assignError = error instanceof Error ? error.message : m.rimg_err_assign();
        assignBusy = false;
        return;
      }
      assignBusy = false;
    }
    controller.forget();
    resetLocalDraft();
    view = 'upload';
    requestClose();
  }

  function counterText(planned: number, started: number, completed: number, unknown: number) {
    return m.rimg_counter_text({ planned, started, completed, unknown });
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="room-image-wizard-layer" role="presentation" onclick={closeOnScrim}>
    <div class="room-image-wizard" role="dialog" aria-modal="true" aria-labelledby="room-image-wizard-title" tabindex="-1" bind:this={dialog}>
      <header class="room-image-wizard-head">
        <div>
          <span class="caps-label">{m.rimg_eyebrow()}</span>
          <h2 id="room-image-wizard-title">{m.rimg_title()}</h2>
          <p>{m.rimg_subtitle()}</p>
        </div>
        <div class="room-image-head-actions">
          {#if !IS_DEMO && accessConfigured}
            <button class="room-image-access-chip pressable" type="button" aria-expanded={accessOpen} onclick={() => accessOpen = !accessOpen}>
              <span aria-hidden="true"></span>
              {accessStatus?.mode === 'api_key' ? m.rimg_access_api_key() : m.rimg_access_chatgpt_plan()}
            </button>
          {/if}
          <button class="dialog-close pressable" type="button" aria-label={m.rimg_close_dialog()} onclick={requestClose}>×</button>
        </div>
      </header>

      {#if IS_DEMO}
        <p class="room-image-alert" role="status">{m.demo_rimg_notice()}</p>
      {:else if showAccess}
        <RoomImageAccess onchange={(status) => {
          accessStatus = status;
          if (status.configured) accessOpen = false;
          void Promise.all([controller.loadCapability(), controller.loadCapabilityDetails()]);
        }} />
      {/if}

      {#if wizardState.capability.error}
        <p class="room-image-alert is-error" role="alert">{wizardState.capability.error.message}</p>
      {:else if wizardState.capability.public?.imageCapability === 'disabled'}
        <p class="room-image-alert" role="status">{m.rimg_cap_disabled()}</p>
      {/if}

      {#if wizardState.lifecycle === 'error' && wizardState.error && view !== 'upload'}
        <p class="room-image-alert is-error" role="alert">{wizardState.error.message}</p>
      {/if}

      {#if !accessConfigured}
        <p class="room-image-alert" role="status">{m.rimg_need_access()}</p>
      {:else if accessOpen}
        <footer class="room-image-wizard-actions">
          <button class="secondary-btn pressable" type="button" onclick={() => accessOpen = false}>{m.rimg_access_back()}</button>
        </footer>
      {:else if view === 'upload'}
        <div class="room-image-wizard-grid">
          <section class="room-image-wizard-main room-image-hero" class:is-split={!IS_DEMO}>
            <div class="room-image-hero-copy">
              <h3><span class="room-image-step" aria-hidden="true">1</span>{m.rimg_step_photo()}</h3>
              {#if IS_DEMO}
                <p>{m.demo_rimg_pick_hint()}</p>
                <div class="room-image-demo-sources" role="group" aria-label={m.demo_rimg_pick()}>
                  {#each demoSources as source (source.id)}
                    <button class="room-image-demo-source pressable" type="button" class:is-active={demoSourceId === source.id}
                            disabled={uploadBusy} onclick={() => chooseDemoSource(source)}>
                      <img src={source.url} alt="" loading="lazy" />
                      <span>{source.label}</span>
                    </button>
                  {/each}
                </div>
              {:else}
                <p>{m.rimg_photo_hint()}</p>
                <input hidden bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onchange={chooseFile} />
                <div class="room-image-pick">
                  <button class="primary-btn pressable" type="button" disabled={uploadBusy || !capabilityEnabled} onclick={() => fileInput?.click()}>
                    <Icon name="i-tray-arrow-up" cls="icon icon-sm" />
                    {uploadBusy ? m.rimg_photo_preparing() : file ? m.rimg_photo_other() : m.rimg_photo_choose()}
                  </button>
                  {#if canCapture}
                    <input hidden bind:this={captureInput} type="file" accept="image/*" capture="environment" onchange={chooseFile} />
                    <button class="secondary-btn pressable" type="button" disabled={uploadBusy || !capabilityEnabled} onclick={() => captureInput?.click()}>
                      <Icon name="i-camera-outline" cls="icon icon-sm" />
                      {m.rimg_photo_capture()}
                    </button>
                  {/if}
                </div>
              {/if}
              <p class="room-image-nav-hint">
                <Icon name="i-lightbulb-on-outline" cls="icon icon-sm" />
                <span>{m.rimg_nav_hint()}</span>
              </p>
            </div>

            {#if !IS_DEMO}
              <button class="room-image-dropzone pressable" type="button" class:has-photo={Boolean(upload && objectUrl)}
                      disabled={uploadBusy || !capabilityEnabled}
                      aria-label={upload ? m.rimg_photo_other() : m.rimg_photo_choose()} onclick={() => fileInput?.click()}
                      style:background-image={upload && objectUrl ? `url("${objectUrl}")` : `url("${ASSET_BASE}hero/schlafzimmer-light.avif")`}>
                {#if !upload}
                  <span class="room-image-crop-guide" aria-hidden="true"><span>{m.rimg_nav_guide()}</span></span>
                  <span class="room-image-dropzone-mark" aria-hidden="true"><Icon name="i-cloud-upload-outline" cls="icon icon-md" /></span>
                {/if}
              </button>
            {/if}
          </section>

          <aside class="room-image-wizard-side">
            <h3>{m.rimg_flow_title()}</h3>
            <ol class="room-image-flow">
              <li><span aria-hidden="true">1</span>{m.rimg_photo_choose()}</li>
              <li><span aria-hidden="true">2</span>{m.rimg_candidates_title()}</li>
              <li><span aria-hidden="true">3</span>{m.rimg_review_title()}</li>
            </ol>
            <div class="room-image-consent">
              <label class="room-image-check"><input type="checkbox" bind:checked={consentConfirmed} />
                <span>{m.rimg_consent_confirm()}</span>
              </label>
              <span class="room-image-info">
                <button class="room-image-info-btn" type="button" aria-label={m.rimg_consent_info_label()} aria-describedby="rimg-consent-info">i</button>
                <span class="room-image-info-bubble" role="tooltip" id="rimg-consent-info">
                  <span>{m.rimg_consent_detail()}</span>
                  <a href="https://developers.openai.com/api/docs/pricing#image-generation" target="_blank" rel="noreferrer">{m.rimg_prices_link()}</a>
                </span>
              </span>
            </div>
          </aside>
        </div>
        {#if !upload}
          <section class="room-image-teaser">
            <figure>
              <img src={`${ASSET_BASE}wizard/before.webp`} alt="" loading="lazy" />
              <figcaption>{m.rimg_before()}</figcaption>
            </figure>
            <span class="room-image-teaser-arrow" aria-hidden="true"><Icon name="i-arrow-right" cls="icon icon-sm" /></span>
            <figure>
              <img src={`${ASSET_BASE}wizard/after.webp`} alt="" loading="lazy" />
              <figcaption>{m.rimg_after()}</figcaption>
            </figure>
            <p><strong>{m.rimg_teaser_title()}</strong><span>{m.rimg_teaser_sub()}</span></p>
          </section>
        {/if}
        {#if localError}<p class="room-image-alert is-error" role="alert">{localError}</p>{/if}
        {#if wizardState.lifecycle === 'error' && wizardState.error}
          <p class="room-image-alert is-error" role="alert">{wizardState.error.message}</p>
        {/if}
        <footer class="room-image-wizard-actions">
          <button class="secondary-btn pressable" type="button" onclick={requestClose}>{m.rimg_close()}</button>
          <button class="primary-btn pressable" type="button" disabled={!upload || !consentConfirmed || busy || !capabilityEnabled} onclick={startMainJob}>
            {m.rimg_start()}
            <Icon name="i-creation" cls="icon icon-sm" />
          </button>
        </footer>

      {:else if wizardState.job}
        {@const job = wizardState.job}
        {#if view === 'job-progress'}
          <section class="room-image-progress" aria-live="polite">
            <span class="room-image-progress-mark" aria-hidden="true"></span>
            <h3>{roomImagePhaseLabel(job)}</h3>
            <p>{m.rimg_job_background()}</p>
            <div class="room-image-counter-grid">
              <div><strong>{m.rimg_counter_attempt()}</strong><span>{counterText(job.providerCalls.attempt.plannedCount, job.providerCalls.attempt.startedCount, job.providerCalls.attempt.completedCount, job.providerCalls.attempt.outcomeUnknownCount)}</span></div>
              <div><strong>{m.rimg_counter_lineage()}</strong><span>{counterText(job.providerCalls.lineage.plannedCount, job.providerCalls.lineage.startedCount, job.providerCalls.lineage.completedCount, job.providerCalls.lineage.outcomeUnknownCount)}</span></div>
              <div><strong>{m.rimg_counter_wizard()}</strong><span>{counterText(job.providerCalls.wizard.plannedCount, job.providerCalls.wizard.startedCount, job.providerCalls.wizard.completedCount, job.providerCalls.wizard.outcomeUnknownCount)}</span></div>
            </div>
            <footer class="room-image-wizard-actions">
              <button class="secondary-btn pressable" type="button" onclick={requestClose}>{m.rimg_run_background()}</button>
              {#if job.cancellable}<button class="secondary-btn danger-btn pressable" type="button" onclick={() => controller.cancel()}>{m.rimg_cancel_job()}</button>{/if}
            </footer>
          </section>

        {:else if view === 'candidates'}
          <section>
            <h3>{m.rimg_candidates_title()}</h3>
            <p>{m.rimg_candidates_hint()}</p>
            <div class="room-image-compare">
              {#if currentPreview}
                <figure><button type="button" onclick={() => fullscreenUrl = currentPreview}><img src={currentPreview} alt={m.rimg_before_alt()} /></button><figcaption>{m.rimg_before()}</figcaption></figure>
              {/if}
              {#each job.candidates as candidate, index (candidate.candidateId)}
                <figure class:is-selected={selectedCandidateId === candidate.candidateId}>
                  <button type="button" onclick={() => selectedCandidateId = candidate.candidateId}><img src={candidate.previewUrl} alt={index === 0 ? m.rimg_variant_realistic_alt() : m.rimg_variant_illustration_alt()} /></button>
                  <figcaption><label><input type="radio" name="room-image-candidate" checked={selectedCandidateId === candidate.candidateId} onchange={() => selectedCandidateId = candidate.candidateId} /> {index === 0 ? m.rimg_variant_realistic() : m.rimg_variant_illustration()}</label></figcaption>
                </figure>
              {/each}
            </div>
            <div class="room-image-final-confirm">
              <h3>{m.rimg_night_title()}</h3>
              <p>{m.rimg_night_hint()}</p>
              <label class="room-image-check"><input type="checkbox" bind:checked={finalCostConfirmed} />
                <span>{m.rimg_cost_confirm_2_more()}</span>
              </label>
            </div>
            <footer class="room-image-wizard-actions">
              <button class="secondary-btn pressable" type="button" onclick={() => controller.cancel()}>{m.rimg_discard_variants()}</button>
              <button class="primary-btn pressable" type="button" disabled={!selectedCandidateId || !finalCostConfirmed || busy || !capabilityEnabled} onclick={startFinalJob}>{m.rimg_create_set()}</button>
            </footer>
          </section>

        {:else if view === 'set-review' && job.temporaryVariants}
          <section>
            <h3>{m.rimg_review_title()}</h3>
            <p>{m.rimg_review_hint()}</p>
            <div class="room-image-set-grid">
              {#each [[m.rimg_variant_light(), job.temporaryVariants.light], [m.rimg_variant_dark_on(), job.temporaryVariants.dark], [m.rimg_variant_dark_off(), job.temporaryVariants.darkOff]] as variant (variant[0])}
                <figure><button type="button" onclick={() => fullscreenUrl = variant[1]}><img src={variant[1]} alt={variant[0]} /></button><figcaption>{variant[0]}</figcaption></figure>
              {/each}
            </div>
            <footer class="room-image-wizard-actions">
              <button class="secondary-btn danger-btn pressable" type="button" onclick={() => controller.cancel()}>{m.rimg_reject_set()}</button>
              <button class="primary-btn pressable" type="button" disabled={busy || !capabilityEnabled} onclick={() => controller.publish(true)}>{m.rimg_accept_set()}</button>
            </footer>
          </section>

        {:else if view === 'done' && job.asset}
          <section class="room-image-done">
            <h3>{m.rimg_saved_title()}</h3>
            <div class="room-image-set-grid">
              {#each [[m.rimg_variant_light(), job.asset.variants.light], [m.rimg_variant_dark_on(), job.asset.variants.dark], [m.rimg_variant_dark_off(), job.asset.variants.darkOff]] as variant (variant[0])}
                <figure><button type="button" onclick={() => fullscreenUrl = variant[1]}><img src={variant[1]} alt={variant[0]} /></button><figcaption>{variant[0]}</figcaption></figure>
              {/each}
            </div>
            <div class="room-image-final-confirm">
              <h3>{m.rimg_assign_title()}</h3>
              <p>{m.rimg_assign_hint()}</p>
              <label>{m.rimg_room()}
                <select bind:value={assignRoomId} disabled={assignBusy}>
                  <option value="">{m.rimg_assign_none()}</option>
                  {#each roomOptions as room (room.id)}
                    <option value={room.id}>{room.name}</option>
                  {/each}
                </select>
              </label>
              {#if assignError}<p class="room-image-alert is-error" role="alert">{assignError}</p>{/if}
              {#if assignNotice}<p class="room-image-alert" role="status">{assignNotice}</p>{/if}
            </div>
            <footer class="room-image-wizard-actions">
              <button class="primary-btn pressable" type="button" disabled={assignBusy}
                      onclick={() => finishWizard(job.asset)}>
                {assignBusy ? m.rimg_assigning() : assignRoomId ? m.rimg_assign_and_done() : m.rimg_done()}
              </button>
            </footer>
          </section>

        {:else}
          <section class="room-image-terminal">
            <h3>{job.status === 'cancelled' ? m.rimg_term_cancelled() : job.status === 'expired' ? m.rimg_term_expired() : m.rimg_term_failed()}</h3>
            {#if job.error}<p class="room-image-alert is-error" role="alert">{job.error.message}</p>{/if}
            {#if job.retryable && job.retry}
              <p>{m.rimg_retry_hint({ count: job.retry.requiredProviderCalls })}</p>
              <label class="room-image-check"><input type="checkbox" bind:checked={retryConfirmed} /> <span>{m.rimg_retry_confirm()}</span></label>
            {/if}
            <footer class="room-image-wizard-actions">
              {#if job.discardable}<button class="secondary-btn pressable" type="button" onclick={discardJob}>{m.rimg_discard_temp()}</button>{/if}
              {#if job.retryable}<button class="primary-btn pressable" type="button" disabled={!retryConfirmed || busy || !capabilityEnabled} onclick={retryJob}>{m.rimg_retry()}</button>{/if}
              <button class="secondary-btn pressable" type="button" onclick={requestClose}>{m.rimg_close()}</button>
            </footer>
          </section>
        {/if}
      {:else if wizardState.lifecycle === 'loading'}
        <p class="room-image-alert" role="status">{m.rimg_checking_previous()}</p>
      {/if}
    </div>
  </div>

  {#if fullscreenUrl}
    <div class="room-image-fullscreen" role="dialog" aria-modal="true" aria-label={m.rimg_fullscreen_label()}>
      <button type="button" aria-label={m.rimg_fullscreen_close()} onclick={() => fullscreenUrl = null}>×</button>
      <img src={fullscreenUrl} alt={m.rimg_fullscreen_alt()} />
    </div>
  {/if}
{/if}
