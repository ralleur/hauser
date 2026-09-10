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
  import { settingsUi, settingsValues } from '../../state/settings.svelte.ts';
  import { resetStored, isCleared, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  let roomImageWizardOpen = $state(false);
  /* Ruf von außen (Meldung antippen): Der Wunsch liegt bereit, bevor diese
     Seite überhaupt existiert — deshalb wird er hier verbraucht, sobald sie
     da ist. */
  $effect(() => {
    if (!settingsUi.pendingRoomImageWizard) return;
    settingsUi.pendingRoomImageWizard = false;
    roomImageWizardOpen = true;
  });
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
          <svg class="rooms-tile-art is-art" viewBox="0 0 64 64" aria-hidden="true">
            <!-- Raumbild-Assistent: ein Zimmer im Rahmen, daneben der Funke,
                 der aus dem Foto ein Hauser-Raumbild macht. Wie beim Signet
                 trägt currentColor die Form (dark hell, light dunkel), der
                 Funke bleibt gold. -->
            <rect x="5" y="11" width="54" height="42" rx="8.5"
                  fill="none" stroke="currentColor" stroke-width="4.4" />
            <path d="M18.5 47.6V32.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" />
            <path d="M12.5 32.5a6 6 0 0 1 12 0z" fill="currentColor" />
            <path d="M28.6 34h14.8a3.2 3.2 0 0 1 3.2 3.2V40H25.4v-2.8a3.2 3.2 0 0 1 3.2-3.2z" fill="currentColor" />
            <rect x="25.5" y="39.6" width="21" height="7.6" rx="3.2" fill="currentColor" />
            <rect x="23.4" y="38.6" width="4.8" height="8.6" rx="2.4" fill="currentColor" />
            <rect x="43.8" y="38.6" width="4.8" height="8.6" rx="2.4" fill="currentColor" />
            <path d="M27.6 47.2v2M44.4 47.2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <path d="M48 15.8c1.25 5 2.35 6.1 7.35 7.35-5 1.25-6.1 2.35-7.35 7.35-1.25-5-2.35-6.1-7.35-7.35 5-1.25 6.1-2.35 7.35-7.35z"
                  fill="var(--color-accent-warm)" />
          </svg>
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
          <svg class="rooms-tile-art is-art" viewBox="0 0 64 64" aria-hidden="true">
            <!-- Bildkatalog: ein Stapel Raumbilder. Die hinteren Blätter sind
                 nur als Ecke zu sehen, das vordere trägt Berg und Sonne. -->
            <defs>
              <clipPath id="rimg-lib-frame">
                <rect x="8.4" y="12.4" width="33.2" height="27.2" rx="5" />
              </clipPath>
            </defs>
            <path d="M49 17v25a7 7 0 0 1-7 7H15" fill="none" stroke="currentColor"
                  stroke-width="4.4" stroke-linecap="round" />
            <path d="M55.5 23.5V49a7 7 0 0 1-7 7H21.5" fill="none" stroke="currentColor"
                  stroke-width="4.4" stroke-linecap="round" />
            <g clip-path="url(#rimg-lib-frame)">
              <path d="M6 40.5 19.5 24.5 27 33.2 31 28.4 44 40.5z" fill="currentColor" />
            </g>
            <rect x="6" y="10" width="38" height="32" rx="7"
                  fill="none" stroke="currentColor" stroke-width="4.4" />
            <circle cx="33.6" cy="21" r="4.6" fill="var(--color-accent-warm)" />
          </svg>
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
  /* Die beiden Raumbild-Symbole sind eigene Zeichnungen ohne Flaeche: sie
     folgen wie das Signet dem Theme (currentColor), der Funke bzw. die Sonne
     bleibt gold. */
  .rooms-tile-art.is-art {
    background: none;
    color: var(--color-text-primary);
  }

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
