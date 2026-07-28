<script lang="ts">
  import '../../styles/settings.css';
  import { tick, type Component } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  import {
    settingsSidebar,
    searchSettings,
    settingsSection,
    type SettingsSectionId,
  } from '../state/settings-registry.ts';
  import {
    settingsUi,
    openSection,
    openSetting,
  } from '../state/settings.svelte.ts';

  import ServicesSection from '../components/settings/ServicesSection.svelte';
  import OperatingModeSection from '../components/settings/OperatingModeSection.svelte';
  import AiAccessSection from '../components/settings/AiAccessSection.svelte';
  import AiFeaturesSection from '../components/settings/AiFeaturesSection.svelte';
  import AppearanceSection from '../components/settings/AppearanceSection.svelte';
  import HomeLayoutSection from '../components/settings/HomeLayoutSection.svelte';
  import AmbientSection from '../components/settings/AmbientSection.svelte';
  import CalendarSection from '../components/settings/CalendarSection.svelte';
  import ShoppingSection from '../components/settings/ShoppingSection.svelte';
  import StatusSection from '../components/settings/StatusSection.svelte';
  import UpdatesSection from '../components/settings/UpdatesSection.svelte';
  import MaintenanceSection from '../components/settings/MaintenanceSection.svelte';

  let { phone = false, titleAnchor = $bindable() }: { phone?: boolean; titleAnchor?: HTMLHeadingElement } = $props();
  let phoneSectionOpen = $state(false);
  let paneEl = $state<HTMLElement>();

  const section = $derived(settingsSection(settingsUi.section));
  const results = $derived(searchSettings(settingsUi.query));
  const sidebar = $derived(settingsSidebar());

  /* Sektions-Id → Komponente. Die Registry bestimmt Reihenfolge und
     Gruppierung, diese Tabelle nur, was im Detailbereich gerendert wird.
     Der Record-Typ erzwingt, dass jede Sektion der Registry eine Ansicht hat
     — eine neue Sektion ohne Komponente fällt beim Typecheck auf. */
  const SECTION_VIEWS: Record<SettingsSectionId, Component> = {
    'services': ServicesSection,
    'operating-mode': OperatingModeSection,
    'ai-access': AiAccessSection,
    'ai-features': AiFeaturesSection,
    'appearance': AppearanceSection,
    'home-layout': HomeLayoutSection,
    'ambient': AmbientSection,
    'calendar': CalendarSection,
    'shopping': ShoppingSection,
    'status': StatusSection,
    'updates': UpdatesSection,
    'maintenance': MaintenanceSection,
  } as const;

  const SectionView = $derived(SECTION_VIEWS[settingsUi.section]);

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
    <h1 class="settings-title" bind:this={titleAnchor} tabindex="-1">System</h1>

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
          <p class="settings-no-results">Keine Einstellung gefunden für „{settingsUi.query.trim()}"</p>
        {/each}
      </nav>
    {:else}
      <nav class="settings-nav" aria-label={m.sys_sections()}>
        {#each sidebar as { group, sections } (group.id)}
          <section class="settings-nav-section" aria-labelledby="settings-nav-{group.id}">
            <h2 id="settings-nav-{group.id}" class="caps-label settings-nav-group">{group.label}</h2>
            <div class="settings-nav-card">
              {#each sections as s (s.id)}
                <button class="settings-nav-btn pressable" type="button"
                        class:is-active={settingsUi.section === s.id}
                        aria-current={settingsUi.section === s.id ? 'true' : undefined}
                        onclick={() => selectSection(s.id)}>
                  <span class="settings-icon-tile tint-{s.tint}"><Icon name={s.icon} cls="icon icon-md" /></span>
                  <span class="settings-nav-label">{s.label}</span>
                  {#if s.id === 'updates' && appState.system.updates.length}
                    <span class="settings-badge num">{appState.system.updates.length}</span>
                  {/if}
                  <Icon name="i-chevron-right" cls="icon icon-sm settings-nav-chev" />
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </nav>
    {/if}
  </aside>

  <section class="settings-pane" class:is-phone-hidden={phone && !phoneSectionOpen} bind:this={paneEl} aria-live="polite">
    <div class="settings-pane-content">
      <header class="settings-pane-head">
        {#if phone}
          <button class="settings-phone-back pressable" type="button" aria-label="Zurück zu System" onclick={() => (phoneSectionOpen = false)}>
            <Icon name="i-back" cls="icon icon-md" />
          </button>
        {/if}
        <span class="settings-icon-tile is-lg tint-{section.tint}"><Icon name={section.icon} cls="icon icon-lg" /></span>
        <div>
          <h2>{section.label}</h2>
          <p>{section.description}</p>
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
