<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { LAUNDRY_ENTITIES } from '../../state/entities.ts';
  import { deviceManager } from '../../state/device-manager.svelte.ts';
  import { settingsUi } from '../../state/settings.svelte.ts';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import {
    LaundrySettingsController,
    type LaundryCardState,
    type LaundryDevice,
    type LaundryUserError,
  } from '../../state/laundry-settings.ts';

  const COMPATIBLE_DOMAINS = new Set(['input_boolean', 'binary_sensor', 'sensor', 'input_select', 'select']);

  let cards = $state<Record<LaundryDevice, LaundryCardState>>({} as Record<LaundryDevice, LaundryCardState>);
  const controller = new LaundrySettingsController(
    { washer: LAUNDRY_ENTITIES.washer, dryer: LAUNDRY_ENTITIES.dryer },
    fetch,
    (device, state) => {
      cards[device] = state;
      if (state.phase === 'success') settingsUi.needsReload = true;
    },
  );
  cards.washer = controller.state('washer');
  cards.dryer = controller.state('dryer');

  function compatibleSources() {
    return deviceManager.catalog.filter((source) => COMPATIBLE_DOMAINS.has(source.domain));
  }

  function powerSources() {
    return deviceManager.catalog.filter((source) => source.domain === 'sensor');
  }

  function titleFor(device: LaundryDevice): string {
    return device === 'washer' ? m.settings_laundry_washer() : m.settings_laundry_dryer();
  }

  function errorText(error: LaundryUserError): string {
    if (error.kind === 'invalid') {
      switch (error.field) {
        case 'entityId': return m.settings_laundry_invalid_entity();
        case 'statesRequired': return m.settings_laundry_states_required();
        case 'statesOverlap': return m.settings_laundry_states_overlap();
        case 'statesInvalid': return m.settings_laundry_states_invalid();
        case 'powerSensorEntityId': return m.settings_laundry_power_entity_invalid();
        case 'thresholdNumber': return m.settings_laundry_threshold_invalid();
        case 'thresholdOrder': return m.settings_laundry_threshold_order();
        case 'holdRange': return m.settings_laundry_hold_invalid();
        default: return m.settings_laundry_error_invalid();
      }
    }
    switch (error.kind) {
      case 'sourceChanged': return m.settings_laundry_error_source_changed();
      case 'sourceIncompatible': return m.settings_laundry_error_source_incompatible();
      case 'configChanged': return m.settings_laundry_error_config_changed();
      case 'haNotConfigured': return m.settings_laundry_error_ha_not_configured();
      case 'haAuth': return m.settings_laundry_error_ha_auth();
      case 'haUnreachable': return m.settings_laundry_error_ha_unreachable();
      case 'haTimeout': return m.settings_laundry_error_ha_timeout();
      case 'confirmationExpired': return m.settings_laundry_error_confirmation_expired();
      case 'targetConflict': return m.settings_laundry_error_target_conflict();
      case 'verificationFailed': return m.settings_laundry_error_verification();
      case 'partialFailure': return m.settings_laundry_error_partial_failure();
      case 'outcomeUnknown': return m.settings_laundry_error_outcome_unknown();
      default: return m.settings_laundry_error_generic();
    }
  }

  function isBusy(card: LaundryCardState): boolean {
    return card.phase === 'validating' || card.phase === 'applying';
  }

  async function runPrimary(device: LaundryDevice): Promise<void> {
    const card = controller.state(device);
    if (card.phase === 'preview') await controller.apply(device);
    else if (card.phase === 'error') await controller.retry(device);
    else await controller.preview(device);
  }

  function primaryLabel(card: LaundryCardState): string {
    if (card.phase === 'preview') return m.settings_laundry_confirm_apply();
    if (card.phase === 'error') return m.settings_laundry_retry_preview();
    if (!card.draft.enabled) return m.settings_laundry_preview_disable();
    return m.settings_laundry_preview_change();
  }
</script>

{#snippet remainingDetails(error: LaundryUserError)}
  {#if (error.kind === 'partialFailure' || error.kind === 'outcomeUnknown') && error.remaining}
    <div class="laundry-remaining">
      <strong>{m.settings_laundry_remaining_title()}</strong>
      {#if error.remaining.automationId}<span>{m.settings_laundry_automation_id()}: <code>{error.remaining.automationId}</code></span>{/if}
      {#if error.remaining.inputSelectId}<span>{m.settings_laundry_helper_id()}: <code>{error.remaining.inputSelectId}</code></span>{/if}
      {#if error.remaining.blueprintPath}<span>{m.settings_laundry_blueprint_path()}: <code>{error.remaining.blueprintPath}</code></span>{/if}
    </div>
  {/if}
{/snippet}

{#snippet previewDetails(card: LaundryCardState)}
  {#if card.preview?.kind === 'existing'}
    <div class="laundry-confirm" role="status">
      <h5>{m.settings_laundry_existing_preview_title()}</h5>
      <dl>
        <div><dt>{m.settings_laundry_preview_device()}</dt><dd>{titleFor(card.device)}</dd></div>
        <div><dt>{m.settings_laundry_preview_source()}</dt><dd>{card.preview.source.name}<code>{card.preview.source.entityId}</code></dd></div>
        <div><dt>{m.settings_laundry_preview_adapter()}</dt><dd>{m.settings_laundry_entity_adapter()}</dd></div>
        <div><dt>{m.settings_laundry_running_states()}</dt><dd><code>{card.preview.adapter.runningStates.join(', ')}</code></dd></div>
        <div><dt>{m.settings_laundry_done_states()}</dt><dd><code>{card.preview.adapter.doneStates.join(', ')}</code></dd></div>
        <div><dt>{m.settings_laundry_preview_restart()}</dt><dd>{card.preview.adapter.doneOnInitial ? m.settings_laundry_restart_done_yes() : m.settings_laundry_restart_done_no()}</dd></div>
      </dl>
    </div>
  {:else if card.preview?.kind === 'disable'}
    <div class="laundry-confirm" role="status">
      <h5>{m.settings_laundry_disable_preview_title()}</h5>
      <dl>
        <div><dt>{m.settings_laundry_preview_device()}</dt><dd>{titleFor(card.device)}</dd></div>
        <div><dt>{m.settings_laundry_preview_adapter()}</dt><dd><code>{card.preview.adapter.entityId}</code></dd></div>
      </dl>
      <p class="settings-form-msg is-warning">{m.settings_laundry_disable_no_delete()}</p>
    </div>
  {:else if card.preview?.kind === 'blueprint'}
    <div class="laundry-confirm" role="status">
      <h5>{m.settings_laundry_blueprint_preview_title()}</h5>
      <dl>
        <div><dt>{m.settings_laundry_preview_device()}</dt><dd>{titleFor(card.device)}</dd></div>
        <div><dt>{m.settings_laundry_blueprint_path()}</dt><dd><code>{card.preview.blueprint.path}</code></dd></div>
        <div><dt>{m.settings_laundry_helper_name()}</dt><dd>{card.preview.helper.name}</dd></div>
        <div><dt>{m.settings_laundry_helper_options()}</dt><dd><code>{card.preview.helper.options.join(', ')}</code></dd></div>
        <div><dt>{m.settings_laundry_helper_entity()}</dt><dd>{m.settings_laundry_assigned_by_ha()}</dd></div>
        <div><dt>{m.settings_laundry_automation_id()}</dt><dd><code>{card.preview.automation.id}</code></dd></div>
        <div><dt>{m.settings_laundry_automation_alias()}</dt><dd>{card.preview.automation.alias}</dd></div>
        <div><dt>{m.settings_laundry_automation_expected()}</dt><dd><code>{card.preview.automation.expectedEntityId}</code> · {m.settings_laundry_expected_only()}</dd></div>
        <div><dt>{m.settings_laundry_power_entity()}</dt><dd><code>{card.preview.inputs.powerSensorEntityId}</code></dd></div>
        <div><dt>{m.settings_laundry_power_unit()}</dt><dd><code>{card.preview.inputs.unitOfMeasurement}</code></dd></div>
        <div><dt>{m.settings_laundry_start_threshold()}</dt><dd class="num">{card.preview.inputs.startThreshold} {card.preview.inputs.unitOfMeasurement}</dd></div>
        <div><dt>{m.settings_laundry_end_threshold()}</dt><dd class="num">{card.preview.inputs.endThreshold} {card.preview.inputs.unitOfMeasurement}</dd></div>
        <div><dt>{m.settings_laundry_start_hold()}</dt><dd class="num">{card.preview.inputs.startHoldSeconds} s</dd></div>
        <div><dt>{m.settings_laundry_end_hold()}</dt><dd class="num">{card.preview.inputs.endHoldSeconds} s</dd></div>
      </dl>
      <p class="settings-form-msg is-warning">{m.settings_laundry_blueprint_write_warning()}</p>
    </div>
  {/if}
{/snippet}

{#snippet resultDetails(card: LaundryCardState)}
  {#if card.phase === 'success' && card.result}
    <div class="laundry-result" role="status">
      {#if card.result.kind === 'existing'}
        <strong>{m.settings_laundry_success_existing()}</strong>
        <span>{m.settings_laundry_saved_entity()}: <code>{card.result.entityId}</code></span>
      {:else if card.result.kind === 'disabled'}
        <strong>{m.settings_laundry_success_disabled()}</strong>
      {:else}
        <strong>{m.settings_laundry_success_blueprint()}</strong>
        <span>{m.settings_laundry_helper_entity()}: <code>{card.result.helper.entityId}</code></span>
        <span>{m.settings_laundry_automation_entity()}: <code>{card.result.automation.entityId}</code></span>
        <span>{m.settings_laundry_blueprint_path()}: <code>{card.result.blueprint.path}</code></span>
      {/if}
      <p>{m.settings_laundry_reload_required()}</p>
    </div>
  {/if}
{/snippet}

{#snippet laundryCard(kind: LaundryDevice, card: LaundryCardState)}
  <form class="laundry-card" aria-labelledby="laundry-{kind}-title" onsubmit={(event) => { event.preventDefault(); void runPrimary(kind); }}>
    <header class="laundry-card-head">
      <div class="settings-row-text">
        <h4 id="laundry-{kind}-title" class="settings-row-label">{titleFor(kind)}</h4>
        <span class="settings-row-sub">{m.settings_laundry_device_hint()}</span>
      </div>
      <button
        class="settings-switch pressable"
        type="button"
        role="switch"
        aria-label={`${titleFor(kind)}: ${m.settings_laundry_enabled()}`}
        aria-checked={card.draft.enabled}
        disabled={isBusy(card)}
        onclick={() => controller.setEnabled(kind, !card.draft.enabled)}
      >
        <span class="settings-switch-knob"></span>
      </button>
    </header>

    {#if card.phase !== 'success'}
      {#if card.currentAdapter}
        <p class="settings-form-msg laundry-current">
          {m.settings_laundry_current_adapter()}: <code>{card.currentAdapter.entityId}</code>
        </p>
      {:else}
        <p class="settings-form-msg laundry-current">{m.settings_laundry_current_disabled()}</p>
      {/if}
    {/if}

    {#if card.draft.enabled}
      <fieldset disabled={isBusy(card) || card.phase === 'preview'}>
        <div class="settings-seg" aria-label={m.settings_laundry_setup_mode()}>
          <button
            class="settings-seg-btn"
            class:is-active={card.draft.mode === 'existing'}
            type="button"
            aria-pressed={card.draft.mode === 'existing'}
            onclick={() => controller.setMode(kind, 'existing')}
          >{m.settings_laundry_existing_mode()}</button>
          <button
            class="settings-seg-btn"
            class:is-active={card.draft.mode === 'blueprint'}
            type="button"
            aria-pressed={card.draft.mode === 'blueprint'}
            onclick={() => controller.setMode(kind, 'blueprint')}
          >{m.settings_laundry_blueprint_mode()}</button>
        </div>

        {#if card.draft.mode === 'existing'}
          <label class="laundry-field">
            <span class="settings-row-label">{m.settings_laundry_entity()}</span>
            <input
              class="settings-input num"
              list="laundry-compatible-sources"
              placeholder={m.settings_laundry_entity_placeholder()}
              autocomplete="off"
              spellcheck="false"
              value={card.draft.existing.entityId}
              oninput={(event) => controller.editExisting(kind, { entityId: event.currentTarget.value })}
            />
          </label>

          <div class="laundry-state-grid">
            <label class="laundry-field">
              <span class="settings-row-label">{m.settings_laundry_running_states()}</span>
              <input class="settings-input num" autocomplete="off" spellcheck="false" value={card.draft.existing.runningStates}
                oninput={(event) => controller.editExisting(kind, { runningStates: event.currentTarget.value })} />
            </label>
            <label class="laundry-field">
              <span class="settings-row-label">{m.settings_laundry_done_states()}</span>
              <input class="settings-input num" autocomplete="off" spellcheck="false" value={card.draft.existing.doneStates}
                oninput={(event) => controller.editExisting(kind, { doneStates: event.currentTarget.value })} />
            </label>
          </div>
          <p class="settings-form-msg">{m.settings_laundry_states_hint()}</p>

          <label class="laundry-check">
            <input type="checkbox" checked={card.draft.existing.doneOnInitial}
              onchange={(event) => controller.editExisting(kind, { doneOnInitial: event.currentTarget.checked })} />
            <span>{m.settings_laundry_done_initial()}</span>
          </label>
        {:else}
          <label class="laundry-field">
            <span class="settings-row-label">{m.settings_laundry_power_entity()}</span>
            <input
              class="settings-input num"
              list="laundry-power-sources"
              placeholder={m.settings_laundry_power_placeholder()}
              autocomplete="off"
              spellcheck="false"
              value={card.draft.blueprint.powerSensorEntityId}
              oninput={(event) => controller.editBlueprint(kind, { powerSensorEntityId: event.currentTarget.value })}
            />
          </label>
          <div class="laundry-number-grid">
            <label class="laundry-field">
              <span class="settings-row-label">{m.settings_laundry_start_threshold()}</span>
              <input class="settings-input num" type="number" min="-1000000" max="1000000" step="any"
                value={card.draft.blueprint.startThreshold}
                oninput={(event) => controller.editBlueprint(kind, { startThreshold: event.currentTarget.valueAsNumber })} />
            </label>
            <label class="laundry-field">
              <span class="settings-row-label">{m.settings_laundry_end_threshold()}</span>
              <input class="settings-input num" type="number" min="-1000000" max="1000000" step="any"
                value={card.draft.blueprint.endThreshold}
                oninput={(event) => controller.editBlueprint(kind, { endThreshold: event.currentTarget.valueAsNumber })} />
            </label>
            <label class="laundry-field">
              <span class="settings-row-label">{m.settings_laundry_start_hold()}</span>
              <input class="settings-input num" type="number" min="1" max="3600" step="1"
                value={card.draft.blueprint.startHoldSeconds}
                oninput={(event) => controller.editBlueprint(kind, { startHoldSeconds: event.currentTarget.valueAsNumber })} />
            </label>
            <label class="laundry-field">
              <span class="settings-row-label">{m.settings_laundry_end_hold()}</span>
              <input class="settings-input num" type="number" min="1" max="3600" step="1"
                value={card.draft.blueprint.endHoldSeconds}
                oninput={(event) => controller.editBlueprint(kind, { endHoldSeconds: event.currentTarget.valueAsNumber })} />
            </label>
          </div>
          <p class="settings-form-msg">{m.settings_laundry_blueprint_fields_hint()}</p>
        {/if}
      </fieldset>
    {/if}

    {@render previewDetails(card)}
    {@render resultDetails(card)}

    {#if card.phase === 'validating'}
      <p class="settings-form-msg" role="status">{m.settings_laundry_validating()}</p>
    {:else if card.phase === 'applying'}
      <p class="settings-form-msg" role="status">{m.settings_laundry_applying()}</p>
    {:else if card.error}
      <div class="settings-form-msg is-error" role="alert">
        <span>{errorText(card.error)}</span>
        {@render remainingDetails(card.error)}
      </div>
    {/if}

    <footer class="laundry-save">
      <button
        class="primary-btn pressable"
        type="submit"
        disabled={isBusy(card) || (!card.draft.enabled && card.currentAdapter === null)}
      >{primaryLabel(card)}</button>
      {#if card.phase === 'preview'}
        <button class="secondary-btn pressable" type="button" onclick={() => controller.cancel(kind)}>
          {m.settings_laundry_cancel_preview()}
        </button>
      {/if}
    </footer>
  </form>
{/snippet}

<section data-setting-id="laundry" aria-labelledby="settings-laundry-title">
  <div class="settings-group">
    <SettingsCardHead icon="i-washing-machine" tint="warm"
                      title={m.settings_laundry_title()} sub={m.settings_laundry_intro()} />
  </div>
  <span id="settings-laundry-title" hidden>{m.settings_laundry_title()}</span>

  <datalist id="laundry-compatible-sources">
    {#each compatibleSources() as source (source.entityId)}
      <option value={source.entityId}>{source.name} · {source.entityId}</option>
    {/each}
  </datalist>
  <datalist id="laundry-power-sources">
    {#each powerSources() as source (source.entityId)}
      <option value={source.entityId}>{source.name} · {source.entityId}</option>
    {/each}
  </datalist>

  <div class="laundry-cards">
    {@render laundryCard('washer', cards.washer)}
    {@render laundryCard('dryer', cards.dryer)}
  </div>
</section>

<style>
  .laundry-cards {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4);
  }

  .laundry-card {
    display: flex;
    flex: 1 1 calc(var(--grid-padding) * 8);
    flex-direction: column;
    gap: var(--space-4);
    min-width: min(100%, calc(var(--grid-padding) * 8));
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-surface-1);
  }

  .laundry-card-head,
  .laundry-save,
  .laundry-check {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .laundry-card-head { justify-content: space-between; }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  fieldset:disabled { opacity: 0.55; }

  .laundry-field,
  .laundry-result,
  .laundry-remaining {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .laundry-state-grid,
  .laundry-number-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(calc(var(--grid-padding) * 4), 1fr));
    gap: var(--space-3);
  }

  .laundry-check {
    min-height: var(--touch-min);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .laundry-check input { accent-color: var(--color-accent-warm); }

  .laundry-current { margin: 0; }

  .laundry-confirm,
  .laundry-result {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
  }

  .laundry-confirm h5 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .laundry-confirm dl {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
  }

  .laundry-confirm dl div {
    display: grid;
    grid-template-columns: minmax(calc(var(--grid-padding) * 3), 1fr) 2fr;
    gap: var(--space-3);
  }

  .laundry-confirm dt { color: var(--color-text-secondary); }

  .laundry-confirm dd {
    display: flex;
    min-width: 0;
    margin: 0;
    flex-direction: column;
    overflow-wrap: anywhere;
  }

  code {
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }

  .is-warning { color: var(--color-text-secondary); }

  .laundry-save {
    align-items: flex-start;
    flex-wrap: wrap;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }

  .laundry-save .primary-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
