<script lang="ts">
  /* Gerätegruppe bilden oder bearbeiten (Owner-Wunsch 2026-09-13): erreichbar
     über den Gruppen-Knopf im Gerätedetail (statt des Schließen-Kreuzes).
     Zwei oder mehr Geräte derselben Art aus allen Räumen werden EIN Gerät —
     jeder Griff geht an alle Mitglieder mit demselben Wert (adapter/runtime).
     Eine neue Gruppe nimmt im Raum den Platz des Geräts ein, aus dem sie
     angelegt wurde. Gleiche Scheibe wie der Szenen-Editor. */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { appState, type Light } from '../state/app.svelte.ts';
  import {
    createDeviceGroup, deviceManager, dissolveDeviceGroup, groupOf, updateDeviceGroup,
  } from '../state/device-manager.svelte.ts';
  import { deviceIdOf, isGroupEntityId, type GroupCategory } from '../state/device-config.ts';
  import { m } from '../../paraglide/messages.js';

  interface Props {
    roomId: string;
    device: Light;
    /** Fertig: Kachel-Id des Geräts, das das Detail als Nächstes zeigt (null = dasselbe). */
    onDone: (nextDeviceId: string | null) => void;
    onClose: () => void;
  }
  const { roomId, device, onDone, onClose }: Props = $props();

  /* Der Editor gilt für das Gerät, mit dem er geöffnet wurde — auch wenn das
     Detail nach dem Anlegen schon die neue Gruppe zeigt. */
  const seed = untrack(() => device);
  const existing = isGroupEntityId(seed.entityId) ? groupOf(seed.entityId) : null;
  const category = seed.category as GroupCategory;
  const origin = existing?.origin ?? seed.entityId;
  let mode = $state<'open' | 'closing'>('open');
  let members = $state<string[]>(existing ? [...existing.members] : [seed.entityId]);
  let nameDraft = $state(existing?.name ?? seed.name);

  interface Row { entityId: string; name: string; icon: string; roomName: string | null }
  function catalogName(entityId: string): string {
    return deviceManager.catalog.find((item) => item.entityId === entityId)?.name ?? entityId;
  }
  /* Kandidaten: alle sichtbaren Geräte derselben Art aus allen Räumen; die
     bisherigen Mitglieder und das Ursprungsgerät stehen immer dabei, auch
     wenn sie gerade in keinem Raum liegen. Ursprung zuerst. */
  const rows = $derived.by((): Row[] => {
    const list: Row[] = appState.rooms.flatMap((r) => r.lights
      .filter((l) => l.category === category && !isGroupEntityId(l.entityId) && l.entityId !== seed.entityId)
      .map((l) => ({ entityId: l.entityId, name: l.name, icon: l.icon ?? seed.icon ?? 'i-lightbulb', roomName: r.name })));
    const seen = new Set(list.map((row) => row.entityId));
    for (const id of [origin, ...(existing?.members ?? [])]) {
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ entityId: id, name: catalogName(id), icon: seed.icon ?? 'i-lightbulb', roomName: null });
    }
    return list.sort((a, b) => (a.entityId === origin ? -1 : b.entityId === origin ? 1 : 0));
  });
  const isMember = (entityId: string) => members.includes(entityId);
  function toggle(entityId: string) {
    if (entityId === origin) return;
    members = isMember(entityId) ? members.filter((id) => id !== entityId) : [...members, entityId];
  }
  function close() { if (mode === 'open') mode = 'closing'; }
  function save() {
    if (members.length < 2) return;
    if (existing) {
      updateDeviceGroup(existing.id, { name: nameDraft, members });
      onDone(null);
    } else {
      const room = appState.rooms.find((r) => r.id === roomId);
      const id = createDeviceGroup(
        { name: nameDraft.trim() || seed.name, category, members, roomId, origin },
        room?.lights.map((l) => l.entityId) ?? [],
      );
      onDone(deviceIdOf(id));
    }
    close();
  }
  function dissolve() {
    if (!existing) return;
    dissolveDeviceGroup(existing.id);
    onDone(deviceIdOf(existing.origin));
    close();
  }
  const title = existing ? m.grp_title_edit() : m.grp_title_new();
  const symbol = category === 'light' ? 'i-lightbulb-group-outline' : 'i-select-group';
</script>

<div class="room-edit group-edit" class:is-open={mode === 'open'} class:is-closing={mode === 'closing'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={close}></div>
  <div class="room-edit-panel overlay-panel on-image" role="dialog" aria-modal="true" aria-label={title} tabindex="-1"
       onanimationend={(e) => { if (mode === 'closing' && e.target === e.currentTarget) onClose(); }}>
    <header class="ld-header">
      <span class="ld-symbol is-on grp-symbol" aria-hidden="true"><Icon name={symbol} /></span>
      <h2 class="ld-title">{title}</h2>
      <button class="ld-close pressable" type="button" aria-label={m.common_close()} onclick={close}>×</button>
    </header>
    <div class="ld-body">
      <div class="se-name">
        <span class="caps-label" id="grp-name-label">{m.grp_name()}</span>
        <input class="re-search" type="text" bind:value={nameDraft} aria-labelledby="grp-name-label"
               maxlength="80" autocomplete="off" spellcheck="false" />
      </div>
      <section class="ld-section">
        <span class="caps-label">{m.grp_members()}</span>
        <p class="se-import-hint">{m.grp_hint()}</p>
        <ul class="re-list">
          {#each rows as row (row.entityId)}
            {@const member = isMember(row.entityId)}
            <li>
              <button class="re-row re-light-choice pressable" class:is-selected={member} type="button"
                      aria-pressed={member} disabled={row.entityId === origin} onclick={() => toggle(row.entityId)}>
                <span class="re-icon" aria-hidden="true"><Icon name={member ? 'i-check' : row.icon} /></span>
                <span class="re-label">
                  <span class="re-name">{row.name}</span>
                  {#if row.roomName}<small class="re-meta grp-room">{row.roomName}</small>{/if}
                </span>
                {#if row.entityId === origin}<span class="re-tag">{m.grp_origin_tag()}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if rows.length < 2}<p class="re-empty">{m.grp_none()}</p>{/if}
      </section>
      <div class="grp-actions">
        {#if existing}
          <button class="secondary-btn danger-btn pressable" type="button" onclick={dissolve}>{m.grp_dissolve()}</button>
        {/if}
        <button class="secondary-btn grp-save pressable" type="button" disabled={members.length < 2} onclick={save}>
          {existing ? m.grp_save() : m.grp_create()}
        </button>
      </div>
      {#if members.length < 2}<p class="se-import-hint grp-min">{m.grp_min()}</p>{/if}
    </div>
  </div>
</div>
