<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* ── Energie · Entitäten ──
     Welche Home-Assistant-Sensoren die Energie-Seite füllt: eine Quelle für
     die Erzeugung, beliebig viele Verbraucher. Vorgeschlagen wird alles, was
     Home Assistant an Leistungssensoren meldet (device_class `power` bzw.
     Einheit W/kW) — wer nichts einstellt, sieht also alles.

     Geschrieben wird über `PUT /api/household-energy`, ETag-gesichert wie der
     Modulschalter; die Energie-Seite liest die Auswahl beim nächsten Start. */
  import { deviceManager } from '../../state/device-manager.svelte.ts';
  import { ENERGY_SENSORS } from '../../config/household-runtime-data.ts';
  import { m } from '../../../paraglide/messages.js';

  interface PowerEntity { entityId: string; name: string }

  const powerEntities = $derived<PowerEntity[]>(
    deviceManager.catalog
      .filter((item) => item.domain === 'sensor' && isPower(item.deviceClass, item.unit))
      .map((item) => ({ entityId: item.entityId, name: item.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  function isPower(deviceClass?: string | null, unit?: string | null): boolean {
    if (deviceClass === 'power') return true;
    const value = (unit ?? '').trim().toLowerCase();
    return value === 'w' || value === 'kw';
  }

  /* Startauswahl: der gespeicherte Stand, sonst alles Gefundene. */
  const storedConsumption = new Set(
    ENERGY_SENSORS.load.map((load) => (typeof load === 'string' ? load : load.entityId)),
  );
  const configured = storedConsumption.size > 0 || Boolean(ENERGY_SENSORS.pv);

  let production = $state(typeof ENERGY_SENSORS.pv === 'string' ? ENERGY_SENSORS.pv : '');
  let consumption = $state(storedConsumption);
  let busy = $state(false);
  let result = $state<'saved' | 'failed' | null>(null);

  /* Ohne gespeicherte Auswahl steht alles an, sobald der Katalog da ist. */
  $effect(() => {
    if (configured || consumption.size > 0 || powerEntities.length === 0) return;
    consumption = new Set(powerEntities.map((entity) => entity.entityId));
  });

  function toggle(entityId: string): void {
    const next = new Set(consumption);
    if (next.has(entityId)) next.delete(entityId);
    else next.add(entityId);
    consumption = next;
    result = null;
  }

  function selectAll(): void {
    consumption = new Set(powerEntities.map((entity) => entity.entityId));
    result = null;
  }

  async function save(): Promise<void> {
    busy = true;
    result = null;
    try {
      const current = await fetch('/api/household-config', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!current.ok) throw new Error('HOUSEHOLD_CONFIG_UNREACHABLE');
      await current.text();
      const etag = current.headers.get('etag');
      if (!etag) throw new Error('HOUSEHOLD_CONFIG_ETAG_MISSING');
      const response = await fetch('/api/household-energy', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({
          production: production || null,
          consumption: powerEntities
            .filter((entity) => consumption.has(entity.entityId) && entity.entityId !== production)
            .map((entity) => ({ entityId: entity.entityId, name: entity.name })),
        }),
      });
      if (!response.ok) throw new Error('ENERGY_WRITE_FAILED');
      result = 'saved';
    } catch {
      result = 'failed';
    } finally {
      busy = false;
    }
  }
</script>

<div class="settings-row is-stacked" data-setting-id="energy-production">
  <div class="settings-row-text">
    <span class="settings-row-label">{m.sys_energy_production()}</span>
    <span class="settings-row-sub">{m.sys_energy_production_hint()}</span>
  </div>
  <select class="settings-input" aria-label={m.sys_energy_production()}
          bind:value={production} onchange={() => (result = null)}>
    <option value="">{m.sys_energy_none()}</option>
    {#each powerEntities as entity (entity.entityId)}
      <option value={entity.entityId}>{entity.name}</option>
    {/each}
  </select>
</div>

<div class="settings-row is-stacked" data-setting-id="energy-consumption">
  <div class="settings-row-text">
    <span class="settings-row-label">{m.sys_energy_consumption()}</span>
    <span class="settings-row-sub">
      {powerEntities.length === 0
        ? m.sys_energy_empty()
        : m.sys_energy_consumption_hint({ count: consumption.size, total: powerEntities.length })}
    </span>
  </div>
  <div class="energy-entity-list">
    {#each powerEntities as entity (entity.entityId)}
      <label class="energy-entity">
        <input type="checkbox" checked={consumption.has(entity.entityId)}
               disabled={entity.entityId === production}
               onchange={() => toggle(entity.entityId)} />
        <span>
          <strong>{entity.name}</strong>
          <small class="num">{entity.entityId}</small>
        </span>
      </label>
    {/each}
  </div>
  <div class="settings-form-grid">
    <button class="secondary-btn pressable" type="button" disabled={busy || powerEntities.length === 0}
            onclick={selectAll}>{m.sys_energy_select_all()}</button>
    <button class="secondary-btn pressable" type="button" disabled={busy}
            onclick={save}>{m.rem_edit_save()}</button>
  </div>
  {#if result === 'saved'}
    <p class="settings-form-msg is-ok" role="status">{m.sys_module_saved()}</p>
  {:else if result === 'failed'}
    <p class="settings-form-msg is-error" role="alert">{m.sys_module_failed()}</p>
  {/if}
</div>

<style>
  .energy-entity-list {
    display: grid;
    gap: var(--space-1);
    max-height: calc(var(--space-8) * 5);
    overflow-y: auto;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }

  .energy-entity {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-min);
    padding: 0 var(--space-2);
  }

  .energy-entity input {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    accent-color: var(--color-accent-warm);
  }

  .energy-entity span {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .energy-entity small {
    color: var(--color-text-tertiary);
    font-size: var(--text-2xs);
  }
</style>
