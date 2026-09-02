<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* ── Zentrale Klimasteuerung: was die „Alle Räume"-Pille steuert ──
     Quelle (alle Klima-Räume oder eine einzelne Entität), die beteiligten
     Räume und ihr Versatz zum zentralen Sollwert.

     Zwei Aufrufwege auf dieselbe Fassung: die Sektion „Räume & Geräte" in den
     Einstellungen und der Long-Press auf die Pille (CentralClimateEdit). */
  import { appState } from '../../state/app.svelte.ts';
  import { mergedClimate } from '../../state/commands.ts';
  import { deviceManager } from '../../state/device-manager.svelte.ts';
  import {
    centralClimateConfig,
    centralRoomDelta,
    centralRoomIncluded,
    setCentralClimateEntity,
    setCentralRoomDelta,
    setCentralRoomIncluded,
  } from '../../state/climate-central-config.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const climateRooms = $derived(appState.rooms.filter((room) => mergedClimate(room.id) !== null));
  const climateEntities = $derived(deviceManager.catalog.filter((entity) => entity.domain === 'climate'));
</script>

<div class="central-climate-card">
  <label class="central-climate-source">
    <span class="rooms-tile-title">{m.central_climate_source()}</span>
    <select class="central-climate-select"
            value={centralClimateConfig.customEntityId ?? ''}
            onchange={(event) => setCentralClimateEntity(event.currentTarget.value || null)}>
      <option value="">{m.central_climate_source_rooms()}</option>
      {#if centralClimateConfig.customEntityId && !climateEntities.some((entity) => entity.entityId === centralClimateConfig.customEntityId)}
        <option value={centralClimateConfig.customEntityId}>{centralClimateConfig.customEntityId}</option>
      {/if}
      {#each climateEntities as entity (entity.entityId)}
        <option value={entity.entityId}>{entity.name} · {entity.entityId}</option>
      {/each}
    </select>
  </label>

  {#if centralClimateConfig.customEntityId}
    <p class="central-climate-note">{m.central_climate_custom_hint()}</p>
  {:else if climateRooms.length === 0}
    <p class="central-climate-note">{m.central_climate_no_rooms()}</p>
  {:else}
    <div class="central-climate-rooms">
      <span class="caps-label">{m.central_climate_rooms()}</span>
      {#each climateRooms as room (room.id)}
        {@const included = centralRoomIncluded(room.id)}
        <div class="central-climate-room">
          <label class="central-climate-check">
            <input type="checkbox" checked={included}
                   onchange={(event) => setCentralRoomIncluded(room.id, event.currentTarget.checked)} />
            <span>
              <strong>{room.name}</strong>
              <small>{m.central_climate_include()}</small>
            </span>
          </label>
          <label class="central-climate-delta">
            <span>{m.central_climate_delta()}</span>
            <span class="central-climate-delta-input">
              <input type="number" min="-10" max="10" step="0.5"
                     disabled={!included} value={centralRoomDelta(room.id)}
                     onchange={(event) => setCentralRoomDelta(room.id, event.currentTarget.valueAsNumber)} />
              <span>°C</span>
            </span>
          </label>
        </div>
      {/each}
    </div>
    <p class="central-climate-note">{m.central_climate_delta_hint()}</p>
  {/if}
</div>

<style>
  /* Die Karte steht in einer breiten Sektion (Einstellungen) wie in einem
     schmalen Overlay (Phone). Überall dürfen die Spuren unter ihre
     Inhaltsbreite schrumpfen, sonst laufen Auswahl und Delta-Feld heraus. */
  .central-climate-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-0);
  }

  .central-climate-source,
  .central-climate-rooms {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
  }

  .central-climate-select,
  .central-climate-delta input {
    min-height: var(--touch-min);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
  }

  .central-climate-select {
    min-width: 0;
    max-width: 100%;
    padding: 0 var(--space-3);
  }

  .central-climate-room {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }

  .central-climate-check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .central-climate-check input {
    width: var(--icon-md);
    height: var(--icon-md);
    accent-color: var(--color-accent-warm);
  }

  .central-climate-check span {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-1);
  }

  .central-climate-check small,
  .central-climate-note,
  .central-climate-delta > span {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .central-climate-delta {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
  }

  .central-climate-delta-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .central-climate-delta input {
    width: var(--space-8);
    padding: 0 var(--space-2);
    text-align: right;
  }

  .central-climate-note {
    margin: 0;
    line-height: var(--leading-normal);
  }

  @media (max-width: 640px) {
    .central-climate-room { grid-template-columns: minmax(0, 1fr); }
    .central-climate-delta { justify-content: space-between; }
  }
</style>
