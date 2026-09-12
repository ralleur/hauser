<script lang="ts">
  import Icon from './Icon.svelte';
  import { TABS, activeTab, showScreen, type ScreenId } from '../state/nav.svelte.ts';
  import { closeDeviceDetail } from '../state/overlay.svelte.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { editMode, noteBlockedConfigAttempt } from '../state/edit-mode.svelte.ts';
  import { moduleVisible } from '../state/module-config.svelte.ts';
  import ClimatePill from './ClimatePill.svelte';
  import { centralClimate } from '../state/climate-central.svelte.ts';
  import { appState } from '../state/app.svelte.ts';
  import { deviceManager } from '../state/device-manager.svelte.ts';
  import { roomContacts, type RoomContact } from '../state/commands.ts';
  import { fmtTemp } from '../format.ts';
  import { familyCalendar } from '../state/calendar.svelte.ts';
  import { notifications } from '../state/notifications.svelte.ts';
  import { IS_DEMO } from '../demo/demo-mode.ts';
  import { m } from '../../paraglide/messages.js';
  import { localeState, pluralCategory } from '../state/locale.svelte.ts';

  const visibleTabs = $derived(TABS.filter((tab) => {
    // Ablage bleibt aus der öffentlichen Demo heraus (docs/12).
    if (tab.id === 'ablage' && IS_DEMO) return false;
    // Abgeschaltete Module verschwinden sofort, nicht erst beim Neustart.
    if (!moduleVisible(tab.id)) return false;
    return tab.id !== 'calendar' || familyCalendar.sources.length > 0;
  }));

  /* Sicherheitsstatus (docs/06 §5): jede Zeile ist ein realer Sensor. Ohne
     zugeordnete Kontakte gilt weiter der Seed-Wert des Raums (Demo). */
  interface ContactRow extends RoomContact {
    roomId: string;
    roomName: string;
    kind: 'window' | 'presence';
    name: string;
  }

  function catalogName(entityId: string): string {
    return deviceManager.catalog.find((item) => item.entityId === entityId)?.name ?? entityId;
  }

  const contactRows = $derived<ContactRow[]>(appState.rooms.flatMap((room) =>
    (['window', 'presence'] as const).flatMap((kind) =>
      roomContacts(room.id, kind).map((contact) => ({
        ...contact, kind, roomId: room.id, roomName: room.name, name: catalogName(contact.entityId),
      })))));

  const openWindows = $derived(appState.rooms.filter((room) => {
    const contacts = contactRows.filter((row) => row.roomId === room.id && row.kind === 'window');
    return contacts.length === 0 ? room.windowOpen : contacts.some((row) => row.open);
  }));

  let detailOpen = $state(false);
  /* Nichts zugeordnet heißt nichts zu zeigen — dann bleibt die Leiste stumm
     statt eine leere Liste anzubieten. */
  const hasDetail = $derived(contactRows.length > 0);

  /* Plusamorm je Sprache: Deutsch hat zwei, Polnisch vier. */
  const WINDOWS_OPEN = {
    one: m.status_window_open_one, two: m.status_window_open_two,
    few: m.status_window_open_few, many: m.status_window_open_many,
    other: m.status_window_open_other,
  };

  function windowsOpenLabel(count: number): string {
    return WINDOWS_OPEN[pluralCategory(count)]({ count });
  }
  /* „Alles ruhig" ist eine Aussage über das ganze Haus (Paket 3, docs/20).
     Solange eine Meldung auf dem Schirm steht, ist eben nicht alles ruhig —
     dann sagt die Leiste nur, was sie wirklich weiß: die Fenster sind zu. */
  const quietLabel = $derived(
    notifications.items.length === 0 ? m.status_all_quiet() : m.status_windows_closed(),
  );

  const securityLabel = $derived(
    openWindows.length === 0
      ? quietLabel
      : windowsOpenLabel(openWindows.length),
  );

  const securityTitle = $derived(
    openWindows.length ? openWindows.map((room) => room.name).join(', ') : quietLabel,
  );

  /* ── Gleiter (Owner-Idee 2026-09-12): statt eines Unterstrichs je Tab
     fährt eine Pille hinter dem aktiven Tab her. Sie wird gemessen, nicht
     geraten: Position und Breite des aktiven Knopfs relativ zur Leiste,
     neu bei Tabwechsel, Sichtbarkeit der Tabs und Fenstergröße. Vor der
     ersten Messung gibt es keinen Gleiter — so gleitet er nie aus dem
     Nichts herein. */
  let navEl = $state<HTMLElement | null>(null);
  let glider = $state<{ x: number; w: number } | null>(null);
  let viewportTick = $state(0);

  $effect(() => {
    void activeTab();
    void visibleTabs;
    void viewportTick;
    void localeState.current;
    const nav = navEl;
    if (!nav) return;
    const measure = () => {
      const el = nav.querySelector<HTMLElement>('.tab.is-active');
      if (!el) { glider = null; return; }
      glider = { x: el.offsetLeft, w: el.offsetWidth };
    };
    /* Nach dem DOM-Update messen, damit die neue is-active-Klasse steht. */
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  });

  function go(target: string) {
    // Der System-Bereich ist Konfiguration: im Bedienen-Modus führt der Tap
    // nicht dorthin, sondern erklärt sofort den Weg über den Knopf oben — und
    // lässt den aufrufenden Screen unangetastet.
    if (target === 'system' && !editMode.active) {
      noteBlockedConfigAttempt(true);
      return;
    }
    detailOpen = false;       // die Sensor-Liste gehört zum aufrufenden Screen
    closeDeviceDetail(true);  // Detail gehört zum aufrufenden Tab

    showScreen(target as ScreenId);
  }
</script>

<!-- ── Tab-Bar (persistent, Hauser-Rahmen-Bar unten; IA: docs/07) ──
     Links das globale Klima-Dock (zentrale Synchron-Steuerung, aus jedem Screen
     erreichbar — wie das Fahrzeug-UI), mittig die Navigation, rechts der globale
     Sicherheitsstatus. Gleiche Rand-Zonen halten die Tabs zentriert. -->
<svelte:window onresize={() => (viewportTick += 1)} />

<nav class="tab-bar" aria-label={m.nav_main()}>
  <div class="tab-edge tab-edge-start">
    {#if centralClimate.hasClimate}
      <ClimatePill label={m.status_climate_central()}
                   coolerLabel={m.status_all_rooms_cooler()}
                   warmerLabel={m.status_all_rooms_warmer()}
                   online={connection().online} />
    {/if}
  </div>

  <div class="tab-nav" bind:this={navEl}
       class:has-glider={glider !== null}
       style:--glider-x={glider ? `${glider.x}px` : '0px'}
       style:--glider-w={glider ? `${glider.w}px` : '0px'}>
    {#if glider}<span class="tab-glider" aria-hidden="true"></span>{/if}
    {#each visibleTabs as tab (tab.id)}
      <button class="tab pressable" class:is-active={activeTab() === tab.id}
              class:is-locked={tab.id === 'system' && !editMode.active}
              type="button" data-nav={tab.id} aria-label={tab.label}
              onclick={() => go(tab.id)}>
        <Icon name={tab.icon} cls="icon tab-icon" /><span class="tab-label">{tab.label}</span>
      </button>
    {/each}
  </div>

  <div class="tab-edge tab-edge-end">
    {#if detailOpen}
      <!-- Detail-Liste (docs/06 §5): eine Zeile je Sensor, 48px Touch-Höhe. -->
      <div class="security-detail" role="dialog" aria-label={m.status_security_title()}>
        <ul class="security-list">
          {#each contactRows as row (row.entityId)}
            <li class="security-row">
              <span class="security-dot" class:is-open={row.open} class:is-unknown={!row.known}></span>
              <span class="security-row-label">
                <span class="security-row-name">{row.name}</span>
                <small class="security-row-room">{row.roomName}</small>
              </span>
              <span class="security-row-state">
                {#if !row.known}{m.status_contact_unknown()}
                {:else if row.kind === 'presence'}{row.open ? m.status_motion_detected() : m.status_motion_idle()}
                {:else}{row.open ? m.status_contact_open() : m.status_contact_closed()}{/if}
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if hasDetail}
      <button class="security-bar pressable" type="button"
              class:has-warning={openWindows.length > 0} class:is-active={detailOpen}
              aria-expanded={detailOpen} aria-label={m.status_security_title()}
              onclick={() => { detailOpen = !detailOpen; }}
              title={securityTitle}>
        <Icon name={openWindows.length ? 'i-window' : 'i-shield'} cls="icon icon-md" />
        <span>{securityLabel}</span>
      </button>
    {:else}
      <!-- Ohne zugeordnete Sensoren bleibt es reine Anzeige (docs/06 §5:
           `disabled` = nicht anwendbar) — ein Knopf ohne Ziel wäre gelogen. -->
      <div class="security-bar" class:has-warning={openWindows.length > 0} title={securityTitle}>
        <Icon name={openWindows.length ? 'i-window' : 'i-shield'} cls="icon icon-md" />
        <span>{securityLabel}</span>
      </div>
    {/if}
  </div>
</nav>
