<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Icon from '../Icon.svelte';
  import { fmtTemp } from '../../format.ts';
  import { centralClimate } from '../../state/climate-central.svelte.ts';
  import {
    shouldConfirmHomeOff,
    toggleVacationMode,
    turnOffHomeExceptBedroom,
    vacationModeActive,
  } from '../../state/commands.ts';
  import { createPhoneSettingsLoader } from '../../state/phone-lazy-loader.ts';
  import { m } from '../../../paraglide/messages.js';

  let { online, currentTemperature }: { online: boolean; currentTemperature: number | null } = $props();

  const vacationActive = $derived(vacationModeActive());
  const settingsLoader = createPhoneSettingsLoader();

  function finishHomeOff(confirmBefore: string | null): void {
    if (shouldConfirmHomeOff(new Date(), confirmBefore)
      && !window.confirm(m.phone_off_confirm())) return;
    turnOffHomeExceptBedroom();
  }

  function onHomeOff(): void {
    void settingsLoader.load('settings', ({ settingsValues }) => {
      finishHomeOff(settingsValues.offConfirmBefore);
    }).catch(() => {
      if (window.confirm(m.phone_off_confirm_nocfg())) turnOffHomeExceptBedroom();
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
    <div class="climate-dock phone-climate-dock" aria-label={m.phone_climate_central()}>
      <button class="cd-key cd-key-down pressable" type="button" aria-label={m.phone_climate_colder()}
              onclick={() => centralClimate.step(-0.5)}><Icon name="i-minus" cls="icon cd-step-icon" /></button>
      <div class="cd-readout phone-climate-readout">
        <div class="phone-climate-reading">
          <span class="phone-climate-label">{m.climate_current()}</span>
          <span class="phone-climate-current-value num">
            {currentTemperature === null ? '–' : `${fmtTemp(currentTemperature)}°`}
          </span>
        </div>
        <span class="phone-climate-separator" aria-hidden="true"></span>
        <div class="phone-climate-reading">
          <span class="cd-value num" class:is-mixed={!centralClimate.isSynced}>{fmtTemp(centralClimate.value)}°</span>
          <span class="phone-climate-label">{m.climate_target()}</span>
        </div>
      </div>
      <button class="cd-key cd-key-up pressable" type="button" aria-label={m.phone_climate_warmer()}
              onclick={() => centralClimate.step(0.5)}><Icon name="i-plus" cls="icon cd-step-icon" /></button>
    </div>
    <button class="phone-quick-action is-vacation pressable" class:is-active={vacationActive}
            type="button" disabled={!online} aria-pressed={vacationActive}
            aria-label={vacationActive ? m.phone_vacation_off_label() : m.phone_vacation_on_label()}
            onclick={toggleVacationMode}>
      <Icon name="i-umbrella-beach" cls="icon icon-md" />
      <span>{vacationActive ? m.phone_vacation_active() : m.phone_vacation()}</span>
    </button>
  </div>
{/if}
