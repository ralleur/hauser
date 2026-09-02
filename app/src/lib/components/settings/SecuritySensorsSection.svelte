<script lang="ts">
  /* ── Zuhause · Fenster & Bewegung ──
     Welche Kontakte und Melder den Sicherheitsstatus in der Tab-Leiste speisen.
     Erkannt heißt aktiv: alles, was die Haushalts-Config als Rolle mitbringt
     oder Home Assistant im Bereich des Raums führt, ist voreingestellt an.
     Abgewählte Sensoren verschwinden aus Status und Detail-Liste. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { m } from '../../../paraglide/messages.js';
  import { appState } from '../../state/app.svelte.ts';
  import {
    contactEnabled,
    contactsAreAutomatic,
    roomContactOptions,
    setContactEnabled,
    setContactIds,
  } from '../../state/room-display-config.svelte.ts';
  import type { RoomContactKind } from '../../state/commands.ts';

  const KINDS = ['window', 'presence'] as const;

  interface RoomSensors {
    id: string;
    name: string;
    rows: { kind: RoomContactKind; entityId: string; label: string }[];
  }

  const rooms = $derived<RoomSensors[]>(appState.rooms
    .map((room) => ({
      id: room.id,
      name: room.name,
      rows: KINDS.flatMap((kind) => roomContactOptions(room.id, kind)
        .map((option) => ({ kind, entityId: option.entityId, label: option.name }))),
    }))
    .filter((room) => room.rows.length > 0));

  /* „Automatik" gilt je Art; der Knopf stellt beide Arten des Raums zurück. */
  function roomIsAutomatic(roomId: string): boolean {
    return KINDS.every((kind) => contactsAreAutomatic(roomId, kind));
  }

  function resetRoom(roomId: string): void {
    for (const kind of KINDS) setContactIds(roomId, kind, undefined);
  }
</script>

<div class="settings-group">
  <SettingsCardHead icon="i-shield" tint="success"
                    title={m.sys_security_card()} sub={m.sys_security_card_hint()} />

  {#if rooms.length === 0}
    <p class="settings-note">{m.sys_security_empty()}</p>
  {/if}
</div>

{#each rooms as room (room.id)}
  <div class="settings-group">
    <SettingsCardHead icon="i-home" tint="warm" title={room.name}
                      sub={roomIsAutomatic(room.id) ? m.room_contacts_auto() : m.room_contacts_manual()} />

    {#each room.rows as row (row.entityId)}
      {@const enabled = contactEnabled(room.id, row.kind, row.entityId)}
      <div class="settings-row" data-setting-id="security-sensor-{row.entityId}">
        <span class="settings-row-icon">
          <Icon name={row.kind === 'window' ? 'i-window' : 'i-motion-sensor'} cls="icon icon-md" />
        </span>
        <div class="settings-row-text">
          <span class="settings-row-label">{row.label}</span>
          <span class="settings-row-sub">{row.entityId}</span>
        </div>
        <button class="settings-switch pressable" type="button" role="switch"
                aria-checked={enabled} aria-label={row.label}
                onclick={() => setContactEnabled(room.id, row.kind, row.entityId, !enabled)}>
          <span class="settings-switch-knob"></span>
        </button>
      </div>
    {/each}

    {#if !roomIsAutomatic(room.id)}
      <div class="settings-row" data-setting-id="security-reset-{room.id}">
        <span class="settings-row-icon"><Icon name="i-restore" cls="icon icon-md" /></span>
        <div class="settings-row-text">
          <span class="settings-row-label">{m.sys_security_reset()}</span>
          <span class="settings-row-sub">{m.sys_security_reset_hint()}</span>
        </div>
        <button class="secondary-btn pressable" type="button"
                onclick={() => resetRoom(room.id)}>{m.room_contacts_reset()}</button>
      </div>
    {/if}
  </div>
{/each}
