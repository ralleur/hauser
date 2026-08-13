<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import RoomImageAccess from './RoomImageAccess.svelte';
  import { createRoomImageClient, type RoomImageFocus, type RoomImageMimeType, type RoomImagePreserveFeature, type RoomImageUpload } from '../../state/room-image-client.ts';
  import { createRoomImageWizardController, type RoomImageWizardState } from '../../state/room-image-wizard-state.ts';
  import {
    initialRoomImageFocus,
    pointFromPointer,
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
  let file: File | null = $state(null);
  let objectUrl = $state<string | null>(null);
  let upload = $state<RoomImageUpload | null>(null);
  let uploadBusy = $state(false);
  let localError = $state<string | null>(null);
  let zoom = $state(1);
  let centerX = $state(0.5);
  let centerY = $state(0.5);
  let focus = $state<RoomImageFocus>(initialRoomImageFocus());
  let focusTarget = $state<'panel' | 'phone'>('panel');
  let declutter = $state<'none' | 'light' | 'strong'>('light');
  let tone = $state<'neutral' | 'warm'>('neutral');
  let preserveFeatures = $state<RoomImagePreserveFeature[]>(['windows', 'doors', 'built_ins']);
  let candidateCount = $state<1 | 2>(2);
  let privacyConfirmed = $state(false);
  let costConfirmed = $state(false);
  let selectedCandidateId = $state<string | null>(null);
  let finalCostConfirmed = $state(false);
  let retryConfirmed = $state(false);
  let fullscreenUrl = $state<string | null>(null);
  let wasOpen = false;

  const unsubscribe = controller.subscribe((next) => {
    wizardState = next;
    if (next.job) view = viewForRoomImageJob(next.job);
  });

  const cropProjection = $derived(upload ? projectRoomImageCrop(upload.width, upload.height, { zoom, centerX, centerY }) : null);
  const currentPreview = $derived(wizardState.sourcePreviewUrl ?? objectUrl);
  const capabilityEnabled = $derived(wizardState.capability.public?.enabled === true);
  const busy = $derived(uploadBusy || wizardState.lifecycle === 'loading');
  let accessConfigured = $state(false);

  const preservationOptions: readonly { id: RoomImagePreserveFeature; label: string; hint: string }[] = [
    { id: 'windows', label: 'Fenster', hint: 'Position, Form und sichtbare Außenansicht erhalten' },
    { id: 'doors', label: 'Türen', hint: 'Öffnungen und räumliche Verbindungen erhalten' },
    { id: 'built_ins', label: 'Feste Einbauten', hint: 'Küche, Schränke und feste Elemente erhalten' },
    { id: 'signature_furniture', label: 'Prägende Möbel', hint: 'Charakteristische Möbel und ihre Position erhalten' },
    { id: 'wall_art', label: 'Wandbilder', hint: 'Vorhandene Kunst erhalten, nichts neu erfinden' },
  ];

  $effect(() => {
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      resetLocalDraft();
      void Promise.all([controller.loadCapability(), controller.loadCapabilityDetails()]);
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

  function resetLocalDraft() {
    file = null;
    upload = null;
    uploadBusy = false;
    localError = null;
    zoom = 1;
    centerX = 0.5;
    centerY = 0.5;
    focus = initialRoomImageFocus();
    focusTarget = 'panel';
    declutter = 'light';
    tone = 'neutral';
    preserveFeatures = ['windows', 'doors', 'built_ins'];
    candidateCount = 2;
    privacyConfirmed = false;
    costConfirmed = false;
    selectedCandidateId = null;
    finalCostConfirmed = false;
    retryConfirmed = false;
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
      localError = 'Bitte ein JPEG-, PNG- oder WebP-Bild wählen.';
      return;
    }
    if (selected.size > 12 * 1024 * 1024) {
      localError = 'Das Bild darf höchstens 12 MiB groß sein.';
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
      focus = initialRoomImageFocus();
    } catch (error) {
      localError = error instanceof Error ? error.message : 'Das Foto konnte nicht vorbereitet werden.';
    } finally {
      uploadBusy = false;
    }
  }

  function setCropCenter(event: PointerEvent) {
    const point = pointFromPointer(event);
    centerX = point.x;
    centerY = point.y;
  }

  function setFocus(event: PointerEvent) {
    const point = pointFromPointer(event);
    focus = { ...focus, [focusTarget]: point };
  }

  function togglePreservation(feature: RoomImagePreserveFeature) {
    preserveFeatures = preserveFeatures.includes(feature)
      ? preserveFeatures.filter((entry) => entry !== feature)
      : [...preserveFeatures, feature];
  }

  async function startMainJob() {
    if (!upload || !cropProjection || !privacyConfirmed || !costConfirmed || busy || !capabilityEnabled) return;
    localError = null;
    await controller.createMainJob({
      kind: 'main_candidates',
      uploadId: upload.uploadId,
      crop: cropProjection.crop,
      canonicalCropPixels: cropProjection.canonicalCropPixels,
      focus,
      stylePreset: 'hauser-room-v1',
      adjustments: { declutter, tone, preserveFeatures },
      candidateCount,
      noticeVersion: 'room-image-v1',
      costConfirmed: true,
      confirmedProviderCalls: candidateCount === 1 ? 2 : 3,
    });
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

  function counterText(planned: number, started: number, completed: number, unknown: number) {
    return `${planned} geplant · ${started} gestartet · ${completed} abgeschlossen · ${unknown} Ausgang unbekannt`;
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="room-image-wizard-layer" role="presentation" onclick={closeOnScrim}>
    <div class="room-image-wizard" role="dialog" aria-modal="true" aria-labelledby="room-image-wizard-title" tabindex="-1" bind:this={dialog}>
      <header class="room-image-wizard-head">
        <div>
          <span class="caps-label">KI · Raumbilder</span>
          <h2 id="room-image-wizard-title">Raumbild erstellen</h2>
          <p>Foto vorbereiten, Varianten prüfen, Bildset bewusst übernehmen.</p>
        </div>
        <button class="dialog-close pressable" type="button" aria-label="Raumbild-Wizard schließen" onclick={requestClose}>×</button>
      </header>

      <RoomImageAccess onchange={(status) => {
        accessConfigured = status.configured;
        void Promise.all([controller.loadCapability(), controller.loadCapabilityDetails()]);
      }} />

      {#if wizardState.capability.error}
        <p class="room-image-alert is-error" role="alert">{wizardState.capability.error.message}</p>
      {:else if wizardState.capability.public?.imageCapability === 'disabled'}
        <p class="room-image-alert" role="status">Die Raumbild-Erstellung ist auf diesem System nicht freigegeben.</p>
      {:else if wizardState.capability.public?.imageCapability === 'unverified'}
        <p class="room-image-alert" role="status">OpenAI ist konfiguriert, ein echter Bildabruf wurde in dieser Laufzeit aber noch nicht bestätigt.</p>
      {/if}

      {#if !accessConfigured}
        <p class="room-image-alert" role="status">Verbinde zuerst ChatGPT oder hinterlege einen API-Key. Danach wird die Bildauswahl freigeschaltet.</p>
      {:else if view === 'upload'}
        <div class="room-image-wizard-grid">
          <section class="room-image-wizard-main">
            <h3>1 · Foto, Ausschnitt und Fokus</h3>
            <p>Ein Querformat ohne Personen ist ideal. Unaufgeräumte Räume sind ausdrücklich okay.</p>
            <input hidden bind:this={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onchange={chooseFile} />
            <button class="secondary-btn pressable" type="button" disabled={uploadBusy || !capabilityEnabled} onclick={() => fileInput?.click()}>
              {uploadBusy ? 'Foto wird vorbereitet …' : file ? 'Anderes Foto wählen' : 'Foto wählen'}
            </button>

            {#if upload && objectUrl && cropProjection}
              <div class="room-image-crop" role="img" aria-label="Gewählter Bildausschnitt" onpointerdown={setCropCenter}
                   style:background-image={`url("${objectUrl}")`} style:background-size={cropProjection.backgroundSize}
                   style:background-position={cropProjection.backgroundPosition}></div>
              <label class="room-image-range">
                <span>Ausschnitt vergrößern</span>
                <input type="range" min="1" max="3" step="0.05" bind:value={zoom} />
              </label>
              <div class="room-image-focus-tabs" role="group" aria-label="Fokus für Geräteformat">
                <button type="button" class:is-active={focusTarget === 'panel'} onclick={() => focusTarget = 'panel'}>Panel</button>
                <button type="button" class:is-active={focusTarget === 'phone'} onclick={() => focusTarget = 'phone'}>Phone</button>
              </div>
              <button class="room-image-focus-preview" type="button" aria-label="Fokuspunkt für {focusTarget} setzen" onpointerdown={setFocus}
                      style:background-image={`url("${objectUrl}")`} style:background-size={cropProjection.backgroundSize}
                      style:background-position={cropProjection.backgroundPosition}>
                <span style:left={`${focus[focusTarget].x * 100}%`} style:top={`${focus[focusTarget].y * 100}%`}></span>
              </button>
              <small>Tippe in die Vorschau, wo der wichtigste Bildbereich für {focusTarget === 'panel' ? 'das Panel' : 'das Phone'} liegen soll.</small>
            {/if}
          </section>

          <aside class="room-image-wizard-side">
            <h3>2 · Geschlossene Vorgaben</h3>
            <label>Aufräumen
              <select bind:value={declutter}>
                <option value="none">Nichts entfernen</option>
                <option value="light">Leicht beruhigen</option>
                <option value="strong">Stark beruhigen</option>
              </select>
            </label>
            <label>Farbton
              <select bind:value={tone}>
                <option value="neutral">Neutral</option>
                <option value="warm">Warm</option>
              </select>
            </label>
            <fieldset class="room-image-preservation">
              <legend>Besonders erhalten</legend>
              {#each preservationOptions as option (option.id)}
                <label>
                  <input type="checkbox" checked={preserveFeatures.includes(option.id)} onchange={() => togglePreservation(option.id)} />
                  <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                </label>
              {/each}
            </fieldset>
            <p class="room-image-policy">Raumidentität, Architektur und räumliche Beziehungen bleiben immer erhalten. Nur die erste Stufe darf Perspektive und Komposition moderat korrigieren; danach sind Kamera, Geometrie, Layout und Objektpositionen eingefroren.</p>

            <h3>3 · Übertragung und mögliche Kosten</h3>
            <label class="room-image-check"><input type="checkbox" bind:checked={privacyConfirmed} />
              <span>Ich bestätige, dass das normalisierte Foto an OpenAI übertragen wird und habe Personen sowie sensible Inhalte geprüft.</span>
            </label>
            <label>Anzahl Stilvarianten
              <select bind:value={candidateCount}>
                <option value={1}>Eine</option>
                <option value={2}>Zwei</option>
              </select>
            </label>
            <p>Geplant sind {candidateCount + 1} Providerabrufe: eine Kompositionsoptimierung und {candidateCount} unabhängige Stilvariante{candidateCount === 1 ? '' : 'n'}. Preise werden nicht geschätzt; es gelten die laufenden OpenAI-Bedingungen.</p>
            <a href="https://developers.openai.com/api/docs/pricing#image-generation" target="_blank" rel="noreferrer">Aktuelle OpenAI-Preise öffnen</a>
            <label class="room-image-check"><input type="checkbox" bind:checked={costConfirmed} />
              <span>Ich bestätige die möglichen Kosten für diese {candidateCount + 1} Abrufe.</span>
            </label>
          </aside>
        </div>
        {#if localError}<p class="room-image-alert is-error" role="alert">{localError}</p>{/if}
        <footer class="room-image-wizard-actions">
          <button class="secondary-btn pressable" type="button" onclick={requestClose}>Schließen</button>
          <button class="primary-btn pressable" type="button" disabled={!upload || !privacyConfirmed || !costConfirmed || busy || !capabilityEnabled} onclick={startMainJob}>Varianten erstellen</button>
        </footer>

      {:else if wizardState.job}
        {@const job = wizardState.job}
        {#if view === 'job-progress'}
          <section class="room-image-progress" aria-live="polite">
            <span class="room-image-progress-mark" aria-hidden="true"></span>
            <h3>{roomImagePhaseLabel(job)}</h3>
            <p>Der Auftrag läuft serverseitig weiter, auch wenn du dieses Fenster schließt.</p>
            <div class="room-image-counter-grid">
              <div><strong>Dieser Versuch</strong><span>{counterText(job.providerCalls.attempt.plannedCount, job.providerCalls.attempt.startedCount, job.providerCalls.attempt.completedCount, job.providerCalls.attempt.outcomeUnknownCount)}</span></div>
              <div><strong>Diese Linie</strong><span>{counterText(job.providerCalls.lineage.plannedCount, job.providerCalls.lineage.startedCount, job.providerCalls.lineage.completedCount, job.providerCalls.lineage.outcomeUnknownCount)}</span></div>
              <div><strong>Gesamter Wizard</strong><span>{counterText(job.providerCalls.wizard.plannedCount, job.providerCalls.wizard.startedCount, job.providerCalls.wizard.completedCount, job.providerCalls.wizard.outcomeUnknownCount)}</span></div>
            </div>
            <footer class="room-image-wizard-actions">
              <button class="secondary-btn pressable" type="button" onclick={requestClose}>Im Hintergrund weiterlaufen lassen</button>
              {#if job.cancellable}<button class="secondary-btn danger-btn pressable" type="button" onclick={() => controller.cancel()}>Auftrag abbrechen</button>{/if}
            </footer>
          </section>

        {:else if view === 'candidates'}
          <section>
            <h3>Vorher und Stilvarianten</h3>
            <p>Wähle genau eine Variante. Das realistische Kompositionszwischenbild bleibt privat und wird nicht als Asset angeboten.</p>
            <div class="room-image-compare">
              {#if currentPreview}
                <figure><button type="button" onclick={() => fullscreenUrl = currentPreview}><img src={currentPreview} alt="Normalisierter Ausgangsausschnitt" /></button><figcaption>Vorher</figcaption></figure>
              {/if}
              {#each job.candidates as candidate, index (candidate.candidateId)}
                <figure class:is-selected={selectedCandidateId === candidate.candidateId}>
                  <button type="button" onclick={() => selectedCandidateId = candidate.candidateId}><img src={candidate.previewUrl} alt="Stilvariante {index + 1}" /></button>
                  <figcaption><label><input type="radio" name="room-image-candidate" checked={selectedCandidateId === candidate.candidateId} onchange={() => selectedCandidateId = candidate.candidateId} /> Variante {index + 1}</label></figcaption>
                </figure>
              {/each}
            </div>
            <div class="room-image-final-confirm">
              <h3>Nachtvarianten erzeugen</h3>
              <p>Für die gewählte Light-Variante folgen zwei weitere, unabhängige Providerabrufe: <strong>dark</strong> und <strong>dark-off</strong>.</p>
              <label class="room-image-check"><input type="checkbox" bind:checked={finalCostConfirmed} />
                <span>Ich bestätige die möglichen Kosten für diese 2 weiteren Abrufe.</span>
              </label>
            </div>
            <footer class="room-image-wizard-actions">
              <button class="secondary-btn pressable" type="button" onclick={() => controller.cancel()}>Varianten verwerfen</button>
              <button class="primary-btn pressable" type="button" disabled={!selectedCandidateId || !finalCostConfirmed || busy || !capabilityEnabled} onclick={startFinalJob}>Bildset erstellen</button>
            </footer>
          </section>

        {:else if view === 'set-review' && job.temporaryVariants}
          <section>
            <h3>Bildset gemeinsam prüfen</h3>
            <p>Technische Prüfung ersetzt nicht deine Entscheidung. Kontrolliere, ob Raum, Geometrie und Beleuchtungszustände wirklich zusammenpassen.</p>
            <div class="room-image-set-grid">
              {#each [['Light', job.temporaryVariants.light], ['Dark · Licht an', job.temporaryVariants.dark], ['Dark · Licht aus', job.temporaryVariants.darkOff]] as variant (variant[0])}
                <figure><button type="button" onclick={() => fullscreenUrl = variant[1]}><img src={variant[1]} alt={variant[0]} /></button><figcaption>{variant[0]}</figcaption></figure>
              {/each}
            </div>
            <footer class="room-image-wizard-actions">
              <button class="secondary-btn danger-btn pressable" type="button" onclick={() => controller.cancel()}>Set ablehnen</button>
              <button class="primary-btn pressable" type="button" disabled={busy || !capabilityEnabled} onclick={() => controller.publish(true)}>Set übernehmen</button>
            </footer>
          </section>

        {:else if view === 'done' && job.asset}
          <section class="room-image-done">
            <h3>Bildset ist in der Bibliothek gespeichert</h3>
            <div class="room-image-set-grid">
              {#each [['Light', job.asset.variants.light], ['Dark · Licht an', job.asset.variants.dark], ['Dark · Licht aus', job.asset.variants.darkOff]] as variant (variant[0])}
                <figure><button type="button" onclick={() => fullscreenUrl = variant[1]}><img src={variant[1]} alt={variant[0]} /></button><figcaption>{variant[0]}</figcaption></figure>
              {/each}
            </div>
            <p>Es wurde noch keinem Raum zugewiesen. Die Zuordnung und Bibliotheksverwaltung folgen getrennt unter „Räume &amp; Geräte“.</p>
            <footer class="room-image-wizard-actions">
              <button class="primary-btn pressable" type="button" onclick={requestClose}>Fertig</button>
            </footer>
          </section>

        {:else}
          <section class="room-image-terminal">
            <h3>{job.status === 'cancelled' ? 'Auftrag abgebrochen' : job.status === 'expired' ? 'Zwischendaten abgelaufen' : 'Auftrag konnte nicht abgeschlossen werden'}</h3>
            {#if job.error}<p class="room-image-alert is-error" role="alert">{job.error.message}</p>{/if}
            {#if job.retryable && job.retry}
              <p>Ein neuer Versuch benötigt eine neue Bestätigung für {job.retry.requiredProviderCalls} mögliche Providerabrufe.</p>
              <label class="room-image-check"><input type="checkbox" bind:checked={retryConfirmed} /> <span>Erneuten kostenpflichtigen Versuch bestätigen</span></label>
            {/if}
            <footer class="room-image-wizard-actions">
              {#if job.discardable}<button class="secondary-btn pressable" type="button" onclick={discardJob}>Zwischendaten verwerfen</button>{/if}
              {#if job.retryable}<button class="primary-btn pressable" type="button" disabled={!retryConfirmed || busy || !capabilityEnabled} onclick={retryJob}>Neu versuchen</button>{/if}
              <button class="secondary-btn pressable" type="button" onclick={requestClose}>Schließen</button>
            </footer>
          </section>
        {/if}
      {:else if wizardState.lifecycle === 'loading'}
        <p class="room-image-alert" role="status">Vorherigen Auftrag prüfen …</p>
      {/if}
    </div>
  </div>

  {#if fullscreenUrl}
    <div class="room-image-fullscreen" role="dialog" aria-modal="true" aria-label="Bildvorschau">
      <button type="button" aria-label="Vollbildvorschau schließen" onclick={() => fullscreenUrl = null}>×</button>
      <img src={fullscreenUrl} alt="Große Raumbildvorschau" />
    </div>
  {/if}
{/if}
