<script module lang="ts">
  import type { SetupHouseholdSuggestion } from '../config/setup-household.ts';

  interface ReconfigureDraft {
    suggestion: SetupHouseholdSuggestion;
    householdEtag: string | null;
    sharedEtag: string | null;
    haUrl: string;
    token: string;
  }

  /* Überlebt einen Remount der eingebetteten Räume-&-Geräte-Sektion (Wechsel
     der System-Settings-Sektion, Verlassen von System): sonst verwirft jede
     Navigation weg von hier unbemerkt den unfertigen Entwurf (Umbenennen,
     Reihenfolge, Hinzufügen/Löschen), noch bevor „Änderungen speichern"
     gedrückt wurde — der Raum scheint dann seine Änderung verloren zu haben. */
  let reconfigureDraft: ReconfigureDraft | null = null;
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { discoverHomeAssistant } from '../config/setup-discovery.ts';
  import {
    JellyfinAuthError,
    JellyfinClient,
    JELLYFIN_URL_DEFAULT,
    jellyfin,
  } from '../adapter/jellyfin.ts';
  import { parseHouseholdConfig, type HouseholdConfigV4 } from '../config/household-config.ts';
  import type { SetupDiscoverySnapshot } from '../config/setup-household.ts';
  import { refreshHouseholdConfigRuntimeCache } from '../config/household-config-runtime.ts';
  import {
    addSetupRoom,
    buildSetupHouseholdSuggestion,
    canRemoveSetupRoom,
    canMoveSetupEntity,
    moveSetupEntity,
    moveSetupRoom,
    moveSetupRoomTo,
    omitSetupEntity,
    preserveSetupRoomHeroes,
    removeSetupRoom,
    renameSetupRoom,
  } from '../config/setup-household.ts';
  import {
    AVAILABLE_LOCALES,
    changeLocale,
    initLocale,
    localeLabel,
    localeState,
  } from '../state/locale.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import { openRoomEdit } from '../state/overlay.svelte.ts';
  import { setAmbientCityMap } from '../state/settings.svelte.ts';
  import RoomListEditor from './settings/RoomListEditor.svelte';
  import DeviceAddress from './DeviceAddress.svelte';
  import type { Snippet } from 'svelte';

  let {
    mode = 'first-run',
    embedded = false,
    after,
  }: {
    mode?: 'first-run' | 'reconfigure';
    embedded?: boolean;
    /* Eingebettet reicht die Sektion ihre eigenen Karten (Raumbilder,
       Zurücksetzen) hier hinein und bekommt dafür das Neu-Einlesen. */
    after?: Snippet<[{ rescan: () => void; busy: boolean }]>;
  } = $props();
  initLocale();
  const reconfigure = $derived(mode === 'reconfigure');
  let haUrl = $state('http://homeassistant.local:8123');
  let token = $state('');
  /* B-08E11: Im Home-Assistant-App-Modus verbindet der Hauser-Server intern.
     Dann gibt es weder HA-Adresse noch Long-Lived Access Token in dieser
     Oberfläche — bis die Auskunft da ist, wird nichts abgefragt. */
  let connectionMode = $state<'direct' | 'supervisor' | 'unknown'>('unknown');
  let supervisorAvailable = $state(true);
  const supervisor = $derived(connectionMode === 'supervisor');
  let status = $state<'idle' | 'loading' | 'connecting' | 'ready' | 'activating' | 'done' | 'error'>('idle');
  let draftRestored = $state(false);
  let message = $state('');
  let suggestion = $state<SetupHouseholdSuggestion | null>(null);
  let omittedCount = $state(0);
  let jellyfinEnabled = $state(false);
  /* Opt-out: standardmäßig an, weil Hauser den Ort ohnehin aus Home Assistant
     kennt und ohne Zutun etwas Schönes daraus macht. Sichtbar an dieser Stelle,
     mit Beispielbild und dem Hinweis, dass für die Straßendaten einmalig ein
     ungefährer Bereich an OpenStreetMap geht — die Entscheidung fällt damit
     informiert und vor dem ersten Abruf. */
  let cityMapEnabled = $state(true);
  let jellyfinUrl = $state(JELLYFIN_URL_DEFAULT);
  let jellyfinUsername = $state('');
  let jellyfinPassword = $state('');
  let jellyfinStatus = $state<'idle' | 'testing' | 'ready' | 'error'>('idle');
  let jellyfinMessage = $state('');
  let jellyfinSession = $state<{ accessToken: string; userId: string } | null>(null);
  let householdEtag = $state<string | null>(null);
  let sharedEtag = $state<string | null>(null);
  let expandedRoomId = $state<string | null>(null);
  let pendingDeleteRoomId = $state<string | null>(null);
  let deleteDestination = $state('');
  const pendingDeleteRoom = $derived(
    suggestion?.config.rooms.find(({ id }) => id === pendingDeleteRoomId) ?? null,
  );

  function invalidateJellyfinSession(): void {
    jellyfinSession = null;
    jellyfinStatus = 'idle';
    jellyfinMessage = '';
  }

  function toggleJellyfin(event: Event): void {
    jellyfinEnabled = (event.currentTarget as HTMLInputElement).checked;
    if (!jellyfinEnabled) {
      jellyfinUsername = '';
      jellyfinPassword = '';
      invalidateJellyfinSession();
    }
  }

  async function testJellyfin(): Promise<void> {
    if (!jellyfinUrl.trim() || !jellyfinUsername.trim() || !jellyfinPassword) {
      jellyfinStatus = 'error';
      jellyfinMessage = m.setup_jellyfin_required();
      return;
    }
    jellyfinStatus = 'testing';
    jellyfinMessage = '';
    jellyfinSession = null;
    try {
      const client = new JellyfinClient({
        baseUrl: jellyfinUrl.trim(),
        deviceId: jellyfin.deviceId,
        token: null,
        userId: null,
      });
      const session = await client.authenticateByName(
        jellyfinUsername.trim(),
        jellyfinPassword,
        { persist: false },
      );
      jellyfinSession = { accessToken: session.AccessToken, userId: session.User.Id };
      jellyfinPassword = '';
      jellyfinStatus = 'ready';
      jellyfinMessage = m.setup_jellyfin_connected();
    } catch (error) {
      jellyfinStatus = 'error';
      jellyfinMessage = error instanceof JellyfinAuthError
        ? m.setup_jellyfin_auth_failed()
        : m.setup_jellyfin_unreachable();
    }
  }

  function returnToDashboard(): void {
    const url = new URL(location.href);
    url.searchParams.delete('setup');
    location.replace(`${url.pathname}${url.search}${url.hash}`);
  }

  async function loadConnectionMode(): Promise<void> {
    try {
      const response = await fetch('/api/ha/connection', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('connection mode unavailable');
      const payload = await response.json() as { mode?: string; available?: boolean };
      connectionMode = payload.mode === 'supervisor' ? 'supervisor' : 'direct';
      supervisorAvailable = payload.available !== false;
    } catch {
      connectionMode = 'direct';
    }
  }

  async function discoverViaServer(): Promise<SetupDiscoverySnapshot> {
    const response = await fetch('/api/setup/discovery', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('discovery failed');
    return await response.json() as SetupDiscoverySnapshot;
  }

  async function loadCurrentSetup(): Promise<void> {
    try {
      const [householdResponse, sharedResponse] = await Promise.all([
        fetch('/api/household-config', { headers: { Accept: 'application/json' }, cache: 'no-store' }),
        fetch('/api/config', { headers: { Accept: 'application/json' }, cache: 'no-store' }),
      ]);
      if (!householdResponse.ok || !sharedResponse.ok) {
        throw new Error(m.setup_load_failed());
      }
      const parsed = parseHouseholdConfig(await householdResponse.json());
      if (!parsed.ok) throw new Error(m.setup_config_invalid());
      householdEtag = householdResponse.headers.get('etag');
      sharedEtag = sharedResponse.headers.get('etag');
      const shared = await sharedResponse.json() as { values?: Record<string, unknown> };
      const values = shared.values ?? {};
      if (typeof values['hmi:ha-url'] === 'string') haUrl = values['hmi:ha-url'];
      if (typeof values['hmi:ha-token'] === 'string') token = values['hmi:ha-token'];
      if (typeof values['hmi:jf-url'] === 'string') jellyfinUrl = values['hmi:jf-url'];
      jellyfinEnabled = values['hmi:library'] === 'live';
      if (jellyfinEnabled
          && typeof values['hmi:jf-token'] === 'string'
          && typeof values['hmi:jf-user'] === 'string') {
        jellyfinSession = {
          accessToken: values['hmi:jf-token'],
          userId: values['hmi:jf-user'],
        };
        jellyfinStatus = 'ready';
        jellyfinMessage = m.setup_jellyfin_existing();
      }
      suggestion = {
        config: structuredClone(parsed.value) as HouseholdConfigV4,
        ignoredEntityIds: [],
        inferredRooms: false,
      };
      status = 'ready';
      message = embedded ? '' : m.setup_loaded();
    } catch (error) {
      status = 'error';
      message = error instanceof Error ? error.message : m.setup_load_failed();
    }
  }

  onMount(() => {
    void (async () => {
      await loadConnectionMode();
      if (reconfigure) {
        if (reconfigureDraft) {
          // Ein unfertiger Entwurf aus einem vorherigen Mount dieser Sektion
          // (Navigation weg und zurück) hat Vorrang vor dem Server-Stand.
          // Der Vorrang wird sichtbar gemacht: sonst zeigt die Sektion nach
          // langer Zeit stillschweigend etwas anderes als den Serverstand,
          // mit veralteten ETags, an denen erst das Speichern scheitert.
          suggestion = reconfigureDraft.suggestion;
          householdEtag = reconfigureDraft.householdEtag;
          sharedEtag = reconfigureDraft.sharedEtag;
          haUrl = reconfigureDraft.haUrl;
          token = reconfigureDraft.token;
          draftRestored = true;
          status = 'ready';
        } else {
          status = 'loading';
          message = m.setup_loading();
          await loadCurrentSetup();
        }
      } else if (supervisor && supervisorAvailable) {
        /* Ohne Credentialfrage gibt es nichts einzugeben: die App scannt sofort. */
        await connectAndScan();
      }
    })();
  });

  // Spiegelt den Entwurf in den Modul-Cache, solange reconfigure läuft —
  // Grundlage für den Wiedereinstieg oben nach einem Remount.
  $effect(() => {
    if (!reconfigure || !suggestion) return;
    reconfigureDraft = { suggestion, householdEtag, sharedEtag, haUrl, token };
  });

  /* Der einzige Weg aus einem wiederhergestellten Entwurf heraus, der nicht
     Speichern heißt. Ohne ihn bliebe ein vergessener Entwurf bis zum Neuladen
     der Seite bestehen und verdeckte den Serverstand. */
  async function discardDraft(): Promise<void> {
    reconfigureDraft = null;
    draftRestored = false;
    status = 'loading';
    message = m.setup_loading();
    await loadCurrentSetup();
  }

  /* Gerätelokale Sichtbarkeit setzen und — bei Zustimmung — den ersten Auftrag
     anstoßen. Bewusst ohne Warten: der Renderjob läuft serverseitig weiter,
     der Abschluss der Einrichtung hängt nicht daran. Schlägt er fehl, bleibt es
     beim leeren Standby, den es ohne diese Funktion ohnehin gäbe. */
  function applyCityMapChoice(): void {
    setAmbientCityMap(cityMapEnabled);
    if (!cityMapEnabled) return;
    void fetch('/api/admin/ambient-map/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'home_assistant' }),
    }).catch(() => { /* ohne Ort bleibt der Standby der bisherige */ });
  }

  async function connectAndScan(): Promise<void> {
    if (!supervisor && (!haUrl.trim() || !token.trim())) {
      status = 'error';
      message = m.setup_credentials_required();
      return;
    }
    const previousSuggestion = suggestion;
    const previousOmittedCount = omittedCount;
    status = 'connecting';
    message = '';
    suggestion = null;
    omittedCount = 0;
    try {
      const snapshot = supervisor
        ? await discoverViaServer()
        : await discoverHomeAssistant(haUrl, token);
      const discovered = buildSetupHouseholdSuggestion(snapshot);
      suggestion = previousSuggestion
        ? {
            ...discovered,
            config: preserveSetupRoomHeroes(previousSuggestion.config, discovered.config),
          }
        : discovered;
      status = 'ready';
      message = m.setup_found({
        rooms: suggestion.config.rooms.length,
        entities: suggestion.config.rooms.reduce((sum, room) => sum + room.visibleEntities.length, 0),
      });
    } catch (error) {
      suggestion = previousSuggestion;
      omittedCount = previousOmittedCount;
      status = 'error';
      message = supervisor ? m.setup_app_mode_unreachable() : m.setup_connect_failed();
    }
  }

  function moveEntity(entityId: string, event: Event): void {
    if (!suggestion) return;
    const targetRoomId = (event.currentTarget as HTMLSelectElement).value;
    const config = moveSetupEntity(suggestion.config, entityId, targetRoomId);
    if (config !== suggestion.config) suggestion = { ...suggestion, config };
  }

  function omitEntity(entityId: string): void {
    if (!suggestion) return;
    const next = omitSetupEntity(suggestion.config, entityId);
    if (next === suggestion.config) return;
    suggestion = { ...suggestion, config: next };
    omittedCount += 1;
  }

  async function addRoom(): Promise<void> {
    if (!suggestion) return;
    const config = addSetupRoom(suggestion.config, m.setup_new_room_default());
    const room = config.rooms.at(-1);
    suggestion = { ...suggestion, config };
    expandedRoomId = room?.id ?? expandedRoomId;
    await tick();
    if (room) document.querySelector<HTMLInputElement>(`[data-room-name="${room.id}"]`)?.focus();
  }

  function renameRoom(roomId: string, name: string): void {
    if (!suggestion) return;
    const config = renameSetupRoom(suggestion.config, roomId, name);
    suggestion = { ...suggestion, config };
  }

  function moveRoom(roomId: string, direction: -1 | 1): void {
    if (!suggestion) return;
    const config = moveSetupRoom(suggestion.config, roomId, direction);
    if (config !== suggestion.config) suggestion = { ...suggestion, config };
  }

  function reorderRoom(roomId: string, targetIndex: number): void {
    if (!suggestion) return;
    const config = moveSetupRoomTo(suggestion.config, roomId, targetIndex);
    if (config !== suggestion.config) suggestion = { ...suggestion, config };
  }

  function roomDeleteOptions(roomId: string): { id: string; name: string; disabled: boolean }[] {
    if (!suggestion) return [];
    const config = suggestion.config;
    return config.rooms
      .filter((room) => room.id !== roomId)
      .map((room) => ({
        id: room.id,
        name: room.name,
        disabled: !canRemoveSetupRoom(config, roomId, { type: 'move', targetRoomId: room.id }),
      }));
  }

  function deleteRoom(roomId: string, destination: string): void {
    if (!suggestion) return;
    const room = suggestion.config.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return;
    const removal = destination === '__omit__'
      ? { type: 'omit' as const }
      : { type: 'move' as const, targetRoomId: destination };
    const next = removeSetupRoom(suggestion.config, roomId, removal);
    if (next === suggestion.config) return;
    const removedEntities = room.visibleEntities.length;
    suggestion = { ...suggestion, config: next };
    if (expandedRoomId === roomId) expandedRoomId = next.rooms[0]?.id ?? null;
    if (removal.type === 'omit') omittedCount += removedEntities;
  }

  function beginDeleteRoom(roomId: string): void {
    if (!suggestion || suggestion.config.rooms.length <= 1) return;
    const config = suggestion.config;
    const compatibleTarget = config.rooms.find((room) => room.id !== roomId
      && canRemoveSetupRoom(config, roomId, { type: 'move', targetRoomId: room.id }));
    pendingDeleteRoomId = roomId;
    expandedRoomId = roomId;
    deleteDestination = compatibleTarget?.id ?? '__omit__';
  }

  function cancelDeleteRoom(): void {
    pendingDeleteRoomId = null;
    deleteDestination = '';
  }

  function confirmDeleteRoom(): void {
    if (!suggestion || !pendingDeleteRoom) return;
    const removedEntities = pendingDeleteRoom.visibleEntities.length;
    const removal = deleteDestination === '__omit__'
      ? { type: 'omit' as const }
      : { type: 'move' as const, targetRoomId: deleteDestination };
    const deletedRoomId = pendingDeleteRoom.id;
    const next = removeSetupRoom(suggestion.config, deletedRoomId, removal);
    if (next === suggestion.config) return;
    suggestion = { ...suggestion, config: next };
    if (expandedRoomId === deletedRoomId) expandedRoomId = next.rooms[0]?.id ?? null;
    if (removal.type === 'omit') omittedCount += removedEntities;
    cancelDeleteRoom();
  }

  async function activate(): Promise<void> {
    if (!suggestion) return;
    if (!embedded && jellyfinEnabled && !jellyfinSession) {
      status = 'error';
      message = m.setup_jellyfin_required();
      return;
    }
    const parsed = parseHouseholdConfig(suggestion.config);
    if (!parsed.ok) {
      const issue = parsed.issues[0];
      status = 'error';
      message = `${issue.path}: ${issue.message}`;
      return;
    }
    status = 'activating';
    message = '';
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (reconfigure) {
        if (householdEtag) headers['If-Match'] = householdEtag;
        if (sharedEtag) headers['X-Hauser-Shared-Config-If-Match'] = sharedEtag;
      }
      const response = await fetch('/api/setup/activate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          /* Im App-Modus trägt die Anfrage bewusst keine HA-Credentials. */
          ...(supervisor ? {} : { haUrl: haUrl.trim(), haToken: token }),
          householdConfig: suggestion.config,
          jellyfin: jellyfinEnabled && jellyfinSession
            ? {
                enabled: true,
                url: jellyfinUrl.trim(),
                accessToken: jellyfinSession.accessToken,
                userId: jellyfinSession.userId,
              }
            : { enabled: false },
        }),
      });
      const payload = await response.json() as {
        code?: string;
        message?: string;
        issue?: { path?: string; message?: string };
      };
      if (!response.ok) {
        if (payload.code === 'SETUP_JELLYFIN_AUTH_FAILED') {
          throw new Error(m.setup_jellyfin_auth_failed());
        }
        if (payload.code === 'SETUP_JELLYFIN_UNREACHABLE'
            || payload.code === 'SETUP_JELLYFIN_HTTP_ERROR') {
          throw new Error(m.setup_jellyfin_unreachable());
        }
        const issue = payload.issue?.path ? ` ${payload.issue.path}: ${payload.issue.message ?? ''}` : '';
        throw new Error(`${m.setup_activate_failed()}${issue}`.trim());
      }
      token = '';
      jellyfinPassword = '';
      jellyfinSession = null;
      /* Nur im Erstlauf: die Reconfigure-Ansicht zeigt den Schritt nicht und
         darf eine später getroffene Wahl nicht überschreiben. */
      if (!reconfigure) applyCityMapChoice();
      await refreshHouseholdConfigRuntimeCache();
      if (reconfigure) {
        reconfigureDraft = null;
        draftRestored = false;
        returnToDashboard();
      }
      /* Erstlauf: erst die Adresse zeigen, unter der die Endgeräte Hauser
         öffnen — danach übernimmt der normale Start. */
      else if (!embedded) { status = 'done'; message = ''; }
      else location.reload();
    } catch (error) {
      status = 'error';
      message = error instanceof Error ? error.message : m.setup_activate_failed();
    }
  }
</script>

<svelte:head><title>{embedded ? 'Smart Home HMI' : (reconfigure ? m.setup_head_title_reconfigure() : m.setup_head_title_first())}</title></svelte:head>

{#key localeState.current}
<main class:embedded class="setup-shell">
  <section class:embedded class="setup-card" aria-labelledby={embedded ? undefined : 'setup-title'}>
    {#if !reconfigure}
      <section class="language-step" aria-labelledby="setup-language-title">
        <p class="eyebrow">{m.setup_step_language()}</p>
        <h2 id="setup-language-title">{m.setup_language_title()}</h2>
        <p>{m.setup_language_hint()}</p>
        <div class="language-selector" role="radiogroup" aria-label={m.setup_language_title()}>
          {#each AVAILABLE_LOCALES as locale (locale)}
            <button
              class="language-option"
              class:is-active={localeState.current === locale}
              type="button"
              role="radio"
              aria-checked={localeState.current === locale}
              onclick={() => void changeLocale(locale, { syncDemoNames: false })}
            >{localeLabel(locale)}</button>
          {/each}
        </div>
      </section>
    {/if}
    {#if !embedded}
    <div class="setup-heading">
      <div>
        <p class="eyebrow">{reconfigure ? m.setup_eyebrow_reconfigure() : m.setup_step_home_assistant()}</p>
        <h1 id="setup-title">{reconfigure ? m.setup_title_reconfigure() : m.setup_title_first()}</h1>
      </div>
      {#if reconfigure}
        <button class="secondary" type="button" onclick={returnToDashboard} disabled={status === 'activating'}>{m.setup_cancel()}</button>
      {/if}
    </div>
    <p class="intro">
      {supervisor
        ? m.setup_app_mode_intro()
        : reconfigure
          ? m.setup_intro_reconfigure()
          : m.setup_intro_first()}
    </p>

    <form onsubmit={(event) => { event.preventDefault(); void connectAndScan(); }}>
      {#if !supervisor}
      <label>
        <span>{m.setup_ha_url()}</span>
        <input type="url" bind:value={haUrl} autocomplete="url" spellcheck="false" required disabled={status === 'loading' || status === 'activating'} />
      </label>
      <label>
        <span>{m.setup_token()}</span>
        <input type="password" bind:value={token} autocomplete="off" required disabled={status === 'loading' || status === 'activating'} />
        <small>{m.setup_token_hint_before()} <code>/data</code> {m.setup_token_hint_after()}</small>
      </label>
      {/if}
      <button class="primary" type="submit" disabled={status === 'loading' || status === 'connecting' || status === 'activating'}>
        {status === 'connecting'
          ? m.setup_connecting()
          : supervisor ? m.setup_app_mode_scan() : m.setup_connect_scan()}
      </button>
    </form>
    {/if}

    {#if message}
      <p class:error={status === 'error'} class="message" role={status === 'error' ? 'alert' : 'status'}>{message}</p>
    {/if}

    {#if suggestion}
      <div class="preview">
        {#if !embedded}
          <div class="preview-heading">
            <div>
              <p class="eyebrow">{m.setup_preview()}</p>
              <h2>{m.setup_found_rooms()}</h2>
            </div>
            {#if suggestion.inferredRooms}<span class="warning">{m.setup_inferred_rooms()}</span>{/if}
          </div>
        {:else if suggestion.inferredRooms}
          <span class="warning">{m.setup_inferred_rooms()}</span>
        {/if}
        {#if embedded}
          <RoomListEditor
            rooms={suggestion.config.rooms}
            busy={status === 'activating'}
            deleteOptions={roomDeleteOptions}
            onopen={openRoomEdit}
            onrename={(roomId, name) => renameRoom(roomId, name)}
            onreorder={reorderRoom}
            ondelete={deleteRoom}
            onadd={() => void addRoom()}
          />
        {:else}
        <div class="room-list">
          {#each suggestion.config.rooms as room, roomIndex (room.id)}
            <section class:expanded={expandedRoomId === room.id} class="room-card" aria-labelledby={`room-${room.id}`}>
              <div class="room-heading">
                <button
                  class="room-expand"
                  type="button"
                  aria-label={room.name}
                  aria-expanded={expandedRoomId === room.id}
                  onclick={() => (expandedRoomId = expandedRoomId === room.id ? null : room.id)}
                >
                  <span class="room-index num">{roomIndex + 1}</span>
                  <span class="room-chevron" aria-hidden="true">›</span>
                </button>
                <label class="room-title">
                  <span class="sr-only">{m.setup_room_name()}</span>
                  <input
                    id={`room-${room.id}`}
                    data-room-name={room.id}
                    value={room.name}
                    oninput={(event) => renameRoom(room.id, event.currentTarget.value)}
                    required
                  />
                </label>
                <span class="room-count">{m.setup_entity_count({ count: room.visibleEntities.length })}</span>
                <div class="room-actions" aria-label={m.setup_room_order()}>
                  <button class="icon-action secondary" type="button"
                    aria-label={m.setup_move_room_up()} title={m.setup_move_room_up()}
                    disabled={roomIndex === 0 || status === 'activating'}
                    onclick={() => moveRoom(room.id, -1)}>↑</button>
                  <button class="icon-action secondary" type="button"
                    aria-label={m.setup_move_room_down()} title={m.setup_move_room_down()}
                    disabled={roomIndex === suggestion.config.rooms.length - 1 || status === 'activating'}
                    onclick={() => moveRoom(room.id, 1)}>↓</button>
                  <button class="delete-room secondary" type="button"
                    disabled={suggestion.config.rooms.length <= 1 || status === 'activating'}
                    title={suggestion.config.rooms.length <= 1 ? m.setup_last_room_hint() : m.setup_delete_room()}
                    onclick={() => beginDeleteRoom(room.id)}>{m.setup_delete_room()}</button>
                </div>
              </div>
              {#if expandedRoomId === room.id}
                <div class="room-details">
                  {#if pendingDeleteRoomId === room.id}
                    <div class="room-delete-confirm" role="group" aria-labelledby={`delete-room-${room.id}`}>
                      <strong id={`delete-room-${room.id}`}>{m.setup_delete_room_title({ name: room.name })}</strong>
                      <p>{m.setup_delete_room_hint()}</p>
                      <label>
                        <span>{m.setup_delete_room_destination()}</span>
                        <select bind:value={deleteDestination}>
                          {#each suggestion.config.rooms.filter(({ id }) => id !== room.id) as targetRoom (targetRoom.id)}
                            <option
                              value={targetRoom.id}
                              disabled={!canRemoveSetupRoom(suggestion.config, room.id, { type: 'move', targetRoomId: targetRoom.id })}
                            >{m.setup_delete_room_move_to({ name: targetRoom.name })}</option>
                          {/each}
                          <option value="__omit__">{m.setup_delete_room_omit()}</option>
                        </select>
                      </label>
                      <div class="delete-actions">
                        <button class="secondary" type="button" onclick={cancelDeleteRoom}>{m.setup_delete_room_cancel()}</button>
                        <button class="danger-confirm" type="button" onclick={confirmDeleteRoom}>{m.setup_delete_room_confirm()}</button>
                      </div>
                    </div>
                  {/if}
                  {#if room.visibleEntities.length > 0}
                    <div class="entity-list">
                      {#each room.visibleEntities as entity (entity.entityId)}
                        <div class="entity-editor">
                          <label>
                            <span class="sr-only">{m.setup_entity_name({ entityId: entity.entityId })}</span>
                            <input class="entity-name" bind:value={entity.name} required />
                          </label>
                          <small>{entity.entityId} · {entity.role}</small>
                          <label>
                            <span class="sr-only">{m.setup_entity_room({ name: entity.name })}</span>
                            <select value={room.id} onchange={(event) => moveEntity(entity.entityId, event)}>
                              {#each suggestion.config.rooms as targetRoom (targetRoom.id)}
                                <option
                                  value={targetRoom.id}
                                  disabled={!canMoveSetupEntity(suggestion.config, entity.entityId, targetRoom.id)}
                                >{targetRoom.name}</option>
                              {/each}
                            </select>
                          </label>
                          <button class="secondary" type="button" onclick={() => omitEntity(entity.entityId)}>{m.setup_omit()}</button>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <small class="room-empty">{m.setup_none_proposed()}</small>
                  {/if}
                </div>
              {/if}
            </section>
          {/each}
        </div>
        <button class="secondary add-room" type="button" onclick={() => void addRoom()} disabled={status === 'activating'}>
          + {m.setup_add_room()}
        </button>
        {/if}
        {#if suggestion.ignoredEntityIds.length + omittedCount > 0}
          <p class="ignored">{m.setup_ignored_count({ count: suggestion.ignoredEntityIds.length + omittedCount })}</p>
        {/if}

        {#if !embedded}
        <section class="service-step" aria-labelledby="setup-jellyfin-title">
          <p class="eyebrow">{m.setup_step_jellyfin()}</p>
          <h2 id="setup-jellyfin-title">{m.setup_jellyfin_title()}</h2>
          <p class="service-hint">{m.setup_jellyfin_hint()}</p>
          <label class="service-toggle">
            <input
              type="checkbox"
              checked={jellyfinEnabled}
              onchange={toggleJellyfin}
              disabled={status === 'activating'}
            />
            <span>
              <strong>{m.setup_jellyfin_enable()}</strong>
              <small>{m.setup_jellyfin_enable_hint()}</small>
            </span>
          </label>

          {#if jellyfinEnabled}
            <form class="jellyfin-form" onsubmit={(event) => { event.preventDefault(); void testJellyfin(); }}>
              <label>
                <span>{m.setup_jellyfin_url()}</span>
                <input
                  type="url"
                  bind:value={jellyfinUrl}
                  oninput={invalidateJellyfinSession}
                  autocomplete="url"
                  spellcheck="false"
                  required
                  disabled={jellyfinStatus === 'testing' || status === 'activating'}
                />
              </label>
              <div class="credential-grid">
                <label>
                  <span>{m.setup_jellyfin_username()}</span>
                  <input
                    type="text"
                    bind:value={jellyfinUsername}
                    oninput={invalidateJellyfinSession}
                    autocomplete="username"
                    spellcheck="false"
                    disabled={jellyfinStatus === 'testing' || status === 'activating'}
                  />
                </label>
                <label>
                  <span>{m.setup_jellyfin_password()}</span>
                  <input
                    type="password"
                    bind:value={jellyfinPassword}
                    oninput={invalidateJellyfinSession}
                    autocomplete="current-password"
                    disabled={jellyfinStatus === 'testing' || status === 'activating'}
                  />
                </label>
              </div>
              <button
                class="secondary"
                type="submit"
                disabled={jellyfinStatus === 'testing' || status === 'activating' || !jellyfinUsername.trim() || !jellyfinPassword}
              >{jellyfinStatus === 'testing' ? m.setup_jellyfin_testing() : m.setup_jellyfin_test()}</button>
            </form>
            {#if jellyfinMessage}
              <p class:error={jellyfinStatus === 'error'} class:success={jellyfinStatus === 'ready'} class="message" role={jellyfinStatus === 'error' ? 'alert' : 'status'}>{jellyfinMessage}</p>
            {/if}
          {:else}
            <p class="message" role="status">{m.setup_jellyfin_disabled()}</p>
          {/if}
        </section>

        <section class="service-step" aria-labelledby="setup-map-title">
          <p class="eyebrow">{m.setup_step_map()}</p>
          <h2 id="setup-map-title">{m.setup_map_title()}</h2>
          <p class="service-hint">{m.setup_map_hint()}</p>
          <!-- Bewusst ein mitgeliefertes Beispiel und NICHT der eigene Ort:
               dessen Karte zu rendern hieße, die Anfrage schon vor der
               Entscheidung zu stellen. -->
          <div class="map-example" role="img" aria-label={m.setup_map_example_alt()}>
            <span class="map-example-ink"></span>
          </div>
          <label class="service-toggle">
            <input
              type="checkbox"
              bind:checked={cityMapEnabled}
              disabled={status === 'activating'}
            />
            <span>
              <strong>{m.setup_map_enable()}</strong>
              <small>{m.setup_map_enable_hint()}</small>
            </span>
          </label>
        </section>
        {/if}

        <!-- Sichtbarer Vorrang des Entwurfs: ohne diesen Hinweis zeigte die
             Sektion nach langer Abwesenheit stillschweigend etwas anderes als
             den Serverstand. Verwerfen ist der einzige Ausweg, der nicht
             Speichern heißt. -->
        {#if draftRestored}
          <div class="draft-notice" role="status">
            <span>{m.setup_draft_restored()}</span>
            <button
              class="secondary-btn pressable"
              type="button"
              onclick={() => void discardDraft()}
              disabled={status === 'activating'}
            >{m.setup_draft_discard()}</button>
          </div>
        {/if}

        <div class:save-bar={embedded}>
          <button
            class="primary"
            type="button"
            onclick={() => void activate()}
            disabled={status === 'activating' || (!embedded && jellyfinEnabled && !jellyfinSession)}
          >
            {status === 'activating'
              ? (reconfigure ? m.setup_saving() : m.setup_activating())
              : (embedded ? m.settings_rooms_devices_save() : (reconfigure ? m.setup_save_start() : m.setup_confirm_start()))}
          </button>
        </div>

        {#if embedded && after}
          {@render after({ rescan: () => void connectAndScan(), busy: status === 'loading' || status === 'connecting' || status === 'activating' })}
        {/if}
      </div>
    {/if}

    {#if status === 'done'}
      <div class="done">
        <p class="eyebrow">{m.setup_done_eyebrow()}</p>
        <h2>{m.setup_done_title()}</h2>
        <DeviceAddress />
        <button class="primary" type="button" onclick={() => location.reload()}>{m.setup_done_open()}</button>
      </div>
    {/if}
  </section>
</main>
{/key}

<style>
  .setup-shell { min-height: 100dvh; display: grid; place-items: center; padding: var(--space-6); background: var(--color-surface-0); color: var(--color-text-primary); font-family: var(--font-family); }
  .setup-card { width: min(calc(var(--space-8) * 12), 100%); padding: var(--space-8); border: 1px solid var(--color-border); border-radius: var(--radius-xl); background: var(--color-surface-1); box-shadow: var(--elevation-overlay-shadow); }
  .setup-shell.embedded { min-height: 0; display: block; padding: 0; background: transparent; }
  .setup-card.embedded { width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
  .setup-card.embedded .preview { margin-top: 0; padding-top: 0; border-top: 0; }
  .language-step { margin-bottom: var(--space-7); padding-bottom: var(--space-6); border-bottom: 1px solid var(--color-border); }
  .language-step > p:not(.eyebrow) { margin: var(--space-2) 0 var(--space-4); color: var(--color-text-secondary); line-height: var(--leading-relaxed); }
  .language-selector { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); }
  .language-option { border: 1px solid var(--color-border); background: var(--color-surface-0); color: var(--color-text-secondary); }
  .language-option.is-active { border-color: var(--color-accent-warm); background: color-mix(in srgb, var(--color-accent-warm) 14%, var(--color-surface-0)); color: var(--color-text-primary); }
  .done { display: grid; gap: var(--space-4); margin-top: var(--space-6); padding-top: var(--space-6); border-top: 1px solid var(--color-border); }
  .setup-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
  .eyebrow { margin: 0 0 var(--space-2); color: var(--color-text-secondary); font-size: var(--text-xs); font-weight: var(--font-weight-semibold); letter-spacing: var(--tracking-caps); text-transform: uppercase; }
  h1, h2 { margin: 0; font-weight: var(--font-weight-semibold); letter-spacing: var(--tracking-snug); }
  h1 { font-size: var(--text-2xl); }
  h2 { font-size: var(--text-lg); }
  .intro { margin: var(--space-3) 0 var(--space-6); color: var(--color-text-secondary); line-height: var(--leading-relaxed); }
  form { display: grid; gap: var(--space-4); }
  label { display: grid; gap: var(--space-2); font-weight: 600; }
  input, select { min-height: var(--touch-preferred); padding: 0 var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-0); color: var(--color-text-primary); font: inherit; }
  input:focus, select:focus { outline: 2px solid var(--color-accent-warm); outline-offset: 2px; }
  small, .ignored { color: var(--color-text-secondary); font-weight: var(--font-weight-normal); line-height: var(--leading-normal); }
  code { font-family: var(--font-family-mono); }
  button { min-height: var(--touch-preferred); border: 0; border-radius: var(--radius-md); padding: 0 var(--space-5); font: inherit; font-weight: var(--font-weight-semibold); cursor: pointer; }
  button:disabled { opacity: .55; cursor: wait; }
  .primary { background: var(--color-accent-warm); color: var(--color-text-on-accent); }
  .secondary { border: 1px solid var(--color-border); background: var(--color-surface-1); color: var(--color-text-secondary); }
  .message { margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-2); }
  .message.error { color: var(--color-error); }
  .preview { margin-top: var(--space-7); padding-top: var(--space-6); border-top: 1px solid var(--color-border); }
  .preview-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
  .warning { padding: var(--space-2) var(--space-3); border-radius: var(--radius-full); background: color-mix(in srgb, var(--color-warning) 18%, transparent); color: var(--color-warning); font-size: var(--text-xs); }
  .room-list { overflow: hidden; margin: var(--space-4) 0; border: 1px solid var(--color-border); border-radius: var(--radius-xl); background: var(--color-surface-1); }
  .room-card { background: var(--color-surface-1); }
  .room-card + .room-card { border-top: 1px solid var(--color-border); }
  .room-card.expanded { background: var(--color-surface-2); }
  .room-heading { display: grid; grid-template-columns: var(--touch-min) minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-3); min-height: calc(var(--touch-min) + var(--space-3)); padding: var(--space-2) var(--space-3); }
  .room-expand { position: relative; display: grid; place-items: center; width: var(--touch-min); min-height: var(--touch-min); padding: 0; border-radius: var(--radius-md); background: var(--color-surface-3); color: var(--color-text-primary); }
  .room-index { font-size: var(--text-sm); }
  .room-chevron { position: absolute; right: calc(var(--space-1) * -1); color: var(--color-text-tertiary); font-size: var(--text-lg); transform: rotate(0deg); transition: transform var(--duration-fast) var(--ease-out); }
  .room-expand[aria-expanded='true'] .room-chevron { transform: rotate(90deg); }
  .room-title input { width: 100%; min-height: var(--touch-min); padding-inline: var(--space-2); border-color: transparent; background: transparent; font-weight: var(--font-weight-semibold); }
  .room-title input:hover { border-color: var(--color-border); }
  .room-count { color: var(--color-text-secondary); white-space: nowrap; }
  .room-actions, .delete-actions { display: flex; align-items: center; gap: var(--space-2); }
  .room-actions button { min-height: var(--touch-min); }
  .icon-action { width: var(--touch-min); padding: 0; font-size: var(--text-base); }
  .delete-room { color: var(--color-error); }
  .room-details { padding: 0 var(--space-4) var(--space-3) calc(var(--touch-min) + var(--space-6)); border-top: 1px solid var(--color-border); }
  .room-delete-confirm { display: grid; gap: var(--space-3); padding: var(--space-4); border: 1px solid color-mix(in srgb, var(--color-error) 35%, var(--color-border)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-error) 7%, var(--color-surface-1)); }
  .room-delete-confirm p { margin: 0; color: var(--color-text-secondary); line-height: var(--leading-normal); }
  .delete-actions { justify-content: flex-end; }
  .danger-confirm { background: var(--color-error); color: var(--color-text-on-accent); }
  .add-room { width: 100%; margin-bottom: var(--space-4); }
  .entity-list { display: grid; }
  .entity-editor { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(calc(var(--space-8) * 2), .65fr) auto; align-items: center; gap: var(--space-3); min-height: calc(var(--touch-min) + var(--space-3)); border-bottom: 1px solid var(--color-border); }
  .entity-editor:last-child { border-bottom: 0; }
  .entity-editor label, .entity-editor input, .entity-editor select { width: 100%; }
  .entity-editor input, .entity-editor select, .entity-editor button { min-height: var(--touch-min); }
  .entity-editor small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .room-empty { display: block; padding: var(--space-4) 0 var(--space-1); }
  .ignored { margin: 0 0 var(--space-4); }
  .service-step { display: grid; gap: var(--space-4); margin: var(--space-6) 0; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-0); }
  .service-hint { margin: calc(var(--space-2) * -1) 0 0; color: var(--color-text-secondary); line-height: var(--leading-relaxed); }
  .service-toggle { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface-1); cursor: pointer; }
  .service-toggle input { width: var(--space-5); min-height: var(--space-5); margin: 0; accent-color: var(--color-accent-warm); }
  .service-toggle span { display: grid; gap: var(--space-1); }
  .jellyfin-form { padding-top: var(--space-2); }
  /* Dieselbe Maskentechnik wie im Standby, auf eine dunkle Fläche gelegt —
     so liest sich die Miniatur wie der spätere Vollbildeindruck. Die 10 %
     des Standbys wären hier falsch: dort füllt die Karte den ganzen Schirm,
     in einer kleinen Kachel bliebe davon nichts Sichtbares übrig. */
  .map-example {
    position: relative;
    overflow: hidden;
    height: clamp(120px, 22vw, 200px);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
  }
  .map-example-ink {
    position: absolute;
    inset: 0;
    background: var(--color-text-primary);
    opacity: 0.3;
    -webkit-mask-image: url('/assets/ambient-maps/a7de47116390b2ef4e0ba1ca5f5fcfe0cb904ac82d0bc753b12a8b24da44d98a.svg');
    mask-image: url('/assets/ambient-maps/a7de47116390b2ef4e0ba1ca5f5fcfe0cb904ac82d0bc753b12a8b24da44d98a.svg');
    -webkit-mask-size: cover;
    mask-size: cover;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }
  .credential-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
  .message.success { color: var(--color-success); }
  .save-bar { display: flex; justify-content: flex-end; margin-bottom: var(--space-6); }
  .draft-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid color-mix(in srgb, var(--color-accent-warm) 35%, var(--color-border));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-accent-warm) 7%, var(--color-surface-1));
    color: var(--color-text-primary);
  }
  .draft-notice button { min-height: var(--touch-min); flex: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  @media (max-width: 900px) { .entity-editor { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; padding: var(--space-2) 0; } .entity-editor small { grid-column: 1 / -1; grid-row: 2; } }
  @media (max-width: 640px) { .setup-shell { padding: var(--space-3); align-items: start; } .setup-card { padding: var(--space-5); border-radius: var(--radius-lg); } .language-selector { grid-template-columns: repeat(2, minmax(0, 1fr)); } .setup-heading, .preview-heading { align-items: flex-start; flex-direction: column; } .room-heading { grid-template-columns: var(--touch-min) minmax(0, 1fr) auto; } .room-count { display: none; } .room-actions { grid-column: 2 / -1; flex-wrap: wrap; } .room-details { padding-left: var(--space-4); } .entity-editor, .credential-grid { grid-template-columns: 1fr; } .entity-editor small { grid-column: 1; grid-row: auto; } }
</style>
