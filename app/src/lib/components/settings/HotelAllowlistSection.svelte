<script lang="ts">
  /* ── Einstellungen · Gastfreigaben ──
     Räume und Geräte werden ausgewählt, nicht getippt: die Liste kommt aus der
     Haushaltskonfiguration, und pro Gerät stehen nur die Aktionen zur Wahl, die
     das vorhandene Hauser-Control wirklich sendet. Neue HA-Entities sind damit
     nie automatisch freigegeben.

     Szenen und Skripte werden ausdrücklich und getrennt freigegeben. */
  import { onMount } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { HOUSEHOLD_RUNTIME_MODEL } from '../../config/household-runtime-data.ts';
  import { hotelSettings, loadHotelSettings, saveHotelMode } from '../../state/hotel-settings.svelte.ts';
  import {
    allowlistDraftFromConfig,
    allowlistDraftToConfig,
    allowlistOptions,
    allowlistSummary,
    emptyAllowlistDraft,
    entityDraft,
    isEntitySelected,
    setTemperatureBound,
    toggleAction,
    toggleEntity,
    toggleReleasedEntityId,
    validateAllowlistDraft,
    type HotelAllowlistDraft,
    type HotelAllowlistEntityOption,
    type HotelAllowlistIssue,
  } from './hotel-mode-allowlist.ts';

  let draft = $state<HotelAllowlistDraft>(emptyAllowlistDraft());
  let sceneInput = $state('');
  let scriptInput = $state('');
  let saved = $state(false);

  const options = allowlistOptions(HOUSEHOLD_RUNTIME_MODEL);
  const issues = $derived(validateAllowlistDraft(draft, options));
  const effective = $derived(allowlistDraftToConfig(draft, options));
  const summary = $derived(allowlistSummary(effective, options));

  onMount(() => {
    void loadHotelSettings().then(() => {
      draft = allowlistDraftFromConfig(hotelSettings.hotelMode?.guestAccess);
    });
  });

  function issueText(issue: HotelAllowlistIssue): string {
    switch (issue.code) {
      case 'NO_ACTION': return m.settings_hotel_access_issue_action();
      case 'RANGE_REQUIRED': return m.settings_hotel_access_issue_range_required();
      case 'RANGE_INVALID': return m.settings_hotel_access_issue_range_invalid();
      case 'RANGE_ORDER': return m.settings_hotel_access_issue_range_order();
      case 'RANGE_NOT_ALLOWED': return m.settings_hotel_access_issue_range_extra();
    }
  }

  function actionLabel(action: string): string {
    switch (action) {
      case 'turn_on': return m.settings_hotel_action_turn_on();
      case 'turn_off': return m.settings_hotel_action_turn_off();
      case 'set_temperature': return m.settings_hotel_action_set_temperature();
      case 'set_hvac_mode': return m.settings_hotel_action_set_hvac_mode();
      case 'start': return m.settings_hotel_action_start();
      default: return m.settings_hotel_action_return();
    }
  }

  function addReleased(kind: 'scenes' | 'scripts'): void {
    const value = (kind === 'scenes' ? sceneInput : scriptInput).trim();
    const domain = kind === 'scenes' ? 'scene' : 'script';
    if (!new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(value)) return;
    draft = { ...draft, [kind]: toggleReleasedEntityId(draft[kind], value) };
    if (kind === 'scenes') sceneInput = '';
    else scriptInput = '';
  }

  async function save(): Promise<void> {
    const current = hotelSettings.hotelMode;
    if (!current || issues.length > 0) return;
    saved = await saveHotelMode({ ...current, guestAccess: effective });
    if (saved) draft = allowlistDraftFromConfig(hotelSettings.hotelMode?.guestAccess);
  }
</script>

<section data-setting-id="hotel-guest-access" aria-labelledby="settings-hotel-access-title">
  <div class="settings-group">
    <SettingsCardHead icon="i-account-key" tint="warm"
                      title={m.settings_hotel_access()} sub={m.settings_hotel_access_hint()} />
  </div>
  <span id="settings-hotel-access-title" hidden>{m.settings_hotel_access()}</span>

  {#if hotelSettings.error}
    <p class="settings-form-msg is-error" role="alert">{hotelSettings.error}</p>
  {/if}

  {#each options as room (room.roomId)}
    <div class="settings-group">
      <SettingsCardHead icon="i-home" tint="neutral" title={room.name} />
      {#each room.entities as option (option.entityId)}
        {@const selected = isEntitySelected(draft, room.roomId, option.entityId)}
        {@const entity = entityDraft(draft, room.roomId, option.entityId)}
        <div class="settings-row">
          <div class="settings-row-text">
            <span class="settings-row-label">{option.name}</span>
            <span class="settings-row-sub num">{option.entityId}</span>
          </div>
          <button class="settings-switch pressable" type="button" role="switch"
                  aria-checked={selected} aria-label={option.name}
                  onclick={() => { draft = toggleEntity(draft, room.roomId, option); }}>
            <span class="settings-switch-knob"></span>
          </button>
        </div>

        {#if selected && entity}
          <div class="hotel-actions">
            {#each option.supportedActions as action (action)}
              <label class="hotel-action">
                <input type="checkbox" checked={entity.actions.includes(action)}
                       onchange={() => { draft = toggleAction(draft, room.roomId, option, action); }} />
                <span>{actionLabel(action)}</span>
              </label>
            {/each}
          </div>
          {#if option.supportsTemperatureRange && entity.actions.includes('set_temperature')}
            <div class="hotel-range">
              <label class="hotel-field">
                <span class="settings-row-label">{m.settings_hotel_range_min()}</span>
                <input class="settings-input num" type="number" step="0.5" value={entity.min}
                       oninput={(event) => {
                         draft = setTemperatureBound(draft, room.roomId, option.entityId, 'min', event.currentTarget.value);
                       }} />
              </label>
              <label class="hotel-field">
                <span class="settings-row-label">{m.settings_hotel_range_max()}</span>
                <input class="settings-input num" type="number" step="0.5" value={entity.max}
                       oninput={(event) => {
                         draft = setTemperatureBound(draft, room.roomId, option.entityId, 'max', event.currentTarget.value);
                       }} />
              </label>
            </div>
          {/if}
        {/if}
      {/each}
    </div>
  {/each}

  <!-- ── Szenen und Skripte, ausdrücklich und getrennt ── -->
  <div class="settings-group" data-setting-id="hotel-scenes">
    <SettingsCardHead icon="i-palette" tint="cool"
                      title={m.settings_hotel_scenes()} sub={m.settings_hotel_scenes_hint()} />
    <div class="hotel-add">
      <input class="settings-input num" placeholder="scene.apartment_evening" autocomplete="off"
             spellcheck="false" bind:value={sceneInput} />
      <button class="secondary-btn pressable" type="button" onclick={() => addReleased('scenes')}>
        {m.settings_hotel_release_add()}
      </button>
    </div>
    {#each draft.scenes as scene (scene)}
      <div class="settings-row">
        <div class="settings-row-text"><span class="settings-row-label num">{scene}</span></div>
        <button class="secondary-btn pressable" type="button"
                onclick={() => { draft = { ...draft, scenes: toggleReleasedEntityId(draft.scenes, scene) }; }}>
          {m.settings_hotel_release_remove()}
        </button>
      </div>
    {/each}

    <div class="hotel-add">
      <input class="settings-input num" placeholder="script.apartment_help" autocomplete="off"
             spellcheck="false" bind:value={scriptInput} />
      <button class="secondary-btn pressable" type="button" onclick={() => addReleased('scripts')}>
        {m.settings_hotel_release_add()}
      </button>
    </div>
    {#each draft.scripts as script (script)}
      <div class="settings-row">
        <div class="settings-row-text"><span class="settings-row-label num">{script}</span></div>
        <button class="secondary-btn pressable" type="button"
                onclick={() => { draft = { ...draft, scripts: toggleReleasedEntityId(draft.scripts, script) }; }}>
          {m.settings_hotel_release_remove()}
        </button>
      </div>
    {/each}
  </div>

  {#if issues.length > 0}
    <ul class="hotel-blockers" role="alert" data-testid="hotel-access-issues">
      {#each issues as issue (issue.roomId + issue.entityId + issue.code)}
        <li>{issue.entityId}: {issueText(issue)}</li>
      {/each}
    </ul>
  {/if}

  <footer class="hotel-save">
    <button class="primary-btn pressable" type="button"
            disabled={issues.length > 0 || hotelSettings.busy || hotelSettings.hotelMode === null}
            onclick={save}>{m.settings_hotel_access_save()}</button>
    {#if saved}<span class="settings-form-msg" role="status">{m.settings_hotel_saved()}</span>{/if}
  </footer>

  <!-- ── Effektive Gastfreigabe ── -->
  <div class="settings-group" data-setting-id="hotel-preview">
    <SettingsCardHead icon="i-eye" tint="cool"
                      title={m.settings_hotel_preview()} sub={m.settings_hotel_preview_hint()} />
    <p class="settings-form-msg" data-testid="hotel-guest-preview">
      {summary.rooms.length} · {summary.entityCount} · {summary.scenes.length + summary.scripts.length}
    </p>
    {#each summary.rooms as room (room.roomId)}
      <div class="settings-row">
        <div class="settings-row-text">
          <span class="settings-row-label">{room.name}</span>
          {#each room.entities as entity (entity.entityId)}
            <span class="settings-row-sub num">
              {entity.name}: {entity.actions.map(actionLabel).join(', ')}
              {#if entity.temperatureRange}({entity.temperatureRange.min}–{entity.temperatureRange.max} °C){/if}
            </span>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .hotel-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    padding: 0 var(--space-4) var(--space-3) var(--space-4);
  }

  .hotel-action {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .hotel-range,
  .hotel-add {
    display: flex;
    gap: var(--space-3);
    align-items: flex-end;
    padding: 0 var(--space-4) var(--space-3) var(--space-4);
  }

  .hotel-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .hotel-blockers {
    margin: 0;
    padding: var(--space-2) var(--space-4) var(--space-3) var(--space-7);
    color: var(--color-error);
    font-size: var(--text-xs);
  }

  .hotel-save {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
</style>
