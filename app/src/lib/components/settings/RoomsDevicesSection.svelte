<script lang="ts">
  /* ── Zuhause · Räume & Geräte ──
     Die Struktur des Zuhauses: Räume und Geräte selbst (Setup-Assistent),
     ihre Bilder, und die Resets, die genau diese Struktur zurücknehmen.

     Die beiden Resets standen vorher unter „Wartung“ — sie betreffen aber
     Gerätenamen, Symbole und Szenen, also das Objekt dieser Sektion. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import SetupWizard from '../SetupWizard.svelte';
  import RoomImageWizard from './RoomImageWizard.svelte';
  import RoomImageLibrary from './RoomImageLibrary.svelte';
  import { ROOM_IMAGE_WIZARD_ENABLED } from '../../config/product-capabilities.ts';
  import { settingsValues } from '../../state/settings.svelte.ts';
  import { resetStored, isCleared, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  let roomImageWizardOpen = $state(false);
  let roomImageLibraryOpen = $state(false);
</script>

<div data-setting-id="household-setup">
  {#if settingsValues.demoMode}
    <p class="settings-empty">{m.sys_demo_no_function_ha()}</p>
  {:else}
    <SetupWizard mode="reconfigure" embedded />
  {/if}
</div>

{#if ROOM_IMAGE_WIZARD_ENABLED}
  <div class="settings-group">
    <SettingsCardHead icon="i-image" tint="warm"
                      title={m.sys_room_images()} sub={m.sys_room_images_hint()} />
    <button class="settings-row settings-action-row pressable" data-setting-id="room-image-wizard" type="button"
            onclick={() => roomImageWizardOpen = true}>
      <span class="settings-row-icon"><Icon name="i-image" cls="icon icon-md" /></span>
      <span class="settings-row-text">
        <span class="settings-row-label">{m.sys_room_images()}</span>
        <span class="settings-row-sub">{m.sys_room_images_hint()}</span>
      </span>
      <Icon name="i-chevron-right" cls="icon icon-md settings-arrow" />
    </button>
    <button class="settings-row settings-action-row pressable" data-setting-id="room-image-library" type="button"
            onclick={() => roomImageLibraryOpen = true}>
      <span class="settings-row-icon"><Icon name="i-image" cls="icon icon-md" /></span>
      <span class="settings-row-text">
        <span class="settings-row-label">{m.rimg_lib_title()}</span>
        <span class="settings-row-sub">{m.rimg_lib_hint()}</span>
      </span>
      <Icon name="i-chevron-right" cls="icon icon-md settings-arrow" />
    </button>
  </div>
{/if}

<div class="settings-group">
  <SettingsCardHead icon="i-restore" tint="warm"
                    title={m.sys_reset()} sub={m.sys_card_reset()} />

  <div class="settings-row" data-setting-id="reset-devices">
    <span class="settings-row-icon"><Icon name="i-restore" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_device_names_icons()}</span>
      <span class="settings-row-sub">{m.sys_device_names_hint()}</span>
    </div>
    <button class="secondary-btn danger-btn pressable" type="button"
            onclick={() => resetStored('reset-devices', ['hmi:device-config', 'hmi:light-icon-overrides'])}>
      {isConfirming('reset-devices') ? m.sys_reset_confirm() : isCleared('reset-devices') ? m.sys_reset_done() : m.sys_reset()}
    </button>
  </div>

  <div class="settings-row" data-setting-id="reset-scenes">
    <span class="settings-row-icon"><Icon name="i-restore" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_scenes()}</span>
      <span class="settings-row-sub">{m.sys_scenes_hint()}</span>
    </div>
    <button class="secondary-btn danger-btn pressable" type="button"
            onclick={() => resetStored('reset-scenes', ['hmi:scene-config'])}>
      {isConfirming('reset-scenes') ? m.sys_reset_confirm() : isCleared('reset-scenes') ? m.sys_reset_done() : m.sys_reset()}
    </button>
  </div>
</div>

{#if ROOM_IMAGE_WIZARD_ENABLED}
  <RoomImageWizard open={roomImageWizardOpen} onclose={() => roomImageWizardOpen = false} />
  <RoomImageLibrary open={roomImageLibraryOpen} onclose={() => roomImageLibraryOpen = false} />
{/if}
