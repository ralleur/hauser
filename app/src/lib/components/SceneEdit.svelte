<script lang="ts">
  /* Szenen-Editor (Long-Press auf eine Szenen-Pille, analog Raum-Geräte-Editor):
     Modal mit den Mitgliedern der Szene (Default: alle Raum-Lichter) und einer
     Suche, die Lichter/Schalter zum Hinzufügen vorschlägt — nie die komplette
     Entity-Liste. Die Szene ist oben per Tabs umschaltbar; „Zurücksetzen"
     verwirft die Abweichungen vom Default. Reuse des overlay-scrim/modal- und
     re-*-Listenmusters (RoomEdit). */
  import Icon from './Icon.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { deviceManager } from '../state/device-manager.svelte.ts';
  import {
    sceneEdit, closeSceneEdit, finishSceneEditClose,
    sceneMembers, sceneDefaults, sceneCustomized,
    addToScene, removeFromScene, resetScene,
  } from '../state/scene-manager.svelte.ts';
  import { SCENES, sceneDef, isSceneCapableEntity, isLightEntity, type SceneId } from '../state/scene-config.ts';
  import type { EntityCatalogItem } from '../state/device-config.ts';

  import { m } from '../../paraglide/messages.js';
  function sceneLabel(sceneId: SceneId): string {
    if (sceneId === 'gemuetlich') return m.scene_cosy();
    if (sceneId === 'hell') return m.scene_bright();
    return m.scene_off();
  }
  const room = $derived(appState.rooms.find((r) => r.id === sceneEdit.roomId));
  const scene = $derived(sceneDef(sceneEdit.sceneId));
  const members = $derived(room ? sceneMembers(room.id, sceneEdit.sceneId) : []);
  const defaults = $derived(new Set(room ? sceneDefaults(room.id) : []));
  const customized = $derived(room ? sceneCustomized(room.id, sceneEdit.sceneId) : false);

  const sceneHint = $derived(scene.on
    ? `Dimmbare Lichter auf ${scene.brightness} %, alles andere wird eingeschaltet.`
    : m.scene_turns_off_all());

  let query = $state('');
  let searchEl = $state<HTMLInputElement>();

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
    query = '';
    searchEl?.focus();
  }

  // Beim Raum-/Szenen-Wechsel bzw. Schließen die Suche zurücksetzen.
  $effect(() => { void sceneEdit.roomId; void sceneEdit.sceneId; query = ''; });

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
          <div class="se-tabs" role="tablist" aria-label={m.scene_pick()}>
            {#each SCENES as s (s.id)}
              <button class="se-tab pressable" type="button" role="tab"
                      aria-selected={sceneEdit.sceneId === s.id} class:is-active={sceneEdit.sceneId === s.id}
                      onclick={() => (sceneEdit.sceneId = s.id)}>{sceneLabel(s.id)}</button>
            {/each}
          </div>
          <p class="se-hint">{sceneHint}</p>

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
              <p class="re-empty">Keine Geräte in dieser Szene — unten per Suche hinzufügen.</p>
            {:else}
              <ul class="re-list">
                {#each members as entityId (entityId)}
                  {@const view = viewOf(entityId)}
                  {@const origin = locatedIn(entityId)}
                  <li class="re-row">
                    <span class="re-icon" aria-hidden="true"><Icon name={view.icon} /></span>
                    <span class="re-label">
                      <span class="re-name">{view.name}</span>
                      <small class="re-meta">{entityId}</small>
                    </span>
                    {#if origin}<span class="re-tag">in {origin}</span>{/if}
                    {#if !defaults.has(entityId)}<span class="re-tag">Extra</span>{/if}
                    <span class="re-actions">
                      <button class="re-btn re-remove pressable" type="button"
                              aria-label="{view.name} aus Szene {scene.label} entfernen"
                              onclick={() => removeFromScene(room.id, sceneEdit.sceneId, entityId)}>
                        <Icon name="i-minus" cls="icon icon-md" />
                      </button>
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="ld-section">
            <span class="caps-label">Licht oder Schalter hinzufügen</span>
            <input class="re-search" type="search" bind:value={query} bind:this={searchEl}
                   placeholder="Suchen: Name oder entity_id …"
                   aria-label="Licht oder Schalter suchen" autocomplete="off" spellcheck="false" />
            {#if query.trim()}
              {#if suggestions.length === 0}
                <p class="re-empty">Keine passenden Lichter oder Schalter gefunden.</p>
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
        </div>
      {/key}
    {/if}
  </div>
</div>
