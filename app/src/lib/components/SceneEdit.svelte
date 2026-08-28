<script lang="ts">
  /* Szenen-Editor (Long-Press auf eine Szenen-Pille, analog Raum-Geräte-Editor):
     Modal mit den Mitgliedern der Szene (Default: alle Raum-Lichter) und einer
     Suche, die Lichter/Schalter zum Hinzufügen vorschlägt — nie die komplette
     Entity-Liste. Die Szene ist oben per Tabs umschaltbar; „Zurücksetzen"
     verwirft die Abweichungen vom Default. Reuse des overlay-scrim/modal- und
     re-*-Listenmusters (RoomEdit). */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { dragreorder } from '../actions/dragreorder.ts';
  import TickScale from './TickScale.svelte';
  import { appState, COLOR_TEMP_MIN, COLOR_TEMP_MAX } from '../state/app.svelte.ts';
  import { deviceManager } from '../state/device-manager.svelte.ts';
  import { tempTint } from '../state/light-presets.ts';
  import {
    sceneEdit, closeSceneEdit, finishSceneEditClose,
    sceneMembers, sceneDefaults, sceneCustomized,
    addToScene, removeFromScene, resetScene,
    memberCapabilities, memberState, memberTarget, setMemberState,
    previewMember, previewScene,
    scenes, sceneDefOf, createScene, renameScene, removeScene, reorderMember,
    type SceneMemberCapabilities,
  } from '../state/scene-manager.svelte.ts';
  import { isSceneCapableEntity, isLightEntity, type SceneMemberState } from '../state/scene-config.ts';
  import type { EntityCatalogItem } from '../state/device-config.ts';

  import { m } from '../../paraglide/messages.js';
  const room = $derived(appState.rooms.find((r) => r.id === sceneEdit.roomId));
  const sceneOptions = $derived(scenes(sceneEdit.roomId));
  const scene = $derived(sceneOptions.length > 0 ? sceneDefOf(sceneEdit.roomId, sceneEdit.sceneId) : null);
  const members = $derived(room ? sceneMembers(room.id, sceneEdit.sceneId) : []);
  const defaults = $derived(new Set(room ? sceneDefaults(room.id) : []));
  const customized = $derived(room ? sceneCustomized(room.id, sceneEdit.sceneId) : false);

  /* Szenenname: eigener Entwurf, damit die Eingabe beim Leeren nicht
     zurückschnappt. Übernommen wird bei jedem Tastendruck; ein leeres Feld
     lässt den Namen stehen und wird beim Verlassen zurückgesetzt. */
  let nameDraft = $state('');

  function addScene() {
    sceneEdit.sceneId = createScene(sceneEdit.roomId, m.scene_new_default());
  }

  function onNameInput(value: string) {
    nameDraft = value;
    renameScene(sceneEdit.roomId, sceneEdit.sceneId, value);
  }

  /* Löschen in zwei Schritten (Muster RoomsDevicesSection): der erste Tap
     stellt die Frage, der zweite führt aus. Szenen-/Raumwechsel bricht ab. */
  let confirmDelete = $state(false);
  const canDelete = $derived(sceneOptions.length > 0);

  function onDeleteClick() {
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    confirmDelete = false;
    const nextSceneId = removeScene(sceneEdit.roomId, sceneEdit.sceneId);
    if (nextSceneId) sceneEdit.sceneId = nextSceneId;
  }

  /* Reihenfolge der Mitglieder: Konfig-Overlay-Standard (actions/dragreorder). */
  let dragEntityId = $state<string | null>(null);
  let listEl = $state<HTMLElement>();

  let query = $state('');
  let searchEl = $state<HTMLInputElement>();

  /* ── Zielzustand je Gerät (Apple-Home-Muster) ──
     Eine Zeile ist aufgeklappt; die Änderung landet in der Config UND fährt
     sofort live aufs Gerät (Vorschau). Beim Schließen des Overlays nimmt der
     Manager die Vorschau zurück. */
  let expanded = $state('');
  let dragBri = $state<number | null>(null);
  let dragTemp = $state<number | null>(null);

  function toggleExpanded(entityId: string) {
    expanded = expanded === entityId ? '' : entityId;
    dragBri = null;
    dragTemp = null;
  }

  function tempRange(caps: SceneMemberCapabilities): { min: number; max: number } {
    const min = caps.colorTempMin ?? COLOR_TEMP_MIN;
    const max = caps.colorTempMax ?? COLOR_TEMP_MAX;
    return min < max ? { min, max } : { min: COLOR_TEMP_MIN, max: COLOR_TEMP_MAX };
  }

  function stateSummary(caps: SceneMemberCapabilities, target: SceneMemberState): string {
    if (!target.on) return m.dev_off();
    const parts: string[] = [m.dev_on()];
    if (caps.dimmable && typeof target.brightness === 'number') parts.push(`${Math.round(target.brightness)} %`);
    if (caps.colorTemp && typeof target.colorTemp === 'number') parts.push(`${Math.round(target.colorTemp)} K`);
    return parts.join(' · ');
  }

  function patchState(entityId: string, patch: Partial<SceneMemberState>) {
    if (!room) return;
    const cur = memberTarget(room.id, sceneEdit.sceneId, entityId);
    setMemberState(room.id, sceneEdit.sceneId, entityId, { ...cur, ...patch });
  }

  function resetMember(entityId: string) {
    if (!room) return;
    setMemberState(room.id, sceneEdit.sceneId, entityId, undefined);
  }

  /* Anzeige-Infos eines Mitglieds: erst die Raum-Projektionen (Name/Icon der
     Kachel), dann der Katalog — Fremd-Entitäten zeigen ihre entity_id. */
  function viewOf(entityId: string): { name: string; icon: string } {
    const fallbackIcon = isLightEntity(entityId) ? 'i-bulb' : 'i-bolt';
    for (const r of appState.rooms) {
      const device = r.lights.find((l) => l.entityId === entityId);
      if (device) return { name: device.name, icon: device.icon ?? fallbackIcon };
    }
    const item = deviceManager.catalog.find((i) => i.entityId === entityId);
    return { name: item?.name ?? entityId, icon: fallbackIcon };
  }

  // Herkunfts-Hinweis: liegt das Gerät in einem anderen Raum als dem der Szene?
  function locatedIn(entityId: string): string | null {
    const origin = appState.rooms.find((r) => r.lights.some((l) => l.entityId === entityId));
    return origin && origin.id !== sceneEdit.roomId ? origin.name : null;
  }

  // Vorschläge erst ab Eingabe (Muster RoomEdit): nur Lichter/Schalter, die
  // noch nicht Mitglied sind. Präfix-Match zuerst, dann Substring, dann id.
  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q || !room) return [];
    const inScene = new Set(members);
    return deviceManager.catalog
      .filter((item) => isSceneCapableEntity(item.entityId) && !inScene.has(item.entityId))
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

  function add(item: EntityCatalogItem) {
    if (!room) return;
    addToScene(room.id, sceneEdit.sceneId, item.entityId);
    previewMember(room.id, sceneEdit.sceneId, item.entityId);
    query = '';
    searchEl?.focus();
  }

  // Beim Raum-/Szenen-Wechsel bzw. Schließen Suche und Namensfeld zurücksetzen.
  $effect(() => {
    void sceneEdit.roomId;
    const sceneId = sceneEdit.sceneId;
    query = '';
    expanded = '';
    dragBri = null;
    dragTemp = null;
    confirmDelete = false;
    // untrack: der Name ändert sich beim Tippen — sonst liefe der Effect mit.
    untrack(() => { nameDraft = scenes(sceneEdit.roomId).length ? sceneDefOf(sceneEdit.roomId, sceneId).label : ''; });
  });

  /* Die gewählte Szene wird als Vorschau gefahren (Öffnen + Tab-Wechsel).
     untrack: die Vorschau liest die Config — ohne das liefe der Effect nach
     jeder Zustandsänderung erneut. */
  $effect(() => {
    if (sceneEdit.mode !== 'open') return;
    const roomId = sceneEdit.roomId;
    const sceneId = sceneEdit.sceneId;
    if (!sceneOptions.some((option) => option.id === sceneId)) return;
    untrack(() => previewScene(roomId, sceneId));
  });

  // animationend-Fallback (deckt prefers-reduced-motion: 0ms ab)
  $effect(() => {
    if (sceneEdit.mode !== 'closing') return;
    const t = setTimeout(finishSceneEditClose, 250);
    return () => clearTimeout(t);
  });

  // Initial-Fokus beim Öffnen (A11y): einmal auf das Panel.
  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (sceneEdit.mode === 'open' && panelEl) panelEl.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && sceneEdit.mode === 'open') closeSceneEdit();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="room-edit scene-edit" class:is-open={sceneEdit.mode === 'open'}
     class:is-closing={sceneEdit.mode === 'closing'} hidden={sceneEdit.mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={() => closeSceneEdit()}></div>
  <div class="room-edit-panel overlay-panel" role="dialog" aria-modal="true"
       aria-label="Szenen in {room?.name ?? 'Raum'} bearbeiten" tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (sceneEdit.mode === 'closing' && e.target === e.currentTarget) finishSceneEditClose(); }}>
    {#if room}
      {#key room.id}
        <header class="ld-header">
          <h2 class="ld-title">{room.name} <span class="re-subtitle">{m.scene_scenes()}</span></h2>
          <button class="ld-close pressable" type="button" aria-label={m.common_close()}
                  onclick={() => closeSceneEdit()}>×</button>
        </header>

        <div class="ld-body">
          <!-- Raster mit drei Szenen je Zeile; „Neue Szene" ist die letzte
               Kachel und rückt mit jeder angelegten Szene eine weiter. -->
          <div class="se-tabs" role="group" aria-label={m.scene_pick()}>
            {#each sceneOptions as s (s.id)}
              <button class="se-tab pressable" type="button"
                      aria-pressed={sceneEdit.sceneId === s.id} class:is-active={sceneEdit.sceneId === s.id}
                      onclick={() => (sceneEdit.sceneId = s.id)}>{s.label}</button>
            {/each}
            <button class="se-tab se-tab-add cfg-add pressable" type="button" onclick={addScene}>
              {m.scene_add_new()}
            </button>
          </div>

          {#if scene}
          <div class="se-name">
            <span class="caps-label" id="se-name-label">{m.scene_name()}</span>
            <div class="se-name-row">
              <input class="re-search" type="text" value={nameDraft} aria-labelledby="se-name-label"
                     oninput={(e) => onNameInput(e.currentTarget.value)}
                     onblur={() => { nameDraft = scene.label; }}
                     autocomplete="off" spellcheck="false" />
              <button class="cfg-delete pressable" type="button" class:is-confirming={confirmDelete}
                      disabled={!canDelete} title={m.scene_delete()}
                      aria-label={confirmDelete ? m.scene_delete_confirm() : m.scene_delete()}
                      onclick={onDeleteClick} onblur={() => { confirmDelete = false; }}>
                {#if confirmDelete}
                  {m.scene_delete_confirm()}
                {:else}
                  <Icon name="i-trash-can-outline" cls="icon icon-md" />
                {/if}
              </button>
            </div>
          </div>

          <section class="ld-section">
            <div class="se-section-head">
              <span class="caps-label">Enthalten · {members.length}</span>
              {#if customized}
                <button class="se-reset pressable" type="button"
                        onclick={() => resetScene(room.id, sceneEdit.sceneId)}>{m.scene_reset()}</button>
              {:else}
                <span class="se-standard">Standard: alle Lichter des Raums</span>
              {/if}
            </div>
            {#if members.length === 0}
              <p class="re-empty">{m.scene_empty()}</p>
            {:else}
              <ul class="re-list" bind:this={listEl}>
                {#each members as entityId (entityId)}
                  {@const view = viewOf(entityId)}
                  {@const origin = locatedIn(entityId)}
                  {@const caps = memberCapabilities(entityId)}
                  {@const target = memberTarget(room.id, sceneEdit.sceneId, entityId)}
                  {@const isOpen = expanded === entityId}
                  <li class="se-member" class:is-expanded={isOpen}
                      class:is-dragging={dragEntityId === entityId} data-reorder-row={entityId}>
                    <div class="re-row">
                      <button class="se-member-main pressable" type="button" aria-expanded={isOpen}
                              onclick={() => toggleExpanded(entityId)}>
                        <span class="re-icon" aria-hidden="true"><Icon name={view.icon} /></span>
                        <span class="re-label">
                          <span class="re-name">{view.name}</span>
                          <small class="se-member-state">{stateSummary(caps, target)}</small>
                        </span>
                        <Icon name={isOpen ? 'i-chevron-up' : 'i-chevron-down'} cls="icon icon-md" />
                      </button>
                      {#if origin}<span class="re-tag">in {origin}</span>{/if}
                      {#if !defaults.has(entityId)}<span class="re-tag">{m.scene_extra()}</span>{/if}
                      <span class="re-actions">
                        <button class="cfg-handle" type="button"
                                aria-label={m.scene_reorder({ name: view.name })}
                                disabled={members.length < 2}
                                use:dragreorder={{
                                  id: entityId,
                                  list: () => listEl,
                                  enabled: members.length > 1,
                                  onReorder: (id, index) => reorderMember(room.id, sceneEdit.sceneId, id, index),
                                  onDragChange: (dragging) => { dragEntityId = dragging ? entityId : null; },
                                }}>
                          <Icon name="i-dots-grid" cls="icon icon-md" />
                        </button>
                        <button class="re-btn re-remove pressable" type="button"
                                aria-label="{view.name} aus Szene {scene.label} entfernen"
                                onclick={() => removeFromScene(room.id, sceneEdit.sceneId, entityId)}>
                          <Icon name="i-minus" cls="icon icon-md" />
                        </button>
                      </span>
                    </div>

                    {#if isOpen}
                      <div class="se-member-controls">
                        <div class="se-power" role="radiogroup" aria-label={m.dev_state()}>
                          <button class="se-power-seg pressable" type="button" role="radio"
                                  aria-checked={target.on} class:is-active={target.on}
                                  onclick={() => patchState(entityId, {
                                    on: true,
                                    brightness: target.brightness ?? (scene.on ? scene.brightness : 100),
                                  })}>{m.dev_on()}</button>
                          <button class="se-power-seg pressable" type="button" role="radio"
                                  aria-checked={!target.on} class:is-active={!target.on}
                                  onclick={() => patchState(entityId, { on: false })}>{m.dev_off()}</button>
                        </div>

                        {#if target.on && caps.dimmable}
                          <div class="se-control">
                            <span class="caps-label">{m.dev_brightness()}</span>
                            <TickScale ariaLabel={m.dev_brightness()} orientation="horizontal" mode="fill"
                                       value={dragBri ?? target.brightness ?? 100}
                                       min={1} max={100} step={1} keyStep={5}
                                       format={(v) => `${Math.round(v)} %`}
                                       onInput={(val, final) => {
                                         dragBri = final ? null : val;
                                         if (final) patchState(entityId, { on: true, brightness: val });
                                       }} />
                          </div>
                        {/if}

                        {#if target.on && caps.colorTemp}
                          {@const range = tempRange(caps)}
                          <div class="se-control">
                            <span class="caps-label">{m.dev_color_temp()}</span>
                            <TickScale ariaLabel={m.dev_color_temp()} orientation="horizontal" mode="gradient"
                                       value={Math.min(range.max, Math.max(range.min, dragTemp ?? target.colorTemp ?? 2700))}
                                       min={range.min} max={range.max} step={50} keyStep={100} tint={tempTint}
                                       format={(v) => `${Math.round(v)} K`}
                                       onInput={(val, final) => {
                                         dragTemp = final ? null : val;
                                         if (final) patchState(entityId, { on: true, colorTemp: val });
                                       }} />
                            <div class="ld-scale-ends"><span>{m.dev_warm()}</span><span>{m.dev_cool()}</span></div>
                          </div>
                        {/if}

                        {#if memberState(room.id, sceneEdit.sceneId, entityId)}
                          <button class="se-reset pressable" type="button"
                                  onclick={() => resetMember(entityId)}>{m.scene_member_reset()}</button>
                        {/if}
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="ld-section">
            <span class="caps-label">{m.scene_add_device()}</span>
            <input class="re-search" type="search" bind:value={query} bind:this={searchEl}
                   placeholder={m.scene_search_placeholder()}
                   aria-label="Licht oder Schalter suchen" autocomplete="off" spellcheck="false" />
            {#if query.trim()}
              {#if suggestions.length === 0}
                <p class="re-empty">{m.scene_no_match()}</p>
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
                        {#if origin}<span class="re-tag">in {origin}</span>{/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          </section>
          {/if}
        </div>
      {/key}
    {/if}
  </div>
</div>
