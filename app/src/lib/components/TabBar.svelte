<script lang="ts">
  import Icon from './Icon.svelte';
  import { slide } from 'svelte/transition';
  import { tokenDuration } from '../motion/index.ts';
  import { TABS, activeTab, showScreen, type ScreenId } from '../state/nav.svelte.ts';
  import { closeDeviceDetail } from '../state/overlay.svelte.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { editMode, noteBlockedConfigAttempt } from '../state/edit-mode.svelte.ts';
  import { moduleVisible } from '../state/module-config.svelte.ts';
  import ClimatePill from './ClimatePill.svelte';
  import { centralClimate } from '../state/climate-central.svelte.ts';
  import { appState } from '../state/app.svelte.ts';
  import { deviceManager } from '../state/device-manager.svelte.ts';
  import { roomContacts, roomOpenings, type RoomContact } from '../state/commands.ts';
  import { fmtTemp } from '../format.ts';
  import { familyCalendar } from '../state/calendar.svelte.ts';
  import { notifications } from '../state/notifications.svelte.ts';
  import { IS_DEMO } from '../demo/recording-mode.ts';
  import { m } from '../../paraglide/messages.js';
  import { localeState } from '../state/locale.svelte.ts';
  import { openingsLabel } from '../state/open-label.ts';
  import { tabGlider } from '../actions/tab-glider.ts';
  import { observeResize } from '../actions/observe-resize.ts';

  let tabletReady = $state(false);
  let tabletPanel = $state('');
  let tabletUnread = $state(0);
  $effect(() => {
    tabletReady = document.documentElement.dataset.tabletShell === 'hauser';
    const ready = () => { tabletReady = true; };
    const panel = (event: Event) => { tabletPanel = (event as CustomEvent<string>).detail; };
    const badge = (event: Event) => { tabletUnread = (event as CustomEvent<number>).detail; };
    window.addEventListener('hauser:tablet-ready', ready);
    window.addEventListener('hauser:tablet-panel', panel);
    window.addEventListener('hauser:tablet-badge', badge);
    return () => { window.removeEventListener('hauser:tablet-ready', ready); window.removeEventListener('hauser:tablet-panel', panel); window.removeEventListener('hauser:tablet-badge', badge); };
  });
  const notificationCount = $derived(tabletReady ? tabletUnread : notifications.items.length);
  const selectedTab = $derived(tabletPanel === 'store' || tabletPanel === 'apps' ? 'apps' : activeTab());
  function openNotifications() { detailOpen = false; window.dispatchEvent(new Event('hauser:notifications')); }

  const visibleTabs = $derived(TABS.filter((tab) => {
    if (tab.id === 'system' && !editMode.active) return false;
    // Ablage bleibt aus der öffentlichen Demo heraus (docs/12).
    if (tab.id === 'ablage' && IS_DEMO) return false;
    // Abgeschaltete Module verschwinden sofort, nicht erst beim Neustart.
    if (!moduleVisible(tab.id)) return false;
    return tab.id !== 'calendar' || familyCalendar.sources.length > 0;
  }));

  const tabletTabs = [{ id: 'apps', label: 'Apps', icon: 'i-apps' }];
  const navigationTabs = $derived(!tabletReady ? visibleTabs : visibleTabs.some(tab => tab.id === 'system')
    ? visibleTabs.flatMap(tab => tab.id === 'system' ? [...tabletTabs, tab] : [tab]) : [...visibleTabs, ...tabletTabs]);
  /* Sicherheitsstatus (docs/06 §5): jede Zeile ist ein realer Sensor. Ohne
     zugeordnete Kontakte gilt weiter der Seed-Wert des Raums (Demo). */
  interface ContactRow extends RoomContact {
    roomId: string;
    roomName: string;
    kind: 'window' | 'presence';
    name: string;
  }

  const catalogNames = $derived(new Map(deviceManager.catalog.map((item) => [item.entityId, item.name])));

  function catalogName(entityId: string): string {
    return catalogNames.get(entityId) ?? entityId;
  }

  const contactRows = $derived<ContactRow[]>(appState.rooms.flatMap((room) =>
    (['window', 'presence'] as const).flatMap((kind) =>
      roomContacts(room.id, kind).map((contact) => ({
        ...contact, kind, roomId: room.id, roomName: room.name, name: catalogName(contact.entityId),
      })))));

  /* Fenster und Türen getrennt: dieselben Kontakte, nach device_class sortiert. */
  const openRooms = $derived(appState.rooms
    .map((room) => ({ room, ...roomOpenings(room.id, room.windowOpen) }))
    .filter((row) => row.window || row.door));

  let detailOpen = $state(false);
  /* Nichts zugeordnet heißt nichts zu zeigen — dann bleibt die Leiste stumm
     statt eine leere Liste anzubieten. */
  const hasDetail = $derived(contactRows.length > 0);

  /* „Alles ruhig" ist eine Aussage über das ganze Haus (Paket 3, docs/20).
     Solange eine Meldung auf dem Schirm steht, ist eben nicht alles ruhig —
     dann sagt die Leiste nur, was sie wirklich weiß: die Fenster sind zu. */
  const quietLabel = $derived(
    notifications.items.length === 0 ? m.status_all_quiet() : m.status_windows_closed(),
  );

  const securityLabel = $derived(
    openRooms.length === 0
      ? quietLabel
      : openingsLabel(openRooms.filter((row) => row.window).length, openRooms.filter((row) => row.door).length),
  );

  const securityTitle = $derived(
    openRooms.length ? openRooms.map((row) => row.room.name).join(', ') : quietLabel,
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
  let climateFits = $state(false);

  $effect(() => {
    void centralClimate.hasClimate;
    const edge = navEl?.parentElement?.querySelector<HTMLElement>('.tab-edge-start');
    const dock = edge?.querySelector<HTMLElement>('.climate-dock');
    if (!edge || !dock) return;
    const measure = () => { climateFits = dock.offsetWidth <= edge.clientWidth; };
    return observeResize(measure, edge, dock);
  });

  $effect(() => {
    void selectedTab;
    void navigationTabs;
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
    if (tabletPanel) window.dispatchEvent(new Event('hauser:tablet-dismiss'));
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
  <div class="tab-edge tab-edge-start" class:climate-fits={climateFits}>
    {#if centralClimate.hasClimate}
      <ClimatePill label={m.status_climate_central()}
                   coolerLabel={m.status_all_rooms_cooler()}
                   warmerLabel={m.status_all_rooms_warmer()}
                   online={connection().online} />
    {/if}
  </div>

  <div class="tab-nav" data-tablet-navigation="shared" bind:this={navEl}
       class:has-glider={glider !== null}
       style:--glider-x={glider ? `${glider.x}px` : '0px'}
       style:--glider-w={glider ? `${glider.w}px` : '0px'}>
    {#if glider}<span class="tab-glider" use:tabGlider={glider} aria-hidden="true"></span>{/if}
    {#each navigationTabs as tab (tab.id)}
      <div class="tab-slot" transition:slide={{ axis: 'x', duration: tab.id === 'system' ? tokenDuration(navEl, 'enter') : 0 }}
           inert={tab.id === 'system' && !editMode.active} aria-hidden={tab.id === 'system' && !editMode.active ? true : undefined}>
      <button class="tab pressable" class:is-active={selectedTab === tab.id}
              type="button" data-nav={tab.id} aria-label={tab.label}
              onclick={() => { if (tab.id === 'apps') location.href = `hauser-tablet://open/${tab.id}`; else go(tab.id); }}>
        <Icon name={tab.icon} cls="icon tab-icon" /><span class="tab-label">{tab.label}</span>
      </button>
      </div>
    {/each}
  </div>

  <div class="tab-edge tab-edge-end">
    {#if detailOpen}
      <!-- Detail-Liste (docs/06 §5): eine Zeile je Sensor, 48px Touch-Höhe. -->
      <div class="security-detail" role="dialog" aria-label={m.status_security_title()}>
        <button class="secondary-btn pressable" type="button" onclick={openNotifications}><Icon name="i-bell" cls="icon icon-md" />{m.settings_section_notifications_label()}{notificationCount ? ` · ${notificationCount}` : ''}</button>
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
      <button class="security-bar pressable" type="button"
              class:has-warning={openRooms.length > 0} class:is-active={detailOpen}
              aria-expanded={detailOpen} aria-label={`${m.status_security_title()} · ${m.settings_section_notifications_label()}${notificationCount ? ` · ${notificationCount}` : ''}`}
              onclick={() => { if (hasDetail) detailOpen = !detailOpen; else openNotifications(); }}
              title={securityTitle}>
        <Icon name={openRooms.length ? 'i-window' : 'i-shield'} cls="icon icon-md" />
        <span>{securityLabel}</span>
        <Icon name="i-bell" cls="icon icon-md" />{#if notificationCount}<span>{notificationCount}</span>{/if}
      </button>
  </div>
</nav>
