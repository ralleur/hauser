<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script module lang="ts">
  /* Was in dieser Sitzung gespeichert wurde. `ENERGY_SENSORS` kennt den neuen
     Stand erst nach dem Neuladen — wer die Sektion verließ und zurückkam, sah
     sonst wieder die alte Auswahl und hielt das Speichern für wirkungslos. */
  let savedSelection: { production: string[]; consumption: string[] } | null = null;
</script>

<script lang="ts">
  /* ── Energie · Entitäten ──
     Welche Home-Assistant-Sensoren die Energie-Seite füllt: beliebig viele
     Erzeuger (ihre Leistungen werden summiert), beliebig viele Verbraucher. Vorgeschlagen wird alles, was
     Home Assistant an Leistungssensoren meldet (device_class `power` bzw.
     Einheit W/kW) — wer nichts einstellt, sieht also alles.

     Geschrieben wird über `PUT /api/household-energy`, ETag-gesichert wie der
     Modulschalter; die Energie-Seite liest die Auswahl beim nächsten Start. */
  import { deviceManager } from '../../state/device-manager.svelte.ts';
  import { ENERGY_SENSORS } from '../../config/household-runtime-data.ts';
  import { energyRefIds } from '../../config/legacy-household-data.ts';
  import { settingsUi } from '../../state/settings.svelte.ts';
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
    savedSelection?.consumption
      ?? ENERGY_SENSORS.load.map((load) => (typeof load === 'string' ? load : load.entityId)),
  );
  const configured = savedSelection !== null || storedConsumption.size > 0 || Boolean(ENERGY_SENSORS.pv);

  let production = $state(new Set(savedSelection?.production ?? energyRefIds(ENERGY_SENSORS.pv)));
  let consumption = $state(storedConsumption);
  let busy = $state(false);
  let result = $state<'saved' | 'failed' | 'too-many' | null>(null);
  let maxLoads = $state(0);

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

  function toggleProduction(entityId: string): void {
    const next = new Set(production);
    if (next.has(entityId)) next.delete(entityId);
    else next.add(entityId);
    production = next;
    result = null;
  }

  function selectAll(): void {
    consumption = new Set(powerEntities.map((entity) => entity.entityId));
    result = null;
  }

  async function save(): Promise<void> {
    busy = true;
    result = null;
    const selected = powerEntities
      .filter((entity) => consumption.has(entity.entityId) && !production.has(entity.entityId))
      .map((entity) => ({ entityId: entity.entityId, name: entity.name }));
    const producers = powerEntities.filter((entity) => production.has(entity.entityId)).map((entity) => entity.entityId);
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
        body: JSON.stringify({ production: producers.length === 0 ? null : producers.length === 1 ? producers[0] : producers, consumption: selected }),
      });
      if (!response.ok) {
        /* Der Server kennt seine Grenze; die Oberfläche soll sie nennen statt
           nur „konnte nicht gespeichert werden" zu sagen. */
        const payload = await response.json().catch(() => null) as { code?: unknown; max?: unknown } | null;
        if (payload?.code === 'ENERGY_TOO_MANY_LOADS') {
          maxLoads = typeof payload.max === 'number' ? payload.max : 0;
          result = 'too-many';
          return;
        }
        throw new Error('ENERGY_WRITE_FAILED');
      }
      savedSelection = { production: producers, consumption: selected.map((entity) => entity.entityId) };
      /* Die Energie-Seite liest ihre Sensoren beim Start — wie beim
         Modulschalter sagt der Hinweis oben, dass ein Neuladen ansteht. */
      settingsUi.needsReload = true;
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
  <div class="energy-entity-list" role="group" aria-label={m.sys_energy_production()}>
    {#each powerEntities as entity (entity.entityId)}
      <label class="energy-entity">
        <input type="checkbox" checked={production.has(entity.entityId)}
               onchange={() => toggleProduction(entity.entityId)} />
        <span>
          <strong>{entity.name}</strong>
          <small class="num">{entity.entityId}</small>
        </span>
      </label>
    {/each}
  </div>
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
               disabled={production.has(entity.entityId)}
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
  {:else if result === 'too-many'}
    <p class="settings-form-msg is-error" role="alert">{m.sys_energy_too_many({ max: maxLoads })}</p>
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
