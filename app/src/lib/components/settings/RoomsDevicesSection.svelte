<script lang="ts">
  /* ── Zuhause · Räume & Geräte ──
     Die Struktur des Zuhauses: Räume und Geräte selbst (Setup-Assistent),
     ihre Bilder, und die Resets, die genau diese Struktur zurücknehmen.

     Der Assistent rendert die Raumliste und den Speichern-Knopf; die Karten
     darunter reicht diese Sektion als Snippet hinein, damit „Neu einlesen“
     als dritte Reset-Kachel neben den beiden lokalen Resets steht. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import SetupWizard from '../SetupWizard.svelte';
  import RoomImageWizard from './RoomImageWizard.svelte';
  import RoomImageLibrary from './RoomImageLibrary.svelte';
  import CentralClimateConfig from './CentralClimateConfig.svelte';
  import { ROOM_IMAGE_WIZARD_ENABLED } from '../../config/product-capabilities.ts';
  import { settingsValues } from '../../state/settings.svelte.ts';
  import { resetStored, isCleared, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const base = import.meta.env.BASE_URL;

  let roomImageWizardOpen = $state(false);
  let roomImageLibraryOpen = $state(false);
  let rescanConfirming = $state(false);

</script>

{#snippet cards({ rescan, busy = false }: { rescan?: () => void; busy?: boolean })}
  {#if ROOM_IMAGE_WIZARD_ENABLED}
    <div class="settings-group">
      <SettingsCardHead icon="i-image" tint="warm"
                        title={m.sys_room_images()} sub={m.sys_room_images_hint()} />
      <div class="rooms-tile-grid">
        <div class="rooms-tile" data-setting-id="room-image-wizard">
          <img class="rooms-tile-art is-image" src={`${base}wizard/icon.webp`} alt="" loading="lazy" />
          <div class="rooms-tile-text">
            <span class="rooms-tile-title">{m.settings_room_image_wizard_title()}</span>
            <span class="rooms-tile-sub">{m.settings_room_image_wizard_desc()}</span>
          </div>
          <button class="rooms-tile-action is-primary pressable" type="button"
                  onclick={() => roomImageWizardOpen = true}>
            {m.settings_room_image_wizard_action()}
            <Icon name="i-auto-fix" cls="icon icon-sm" />
          </button>
        </div>

        <div class="rooms-tile" data-setting-id="room-image-library">
          <img class="rooms-tile-art is-image" src={`${base}wizard/library-icon.webp`} alt="" loading="lazy" />
          <div class="rooms-tile-text">
            <span class="rooms-tile-title">{m.settings_room_image_library_title()}</span>
            <span class="rooms-tile-sub">{m.rimg_lib_hint()}</span>
          </div>
          <button class="rooms-tile-action pressable" type="button"
                  onclick={() => roomImageLibraryOpen = true}>
            {m.settings_room_image_library_action()}
            <Icon name="i-image-multiple" cls="icon icon-sm" />
          </button>
        </div>
      </div>
    </div>
  {/if}

  <div class="settings-group" data-setting-id="central-climate">
    <SettingsCardHead icon="i-thermometer" tint="warm"
                      title={m.central_climate_settings_title()} sub={m.central_climate_settings_desc()} />
    <CentralClimateConfig />
  </div>

  <div class="settings-group">
    <SettingsCardHead icon="i-restore" tint="warm"
                      title={m.sys_reset()} sub={m.sys_card_reset()} />
    <div class="rooms-tile-grid is-reset">
      <div class="rooms-tile is-compact" data-setting-id="reset-devices">
        <Icon name="i-restore" cls="icon icon-md" />
        <div class="rooms-tile-text">
          <span class="rooms-tile-title">{m.sys_device_names_icons()}</span>
          <span class="rooms-tile-sub">{m.sys_device_names_hint()}</span>
        </div>
        <button class="secondary-btn danger-btn pressable" type="button"
                onclick={() => resetStored('reset-devices', ['hmi:device-config', 'hmi:light-icon-overrides'])}>
          {isConfirming('reset-devices') ? m.sys_reset_confirm() : isCleared('reset-devices') ? m.sys_reset_done() : m.sys_reset()}
        </button>
      </div>

      <div class="rooms-tile is-compact" data-setting-id="reset-scenes">
        <Icon name="i-restore" cls="icon icon-md" />
        <div class="rooms-tile-text">
          <span class="rooms-tile-title">{m.sys_scenes()}</span>
          <span class="rooms-tile-sub">{m.sys_scenes_hint()}</span>
        </div>
        <button class="secondary-btn danger-btn pressable" type="button"
                onclick={() => resetStored('reset-scenes', ['hmi:scene-config'])}>
          {isConfirming('reset-scenes') ? m.sys_reset_confirm() : isCleared('reset-scenes') ? m.sys_reset_done() : m.sys_reset()}
        </button>
      </div>

      {#if rescan}
        <div class="rooms-tile is-compact" data-setting-id="rooms-rescan">
          <Icon name="i-restore" cls="icon icon-md" />
          <div class="rooms-tile-text">
            <span class="rooms-tile-title">{m.settings_rooms_devices_scan_label()}</span>
            <span class="rooms-tile-sub">{m.settings_rooms_devices_scan_desc()}</span>
          </div>
          <button class="secondary-btn danger-btn pressable" type="button" disabled={busy}
                  onclick={() => {
                    if (!rescanConfirming) { rescanConfirming = true; return; }
                    rescanConfirming = false;
                    rescan();
                  }}>
            {rescanConfirming ? m.sys_reset_confirm() : m.sys_reset()}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<div data-setting-id="household-setup">
  {#if settingsValues.demoMode}
    <p class="settings-empty">{m.sys_demo_no_function_ha()}</p>
    {@render cards({})}
  {:else}
    <SetupWizard mode="reconfigure" embedded after={cards} />
  {/if}
</div>

{#if ROOM_IMAGE_WIZARD_ENABLED}
  <RoomImageWizard open={roomImageWizardOpen} onclose={() => roomImageWizardOpen = false} />
  <RoomImageLibrary open={roomImageLibraryOpen} onclose={() => roomImageLibraryOpen = false} />
{/if}

<style>
  .rooms-tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(calc(var(--space-8) * 6), 1fr));
    gap: var(--space-3);
    padding: 0 var(--space-4) var(--space-4);
  }
  .rooms-tile-grid.is-reset {
    grid-template-columns: repeat(auto-fit, minmax(calc(var(--space-8) * 5), 1fr));
  }

  .rooms-tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-0);
  }
  .rooms-tile.is-compact { gap: var(--space-2); }
  .rooms-tile.is-compact :global(.icon) { color: var(--color-text-secondary); }

  .rooms-tile-art {
    display: grid;
    place-items: center;
    width: calc(var(--space-8) * 1.5);
    height: calc(var(--space-8) * 1.5);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-accent-warm) 14%, var(--color-surface-1));
    color: var(--color-accent-warm);
  }
  /* Das Wizard-Symbol ist eine eigene Illustration und bringt seine Flaeche
     selbst mit — deshalb ohne getoenten Hintergrund. */
  .rooms-tile-art.is-image { background: none; object-fit: contain; }

  .rooms-tile-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .rooms-tile-title { font-size: var(--text-base); font-weight: var(--font-weight-semibold); }
  .rooms-tile-sub { color: var(--color-text-secondary); font-size: var(--text-sm); line-height: var(--leading-normal); }

  .rooms-tile-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-min);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
  }
  .rooms-tile-action.is-primary {
    border-color: transparent;
    background: var(--color-accent-warm);
    color: var(--color-text-on-accent);
  }
  .rooms-tile-action.is-primary :global(.icon) { color: var(--color-text-on-accent); }

  /* Die Karte bringt ihre eigene Fassung mit; den Rand zur Sektion setzt der
     Aufrufer — im Overlay füllt sie die Fläche. */
  .settings-group :global(.central-climate-card) {
    margin: 0 var(--space-4) var(--space-4);
  }

</style>
