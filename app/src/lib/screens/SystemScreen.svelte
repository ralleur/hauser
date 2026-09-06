<script lang="ts">
  import '../../styles/settings.css';
  import { onMount, tick, type Component } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { hauserUpdates, systemStatus, refreshSystemStatus } from '../state/system-status.svelte.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { logoTap } from '../state/hidden-gestures.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  import {
    settingsSidebar,
    searchSettings,
    settingsSection,
    type SettingsSectionId,
  } from '../state/settings-registry.ts';
  import {
    settingsUi,
    enterSettings,
    leaveSettings,
    openSection,
    openSetting,
  } from '../state/settings.svelte.ts';

  import RoomsDevicesSection from '../components/settings/RoomsDevicesSection.svelte';
  import SecuritySensorsSection from '../components/settings/SecuritySensorsSection.svelte';
  import NotificationsSection from '../components/settings/NotificationsSection.svelte';
  import HotelModeSection from '../components/settings/HotelModeSection.svelte';
  import HotelAllowlistSection from '../components/settings/HotelAllowlistSection.svelte';
  import ServicesSection from '../components/settings/ServicesSection.svelte';
  import InterfaceSection from '../components/settings/InterfaceSection.svelte';
  import AmbientSection from '../components/settings/AmbientSection.svelte';
  import CalendarSection from '../components/settings/CalendarSection.svelte';
  import ShoppingSection from '../components/settings/ShoppingSection.svelte';
  import MediaSection from '../components/settings/MediaSection.svelte';
  import StatusSection from '../components/settings/StatusSection.svelte';
  import { pairingUi } from '../state/pairing.svelte.ts';
  import AiCustomizingSection from '../components/settings/AiCustomizingSection.svelte';
  import MaintenanceSection from '../components/settings/MaintenanceSection.svelte';

  let { phone = false, titleAnchor = $bindable() }: { phone?: boolean; titleAnchor?: HTMLHeadingElement } = $props();
  let phoneSectionOpen = $state(false);
  let paneEl = $state<HTMLElement>();

  const section = $derived(settingsSection(settingsUi.section));
  const results = $derived(searchSettings(settingsUi.query));
  const sidebar = $derived(settingsSidebar());
  const ownUpdates = $derived(hauserUpdates(systemStatus.updates));

  onMount(() => {
    enterSettings();
    return () => leaveSettings();
  });

  $effect(() => {
    if (connection().status === 'connected') void refreshSystemStatus();
  });

  /* Sektions-Id → Komponente. Die Registry bestimmt Reihenfolge und
     Gruppierung, diese Tabelle nur, was im Detailbereich gerendert wird.
     Der Record-Typ erzwingt, dass jede Sektion der Registry eine Ansicht hat
     — eine neue Sektion ohne Komponente fällt beim Typecheck auf. */
  const SECTION_VIEWS: Record<SettingsSectionId, Component> = {
    'rooms-devices': RoomsDevicesSection,
    'security-sensors': SecuritySensorsSection,
    'notifications': NotificationsSection,
    'hotel-mode': HotelModeSection,
    'hotel-guest-access': HotelAllowlistSection,
    'appearance': InterfaceSection,
    'ambient': AmbientSection,
    'calendar': CalendarSection,
    'shopping': ShoppingSection,
    'media': MediaSection,
    'services': ServicesSection,
    'status': StatusSection,
    'ai-customizing': AiCustomizingSection,
    'maintenance': MaintenanceSection,
  } as const;

  const SectionView = $derived(SECTION_VIEWS[settingsUi.section]);

  function openPairing(): void {
    pairingUi.autoStart = true;
    openSection('services');
  }

  function selectSection(id: Parameters<typeof openSection>[0]): void {
    openSection(id);
    if (phone) phoneSectionOpen = true;
  }

  function selectSetting(id: Parameters<typeof openSetting>[0]): void {
    openSetting(id);
    if (phone) phoneSectionOpen = true;
  }

  /* Sprung aus der Suche: Ziel-Zeile zentrieren und kurz aufblitzen lassen */
  $effect(() => {
    void settingsUi.highlightSeq;
    const id = settingsUi.highlight;
    if (!id) return;
    void tick().then(() => {
      const el = paneEl?.querySelector(`[data-setting-id="${id}"]`);
      if (!(el instanceof HTMLElement)) return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('is-highlighted');
      void el.offsetWidth; // Reflow → Flash-Animation startet erneut
      el.classList.add('is-highlighted');
    });
  });
</script>

<!-- ── System als Einstellungs-Screen (macOS-Systemeinstellungen-Muster):
     Sidebar mit Suche und nach Gruppen überschriebenen Sektionen links,
     Detailbereich rechts. Die Gruppe ist reine Gliederung — navigiert wird
     immer auf Sektionsebene, also ein Klick pro Ziel. ── -->
<div class="settings" class:is-phone={phone} data-testid="settings">
  <aside class="settings-sidebar" class:is-phone-hidden={phone && phoneSectionOpen} aria-label="Einstellungs-Bereiche">
    <!-- Hauser-Lockup statt Text-Überschrift: Signet folgt via currentColor dem
         Theme (dark: hell, light: dunkel), der Lichtpunkt bleibt gold. -->
    <div class="settings-brand-row">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions — versteckte
         Geste (Paket 10): dreimal tippen öffnet die Diagnoseansicht. Kein
         Bedienelement, kein Menüeintrag; dokumentiert in docs/06. -->
    <h1 class="settings-title settings-brand" bind:this={titleAnchor} tabindex="-1" aria-label="Hauser — System"
        onpointerdown={logoTap}>
      <svg class="settings-brand-mark" viewBox="0 0 512 512" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="64" stroke-linecap="round">
          <path d="M168 96 V416" />
          <path d="M168 300 C168 222 344 222 344 300 V416" />
        </g>
        <circle cx="344" cy="140" r="44" fill="var(--color-accent-warm)" />
      </svg>
      <span class="settings-brand-word">hauser</span>
    </h1>
    <!-- Companion-App (Plan 21): der QR-Knopf rechts neben dem Lockup springt
         zu Dienste und startet die Kopplung sofort. -->
    <button type="button" class="settings-brand-pair pressable" aria-label={m.sys_app_pairing_open()}
            title={m.sys_app_pairing_open()} onclick={openPairing}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm10-2h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm-2-2h2v2h-2v-2zm-2 4h2v2h-2v-2zm4 0h2v2h-2v-2z" />
      </svg>
    </button>
    </div>

    <div class="settings-search">
      <Icon name="i-magnify" cls="icon icon-sm" />
      <input type="search" placeholder={m.sys_search_settings()}
             aria-label={m.sys_search_settings()} autocomplete="off"
             bind:value={settingsUi.query}
             onkeydown={(e) => { if (e.key === 'Escape') settingsUi.query = ''; }} />
      {#if settingsUi.query}
        <button class="settings-search-clear pressable" type="button" aria-label={m.sys_search_clear()}
                onclick={() => (settingsUi.query = '')}>
          <Icon name="i-close" cls="icon icon-sm" />
        </button>
      {/if}
    </div>

    {#if settingsUi.query.trim()}
      <nav class="settings-results" aria-label={m.sys_search_results()}>
        {#each results as r (r.entry.id)}
          <button class="settings-result pressable" type="button" onclick={() => selectSetting(r.entry.id)}>
            <span class="settings-icon-tile tint-{r.section.tint}"><Icon name={r.section.icon} cls="icon icon-md" /></span>
            <span class="settings-result-text">
              <span class="settings-result-label">{r.entry.label}</span>
              <span class="settings-result-section">{r.section.label}</span>
            </span>
          </button>
        {:else}
          <p class="settings-no-results">{m.settings_no_results({ query: settingsUi.query.trim() })}</p>
        {/each}
      </nav>
    {:else}
      <nav class="settings-nav" aria-label={m.sys_sections()}>
        <div class="settings-nav-card">
          {#each sidebar as { group, sections } (group.id)}
            <section class="settings-nav-section" aria-labelledby="settings-nav-{group.id}">
              <h2 id="settings-nav-{group.id}" class="caps-label settings-nav-group">{group.label}</h2>
              {#each sections as s (s.id)}
                <button class="settings-nav-btn pressable" type="button"
                        class:is-active={settingsUi.section === s.id}
                        aria-current={settingsUi.section === s.id ? 'true' : undefined}
                        onclick={() => selectSection(s.id)}>
                  <span class="settings-icon-tile tint-{s.tint}"><Icon name={s.icon} cls="icon icon-md" /></span>
                  <span class="settings-nav-label">{s.label}</span>
                  {#if s.id === 'status' && ownUpdates.length}
                    <span class="settings-badge num">{ownUpdates.length}</span>
                  {/if}
                  <Icon name="i-chevron-right" cls="icon icon-sm settings-nav-chev" />
                </button>
              {/each}
            </section>
          {/each}
        </div>
      </nav>
    {/if}
  </aside>

  <section class="settings-pane" class:is-phone-hidden={phone && !phoneSectionOpen} bind:this={paneEl} aria-live="polite">
    <div class="settings-pane-content">
      <header class="settings-pane-head">
        {#if phone}
          <button class="settings-phone-back pressable" type="button" aria-label={m.settings_back_to_system()} onclick={() => (phoneSectionOpen = false)}>
            <Icon name="i-back" cls="icon icon-md" />
          </button>
        {/if}
        <!-- Sektions-Kachel im Kopf: dieselbe Farbe wie in der Sidebar, damit
             der Detailbereich sichtbar zur angetippten Zeile gehört. Auf dem
             Phone entfällt sie (die Überschrift trägt dort allein). -->
        <span class="settings-icon-tile is-lg tint-{section.tint}"><Icon name={section.icon} cls="icon icon-lg" /></span>
        <div>
          <h2>{section.label}</h2>
          {#if section.description !== section.label}<p>{section.description}</p>{/if}
        </div>
      </header>

      {#if settingsUi.needsReload}
        <div class="settings-reload" role="status">
          <Icon name="i-refresh" cls="icon icon-md" />
          <span class="settings-reload-text">{m.sys_reload_hint()}</span>
          <button class="secondary-btn pressable" type="button" onclick={() => location.reload()}>{m.sys_reload_now()}</button>
        </div>
      {/if}

      <SectionView />
    </div>
  </section>
</div>
