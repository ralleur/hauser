<script lang="ts">
  import '../../styles/ablage.css';
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    ABLAGE_ACCEPT, ablage, enterAblage, importAblageFiles, leaveAblage, refreshAblageProcessing, searchAblage, unlockAblage, type AblageDateRange,
  } from '../state/ablage.svelte.ts';
  import { nav } from '../state/nav.svelte.ts';

  type DateFilter = 'month' | 'six-months' | 'custom' | null;

  let { phone = false, titleAnchor = $bindable() }: { phone?: boolean; titleAnchor?: HTMLHeadingElement } = $props();
  let pin = $state('');
  let query = $state('');
  let dateFilter = $state<DateFilter>(null);
  let dateRange = $state<AblageDateRange | undefined>();
  let dateDialogOpen = $state(false);
  let draftFrom = $state('');
  let draftTo = $state('');
  let dateError = $state<string | null>(null);
  let openDocument = $state<{ id: number; title: string } | null>(null);
  let pinInput = $state<HTMLInputElement>();
  let searchInput = $state<HTMLInputElement>();
  let fromInput = $state<HTMLInputElement>();
  let fileInput = $state<HTMLInputElement>();
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let panelWasActive = false;

  const today = $derived(formatLocalDate(new Date()));

  async function pollProcessing() {
    const previousCount = ablage.processing.length;
    await refreshAblageProcessing();
    if (previousCount > 0 && ablage.processing.length === 0 && !ablage.processingError && ablage.unlocked) {
      await searchAblage(query, 1, dateRange);
    }
  }

  $effect(() => {
    if (!ablage.unlocked) return;
    void pollProcessing();
    const timer = setInterval(() => void pollProcessing(), 3000);
    return () => clearInterval(timer);
  });

  onMount(async () => {
    if (!phone) return;
    await enterAblage();
    await tick();
    pinInput?.focus();
  });

  $effect(() => {
    if (phone) return;
    const active = nav.screen === 'ablage';
    if (active === panelWasActive) return;
    panelWasActive = active;
    if (active) {
      void enterAblage().then(tick).then(() => pinInput?.focus());
    } else {
      void leaveAblage();
    }
  });

  onDestroy(() => {
    if (searchTimer) clearTimeout(searchTimer);
    void leaveAblage();
  });

  function formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function monthsAgo(months: number): string {
    const now = new Date();
    const day = now.getDate();
    now.setDate(1);
    now.setMonth(now.getMonth() - months);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    now.setDate(Math.min(day, lastDay));
    return formatLocalDate(now);
  }

  async function submitPin(event: SubmitEvent) {
    event.preventDefault();
    if (!pin || ablage.loading) return;
    const unlocked = await unlockAblage(pin);
    pin = '';
    if (!unlocked) {
      await tick();
      pinInput?.focus();
      return;
    }
    await searchAblage('', 1, dateRange);
    await tick();
    searchInput?.focus();
  }

  function queueSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void searchAblage(query, 1, dateRange), 250);
  }

  function applyPreset(filter: Exclude<DateFilter, 'custom' | null>, months: number) {
    dateFilter = filter;
    dateRange = { from: monthsAgo(months), to: today };
    void searchAblage(query, 1, dateRange);
  }

  async function openDateDialog() {
    draftFrom = dateRange?.from ?? '';
    draftTo = dateRange?.to ?? today;
    dateError = null;
    dateDialogOpen = true;
    await tick();
    fromInput?.focus();
  }

  function closeDateDialog() {
    dateDialogOpen = false;
    dateError = null;
  }

  function showDocument(document: { id: number; title: string }) {
    openDocument = document;
  }

  function closeDocument() {
    openDocument = null;
  }

  function applyCustomRange(event: SubmitEvent) {
    event.preventDefault();
    if (!draftFrom || !draftTo) {
      dateError = 'Bitte Von und Bis auswählen.';
      return;
    }
    if (draftFrom > draftTo) {
      dateError = '„Von“ muss vor „Bis“ liegen.';
      return;
    }
    dateFilter = 'custom';
    dateRange = { from: draftFrom, to: draftTo };
    closeDateDialog();
    void searchAblage(query, 1, dateRange);
  }

  function clearDateRange() {
    dateFilter = null;
    dateRange = undefined;
    closeDateDialog();
    void searchAblage(query);
  }

  async function importFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const imported = await importAblageFiles(files);
    if (imported > 0 && ablage.unlocked) await searchAblage(query, 1, dateRange);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (openDocument) closeDocument();
    else if (dateDialogOpen) closeDateDialog();
  }

  function formatDate(value: string | null): string {
    if (!value) return 'Datum unbekannt';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Datum unbekannt' : date.toLocaleDateString('de-DE');
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class:phone-ablage={phone} class:screen-inner={!phone} class="ablage-screen" aria-labelledby="ablage-title">
  {#if !ablage.unlocked}
    <section class="ablage-pin-card">
      <p class="ablage-eyebrow">Geschützter Bereich</p>
      <h1 bind:this={titleAnchor} id="ablage-title" tabindex="-1">Ablage</h1>
      <p>Dokumente werden erst nach Eingabe deiner PIN geladen.</p>
      {#if !ablage.configured}
        <p class="ablage-error" role="alert">Die Ablage ist serverseitig noch nicht konfiguriert.</p>
      {:else}
        <form onsubmit={submitPin}>
          <label for="ablage-pin">PIN</label>
          <input bind:this={pinInput} bind:value={pin} id="ablage-pin" type="password" inputmode="numeric"
                 autocomplete="off" maxlength="12" disabled={ablage.loading} aria-describedby={ablage.error ? 'ablage-error' : undefined} />
          <button class="pressable" type="submit" disabled={!pin || ablage.loading}>{ablage.loading ? 'Prüfe …' : 'Entsperren'}</button>
        </form>
      {/if}
      {#if ablage.error}<p id="ablage-error" class="ablage-error" role="alert">{ablage.error}</p>{/if}
    </section>
  {:else}
    <h1 bind:this={titleAnchor} id="ablage-title" class="phone-visually-hidden" tabindex="-1">Ablage</h1>
    <div inert={dateDialogOpen || openDocument !== null} aria-hidden={dateDialogOpen || openDocument !== null}>
      <div class="ablage-toolbar">
        <label class="ablage-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
          <span class="phone-visually-hidden">Dokumente durchsuchen</span>
          <input bind:this={searchInput} bind:value={query} type="search" autocomplete="off" enterkeyhint="search"
                 placeholder="Dokumente durchsuchen" oninput={queueSearch} />
        </label>
        <div class="ablage-date-filters" aria-label="Zeitraum einschränken">
          <button class:is-active={dateFilter === 'month'} class="pressable" type="button" onclick={() => applyPreset('month', 1)}>Letzter Monat</button>
          <button class:is-active={dateFilter === 'six-months'} class="pressable" type="button" onclick={() => applyPreset('six-months', 6)}>Letzte 6 Monate</button>
          <button class:is-active={dateFilter === 'custom'} class="pressable ablage-custom-filter" type="button" onclick={openDateDialog}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14a1 1 0 0 1 1 1V20H4V5.5a1 1 0 0 1 1-1ZM8 2v5m8-5v5M4 9h16" /></svg>
            Wählen
          </button>
        </div>
        <button class="ablage-lock pressable" type="button" onclick={() => void enterAblage()}>Sperren</button>
      </div>

      <section class="ablage-import" aria-labelledby="ablage-import-title">
        <div>
          <h2 id="ablage-import-title">Dateien importieren</h2>
          <p>Unterstützt: PDF; JPG/JPEG, PNG, TIFF, WebP, HEIC, BMP, GIF; TXT, TEXT, CSV und SRT. Maximal 50 MiB pro Datei.</p>
        </div>
        <input bind:this={fileInput} hidden type="file" accept={ABLAGE_ACCEPT} multiple onchange={importFiles} />
        <button class="ablage-import-button pressable" type="button" disabled={ablage.importing} onclick={() => fileInput?.click()}>
          {ablage.importing ? `${ablage.importCompleted} von ${ablage.importTotal} …` : 'Dateien auswählen'}
        </button>
      </section>
      {#if ablage.importMessage}<p class="ablage-import-status" role="status">{ablage.importMessage}</p>{/if}

      {#if ablage.processing.length}
        {@const names = ablage.processing.map((task) => task.fileName).filter(Boolean).slice(0, 3)}
        <section class="ablage-processing" role="status" aria-live="polite">
          <span class="ablage-processing-dot" aria-hidden="true"></span>
          <div>
            <strong>Paperless verarbeitet gerade {ablage.processing.length} {ablage.processing.length === 1 ? 'Dokument' : 'Dokumente'}.</strong>
            {#if names.length}<p>{names.join(' · ')}{ablage.processing.length > names.length ? ' · …' : ''}</p>{/if}
          </div>
        </section>
      {:else if ablage.processingError}
        <p class="ablage-processing-error" role="status">Der Paperless-Verarbeitungsstatus ist gerade nicht verfügbar.</p>
      {/if}

      {#if ablage.error}<p class="ablage-error" role="alert">{ablage.error}</p>{/if}
      {#if ablage.loading}
        <p class="ablage-status" role="status">Dokumente werden geladen …</p>
      {:else if ablage.documents.length}
        <p class="ablage-status">{ablage.count} {ablage.count === 1 ? 'Dokument' : 'Dokumente'}</p>
        <section class="ablage-grid" aria-label="Dokumente">
          {#each ablage.documents as document (document.id)}
            <article class="ablage-document">
              <button class="ablage-thumb" type="button" onclick={() => showDocument(document)} aria-label={`${document.title} öffnen`}>
                <img src={`/api/ablage/documents/${document.id}/thumb`} alt="" loading="lazy" />
              </button>
              <div class="ablage-document-body">
                <h2>{document.title}</h2>
                <p>{formatDate(document.created)}{document.archiveSerialNumber !== null ? ` · ASN ${document.archiveSerialNumber}` : ''}</p>
                <div class="ablage-actions">
                  <button class="pressable" type="button" onclick={() => showDocument(document)}>Öffnen</button>
                  <a href={`/api/ablage/documents/${document.id}/download`} download>Download</a>
                </div>
              </div>
            </article>
          {/each}
        </section>
        <nav class="ablage-pagination" aria-label="Ergebnisseiten">
          <button class="pressable" type="button" disabled={!ablage.previous} onclick={() => void searchAblage(query, ablage.page - 1, dateRange)}>Zurück</button>
          <span>Seite {ablage.page}</span>
          <button class="pressable" type="button" disabled={!ablage.next} onclick={() => void searchAblage(query, ablage.page + 1, dateRange)}>Weiter</button>
        </nav>
      {:else}
        <p class="ablage-empty">{query.trim() ? `Keine Dokumente für „${query.trim()}“ gefunden.` : dateRange ? 'Keine Dokumente im gewählten Zeitraum.' : 'Noch keine Dokumente vorhanden.'}</p>
      {/if}
    </div>
  {/if}

  {#if openDocument}
    <div class="ablage-viewer" role="dialog" aria-modal="true" aria-labelledby="ablage-viewer-title">
      <header>
        <button class="ablage-viewer-back pressable" type="button" onclick={closeDocument}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Zurück zur Ablage
        </button>
        <h2 id="ablage-viewer-title">{openDocument.title}</h2>
        <a class="ablage-viewer-download" href={`/api/ablage/documents/${openDocument.id}/download`} download>Download</a>
      </header>
      <iframe src={`/api/ablage/documents/${openDocument.id}/preview`} title={`Vorschau: ${openDocument.title}`}></iframe>
    </div>
  {/if}

  {#if dateDialogOpen}
    <div class="ablage-date-layer">
      <button class="ablage-date-scrim" type="button" aria-label="Zeitraumauswahl schließen" onclick={closeDateDialog}></button>
      <div class="ablage-date-dialog" role="dialog" aria-modal="true" aria-labelledby="ablage-date-title">
        <header>
          <div>
            <p class="ablage-eyebrow">Benutzerdefinierter Filter</p>
            <h2 id="ablage-date-title">Zeitraum wählen</h2>
          </div>
          <button class="ablage-date-close pressable" type="button" aria-label="Schließen" onclick={closeDateDialog}>×</button>
        </header>
        <form onsubmit={applyCustomRange}>
          <div class="ablage-date-fields">
            <label>
              <span>Von</span>
              <input bind:this={fromInput} bind:value={draftFrom} type="date" max={draftTo || today} required />
            </label>
            <span class="ablage-date-arrow" aria-hidden="true">→</span>
            <label>
              <span>Bis</span>
              <input bind:value={draftTo} type="date" min={draftFrom || undefined} max={today} required />
            </label>
          </div>
          {#if dateError}<p class="ablage-error" role="alert">{dateError}</p>{/if}
          <footer>
            <button class="ablage-clear-filter pressable" type="button" onclick={clearDateRange}>Zeitraum löschen</button>
            <button class="ablage-apply-filter pressable" type="submit">Übernehmen</button>
          </footer>
        </form>
      </div>
    </div>
  {/if}
</main>
