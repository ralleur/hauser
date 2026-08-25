<script lang="ts">
  /* Raum-Geräte-Editor (Long-Press auf Raum-Kachel, analog Licht-Detail):
     Modal mit der Geräteliste des Raums (Reihenfolge per Pfeile, Entfernen)
     und einer Suche, die Katalog-Vorschläge zum Hinzufügen einblendet — nie
     die komplette Entity-Liste. Reuse des overlay-scrim/modal-Musters. */
  import Icon from './Icon.svelte';
  import '../../styles/room-images.css';
  import { longpress } from '../actions/longpress.ts';
  import { appState } from '../state/app.svelte.ts';
  import { roomEdit, closeRoomEdit, finishRoomEditClose } from '../state/overlay.svelte.ts';
  import {
    addDeviceToRoom,
    deviceManager,
    hideDevice,
    setRoomDeviceOrder,
  } from '../state/device-manager.svelte.ts';
  import { categoryOf, CATEGORY_LABELS, type EntityCatalogItem } from '../state/device-config.ts';
  import { m } from '../../paraglide/messages.js';
  import {
    removeLightPlacement,
    roomLightPlacements,
    setLightPlacement,
  } from '../state/immersion-light.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { removeRoomBackground, uploadRoomBackground } from '../state/room-background-client.ts';
  import RoomImageLibrary from './settings/RoomImageLibrary.svelte';

  const room = $derived(appState.rooms.find((r) => r.id === roomEdit.roomId));

  let query = $state('');
  let searchEl = $state<HTMLInputElement>();
  let view = $state<'devices' | 'immersion' | 'background'>('devices');
  let selectedLightId = $state('');
  let backgroundInput = $state<HTMLInputElement>();
  let backgroundBusy = $state(false);
  let backgroundMessage = $state<string | null>(null);
  let backgroundError = $state(false);
  let libraryOpen = $state(false);
  let moveDeviceId = $state<string | null>(null);
  const roomLights = $derived((room?.lights ?? []).filter((device) => (device.category ?? 'light') === 'light'));
  const placements = $derived(roomLightPlacements(room?.id));
  const selectedPlacement = $derived(placements[selectedLightId]);
  const background = $derived(roomHeroConfig(room?.id));
  const backgroundUrl = $derived(background
    ? `/assets/room-images/${background.assetId}/light.avif`
    : `${import.meta.env.BASE_URL}hero/${room?.id}-light.avif`);

  // Vorschläge erst ab Eingabe: bestes Präfix-Match zuerst, dann Name-Substring,
  // dann entity_id/Domain. Geräte, die schon im Raum liegen, tauchen nicht auf.
  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q || !room) return [];
    const inRoom = new Set(room.lights.map((l) => l.entityId));
    return deviceManager.catalog
      .filter((item) => !inRoom.has(item.entityId))
      .map((item) => ({ item, rank: matchRank(item, q) }))
      .filter((s) => s.rank > 0)
      .sort((a, b) => b.rank - a.rank || a.item.name.localeCompare(b.item.name, 'de'))
      .slice(0, 6)
      .map((s) => s.item);
  });

  function matchRank(item: EntityCatalogItem, q: string): number {
    const name = item.name.toLowerCase();
    if (name.startsWith(q)) return 3;
    if (name.includes(q)) return 2;
    if (item.entityId.toLowerCase().includes(q) || item.domain.includes(q)) return 1;
    return 0;
  }

  // Herkunfts-Hinweis im Vorschlag: liegt das Gerät gerade in einem anderen Raum?
  function locatedIn(entityId: string): string | null {
    return appState.rooms.find((r) => r.lights.some((l) => l.entityId === entityId))?.name ?? null;
  }

  function add(item: EntityCatalogItem) {
    if (!room) return;
    addDeviceToRoom(item.entityId, room.id, room.lights.map((l) => l.entityId));
    query = '';
    searchEl?.focus();
  }

  function move(index: number, delta: -1 | 1) {
    if (!room) return;
    const ids = room.lights.map((l) => l.entityId);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setRoomDeviceOrder(room.id, ids);
  }

  // Beim Raum-Wechsel bzw. Schließen die Suche zurücksetzen.
  $effect(() => {
    void roomEdit.roomId;
    query = '';
    view = 'devices';
    selectedLightId = '';
    backgroundMessage = null;
    backgroundError = false;
  });

  function openImmersionEditor() {
    view = 'immersion';
    selectedLightId = roomLights[0]?.entityId ?? '';
  }

  function openBackgroundEditor() {
    view = 'background';
    selectedLightId = '';
    backgroundMessage = null;
    backgroundError = false;
  }

  async function chooseBackground(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!room || !file || backgroundBusy) return;
    backgroundBusy = true;
    backgroundMessage = null;
    backgroundError = false;
    try {
      await uploadRoomBackground(room.id, file);
      backgroundMessage = m.room_background_saved();
    } catch (error) {
      backgroundError = true;
      backgroundMessage = error instanceof Error ? error.message : m.room_background_failed();
    } finally {
      backgroundBusy = false;
    }
  }

  async function restoreBackground() {
    if (!room || !background || backgroundBusy) return;
    backgroundBusy = true;
    backgroundMessage = null;
    backgroundError = false;
    try {
      await removeRoomBackground(room.id);
      backgroundMessage = m.room_background_restored();
    } catch (error) {
      backgroundError = true;
      backgroundMessage = error instanceof Error ? error.message : m.room_background_failed();
    } finally {
      backgroundBusy = false;
    }
  }

  /* Longpress auf eine Geraetezeile verschiebt das Geraet in einen anderen Raum.
     addDeviceToRoom haengt es ans Ende der Zielraum-Reihenfolge. */
  function moveDeviceToRoom(targetRoomId: string) {
    const entityId = moveDeviceId;
    moveDeviceId = null;
    if (!entityId) return;
    const targetOrder = appState.rooms.find((entry) => entry.id === targetRoomId)?.lights.map((light) => light.entityId) ?? [];
    addDeviceToRoom(entityId, targetRoomId, targetOrder);
  }

  function placeSelected(event: MouseEvent) {
    if (!room || !selectedLightId) return;
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!rect) return;
    setLightPlacement(room.id, selectedLightId, {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      radius: selectedPlacement?.radius ?? 0.16,
    });
  }

  function setSelectedRadius(event: Event) {
    if (!room || !selectedLightId || !selectedPlacement) return;
    const radius = Number((event.currentTarget as HTMLInputElement).value);
    setLightPlacement(room.id, selectedLightId, { ...selectedPlacement, radius });
  }

  // animationend-Fallback (deckt prefers-reduced-motion: 0ms ab)
  $effect(() => {
    if (roomEdit.mode !== 'closing') return;
    const t = setTimeout(finishRoomEditClose, 250);
    return () => clearTimeout(t);
  });

  // Initial-Fokus beim Öffnen (A11y): einmal auf das Panel.
  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (roomEdit.mode === 'open' && panelEl) panelEl.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && roomEdit.mode === 'open') closeRoomEdit();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="room-edit" class:is-open={roomEdit.mode === 'open'}
     class:is-closing={roomEdit.mode === 'closing'} hidden={roomEdit.mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={() => closeRoomEdit()}></div>
  <div class="room-edit-panel overlay-panel" class:is-immersion={view === 'immersion'} class:is-background={view === 'background'} role="dialog" aria-modal="true"
       aria-label="Geräte in {room?.name ?? 'Raum'} bearbeiten" tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (roomEdit.mode === 'closing' && e.target === e.currentTarget) finishRoomEditClose(); }}>
    {#if room}
      {#key room.id}
        <header class="ld-header">
          {#if view !== 'devices'}
            <button class="re-btn pressable" type="button" aria-label={m.room_back_to_devices()}
                    onclick={() => { view = 'devices'; selectedLightId = ''; }}>
              <Icon name="i-chevron-left" cls="icon icon-md" />
            </button>
          {/if}
          <h2 class="ld-title">{room.name} <span class="re-subtitle">{view === 'immersion' ? m.room_immersion_light() : view === 'background' ? m.room_background() : m.room_devices()}</span></h2>
          <button class="ld-close pressable" type="button" aria-label={m.common_close()}
                  onclick={() => closeRoomEdit()}>×</button>
        </header>

        <div class="ld-body">
          {#if view === 'devices'}
          <button class="re-immersion-entry pressable" type="button" onclick={openBackgroundEditor}>
            <span class="re-icon" aria-hidden="true"><Icon name="i-image" /></span>
            <span class="re-label">
              <span class="re-name">{m.room_background()}</span>
              <small class="re-meta">{background ? m.room_background_custom() : m.room_background_default()}</small>
            </span>
            <Icon name="i-chevron-right" cls="icon icon-md" />
          </button>
          <button class="re-immersion-entry pressable" type="button" onclick={openImmersionEditor}>
            <span class="re-icon" aria-hidden="true"><Icon name="i-bulb" /></span>
            <span class="re-label">
              <span class="re-name">{m.room_assign_lamps()}</span>
              <small class="re-meta">{m.room_set_light_positions()}</small>
            </span>
            <Icon name="i-chevron-right" cls="icon icon-md" />
          </button>
          <section class="ld-section">
            <span class="caps-label">Reihenfolge · {room.lights.length}</span>
            {#if room.lights.length === 0}
              <p class="re-empty">{m.room_no_devices()}</p>
            {:else}
              <ul class="re-list">
                {#each room.lights as device, i (device.entityId)}
                  <li class="re-row" use:longpress={{ onLongPress: () => moveDeviceId = device.entityId }}>
                    <span class="re-icon" aria-hidden="true"><Icon name={device.icon ?? 'i-bulb'} /></span>
                    <span class="re-label">
                      <span class="re-name">{device.name}</span>
                      <small class="re-meta">{device.entityId}</small>
                    </span>
                    <span class="re-actions">
                      <button class="re-btn pressable" type="button" disabled={i === 0}
                              aria-label="{device.name} nach oben" onclick={() => move(i, -1)}>
                        <Icon name="i-chevron-up" cls="icon icon-md" />
                      </button>
                      <button class="re-btn pressable" type="button" disabled={i === room.lights.length - 1}
                              aria-label="{device.name} nach unten" onclick={() => move(i, 1)}>
                        <Icon name="i-chevron-down" cls="icon icon-md" />
                      </button>
                      <button class="re-btn re-remove pressable" type="button"
                              aria-label="{device.name} aus {room.name} entfernen"
                              onclick={() => hideDevice(device.entityId)}>
                        <Icon name="i-minus" cls="icon icon-md" />
                      </button>
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="ld-section">
            <span class="caps-label">{m.room_add_device()}</span>
            <input class="re-search" type="search" bind:value={query} bind:this={searchEl}
                   placeholder={m.room_search_placeholder()}
                   aria-label={m.room_search_device()} autocomplete="off" spellcheck="false" />
            {#if query.trim()}
              {#if suggestions.length === 0}
                <p class="re-empty">{m.room_no_matches()}</p>
              {:else}
                <ul class="re-list re-suggest">
                  {#each suggestions as item (item.entityId)}
                    {@const origin = locatedIn(item.entityId)}
                    <li>
                      <button class="re-row re-suggest-btn pressable" type="button" onclick={() => add(item)}>
                        <span class="re-icon re-icon-add" aria-hidden="true"><Icon name="i-plus" cls="icon icon-md" /></span>
                        <span class="re-label">
                          <span class="re-name">{item.name}</span>
                          <small class="re-meta">{item.entityId}</small>
                        </span>
                        <!-- Kategorie-Chip: bei 9 Domänen sieht man, WAS man hinzufügt -->
                        <span class="re-tag">{CATEGORY_LABELS[categoryOf(item.domain)]}</span>
                        {#if origin}<span class="re-tag">in {origin}</span>{/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          </section>
          {:else if view === 'immersion'}
            <div class="re-immersion-editor">
              <aside class="re-immersion-lights" aria-label={m.room_pick_lamps()}>
                <p class="re-empty">{m.room_pick_lamp_hint()}</p>
                {#if roomLights.length === 0}
                  <p class="re-empty">{m.room_no_lamps()}</p>
                {:else}
                  <ul class="re-list">
                    {#each roomLights as light (light.entityId)}
                      <li>
                        <button class="re-row re-light-choice pressable"
                                class:is-selected={selectedLightId === light.entityId}
                                class:is-placed={!!placements[light.entityId]}
                                type="button" onclick={() => selectedLightId = light.entityId}>
                          <span class="re-icon" aria-hidden="true"><Icon name={light.icon ?? 'i-bulb'} /></span>
                          <span class="re-label">
                            <span class="re-name">{light.name}</span>
                            <small class="re-meta">{placements[light.entityId] ? m.room_position_set() : m.room_not_assigned()}</small>
                          </span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if selectedPlacement}
                  <label class="re-radius">
                    <span>{m.room_light_radius()}</span>
                    <input type="range" min="0.06" max="0.32" step="0.01"
                           value={selectedPlacement.radius} oninput={setSelectedRadius} />
                  </label>
                  <button class="re-unassign pressable" type="button"
                          onclick={() => room && removeLightPlacement(room.id, selectedLightId)}>
                    Zuweisung entfernen
                  </button>
                {/if}
              </aside>
              <button class="re-immersion-preview" type="button" onclick={placeSelected}
                      disabled={!selectedLightId}
                      style:background-image={`url("${import.meta.env.BASE_URL}hero/${room.id}-dark-off.avif")`}
                      aria-label={selectedLightId ? m.room_set_position() : m.room_pick_lamp_first()}>
                {#each Object.entries(placements) as [entityId, placement] (entityId)}
                  <span class="re-light-marker" class:is-selected={selectedLightId === entityId}
                        style:left={`${placement.x * 100}%`} style:top={`${placement.y * 100}%`}></span>
                {/each}
              </button>
            </div>
          {:else}
            <section class="re-background-editor">
              <div class="re-background-preview" style:background-image={`url("${backgroundUrl}")`}
                   aria-label={m.room_background_preview()}></div>
              <div class="re-background-actions">
                <p class="re-empty">{m.room_background_hint()}</p>
                <input bind:this={backgroundInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif"
                       onchange={chooseBackground} />
                <button class="secondary-btn pressable" type="button" disabled={backgroundBusy}
                        onclick={() => backgroundInput?.click()}>
                  {backgroundBusy ? m.room_background_saving() : background ? m.room_background_replace() : m.room_background_choose()}
                </button>
                <button class="secondary-btn pressable" type="button" disabled={backgroundBusy}
                        onclick={() => libraryOpen = true}>{m.rimg_lib_from_library()}</button>
                {#if background}
                  <button class="re-unassign pressable" type="button" disabled={backgroundBusy}
                          onclick={restoreBackground}>{m.room_background_restore()}</button>
                {/if}
                {#if backgroundMessage}
                  <p class="re-background-message" class:is-error={backgroundError} role="status">{backgroundMessage}</p>
                {/if}
              </div>
            </section>
          {/if}
        </div>
      {/key}
    {/if}
  </div>
</div>

{#if room && moveDeviceId}
  {@const moving = room.lights.find((entry) => entry.entityId === moveDeviceId)}
  <div class="re-move-layer" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) moveDeviceId = null; }}>
    <div class="re-move-sheet" role="dialog" aria-modal="true" aria-label={m.rimg_move_label()}>
      <h3>{m.rimg_move_title({ device: moving?.name ?? '' })}</h3>
      <p>{m.rimg_move_question()}</p>
      <div class="re-move-rooms">
        {#each appState.rooms.filter((entry) => entry.id !== room.id) as target (target.id)}
          <button class="secondary-btn pressable" type="button"
                  onclick={() => moveDeviceToRoom(target.id)}>{target.name}</button>
        {/each}
      </div>
      <button class="secondary-btn pressable" type="button" onclick={() => moveDeviceId = null}>{m.rimg_cancel()}</button>
    </div>
  </div>
{/if}

{#if room}
  <RoomImageLibrary open={libraryOpen} targetRoomId={room.id}
                    onclose={() => libraryOpen = false}
                    onassigned={() => { backgroundError = false; backgroundMessage = m.room_background_saved(); }} />
{/if}
