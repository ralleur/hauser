<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Icon from '../Icon.svelte';
  import ClimatePill from '../ClimatePill.svelte';
  import { centralClimate } from '../../state/climate-central.svelte.ts';
  import {
    shouldConfirmHomeOff,
    switchableHomeEntityIds,
    turnOffHomeExceptBedroom,
  } from '../../state/commands.ts';
  import { longpress } from '../../actions/longpress.ts';
  import { whenEditable } from '../../state/edit-mode.svelte.ts';
  import { openPhoneActionEdit } from '../../state/overlay.svelte.ts';
  import {
    phoneActionActive,
    phoneActionDeviceName,
    phoneActionIcon,
    togglePhoneAction,
  } from '../../state/phone-action.svelte.ts';
  import { offerUndo } from '../../state/undo.svelte.ts';
  import { createPhoneSettingsLoader } from '../../state/phone-lazy-loader.ts';
  import { m } from '../../../paraglide/messages.js';

  let { online }: { online: boolean } = $props();

  /* Der rechte Knopf ist ab Werk der Urlaubsmodus und trägt nach einem
     Long-Press ein beliebiges schaltbares Gerät (phone-action.svelte.ts). */
  const actionActive = $derived(phoneActionActive());
  const actionDevice = $derived(phoneActionDeviceName());
  const actionIcon = $derived(phoneActionIcon());
  const actionLabel = $derived(
    actionDevice ?? (actionActive ? m.phone_vacation_active() : m.phone_vacation()),
  );
  const actionAria = $derived(actionDevice
    ? m.phone_action_toggle_label({ name: actionDevice })
    : actionActive ? m.phone_vacation_off_label() : m.phone_vacation_on_label());
  const settingsLoader = createPhoneSettingsLoader();

  /* Der Befehl geht sofort raus; der Rückgängig-Streifen hält fünf Sekunden
     lang den Weg zurück offen (Paket 6). Die Rückfrage vor der eingestellten
     Uhrzeit bleibt — sie ist eine bewusste Sperre, kein Bestätigungsritual. */
  function homeOffWithUndo(): void {
    offerUndo({ kind: 'all-off' }, switchableHomeEntityIds(), turnOffHomeExceptBedroom);
  }

  function finishHomeOff(confirmBefore: string | null): void {
    if (shouldConfirmHomeOff(new Date(), confirmBefore)
      && !window.confirm(m.phone_off_confirm())) return;
    homeOffWithUndo();
  }

  function onHomeOff(): void {
    void settingsLoader.load('settings', ({ settingsValues }) => {
      finishHomeOff(settingsValues.offConfirmBefore);
    }).catch(() => {
      if (window.confirm(m.phone_off_confirm_nocfg())) homeOffWithUndo();
    });
  }
</script>

{#if centralClimate.hasClimate}
  <div class="phone-quick-actions">
    <button class="phone-quick-action is-off pressable" type="button" disabled={!online}
            aria-label={m.phone_all_off_label()} onclick={onHomeOff}>
      <Icon name="i-power" cls="icon icon-md" />
      <span>{m.phone_off()}</span>
    </button>
    <ClimatePill label={m.phone_climate_central()}
                 coolerLabel={m.phone_climate_colder()}
                 warmerLabel={m.phone_climate_warmer()}
                 {online} />
    <button class="phone-quick-action is-vacation pressable" class:is-active={actionActive}
            type="button" disabled={!online} aria-pressed={actionActive}
            aria-label={actionAria}
            use:longpress={{ onLongPress: whenEditable(openPhoneActionEdit) }}
            onclick={togglePhoneAction}>
      <Icon name={actionIcon} cls="icon icon-md" />
      <span>{actionLabel}</span>
    </button>
  </div>
{/if}
