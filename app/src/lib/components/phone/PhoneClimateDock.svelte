<script lang="ts">
  import Icon from '../Icon.svelte';
  import { centralClimate } from '../../state/climate-central.svelte.ts';
  import { fmtTemp } from '../../format.ts';
  import { currentClimateTemperature, type PhoneRoomSummary } from '../../state/phone-home.ts';
  import { m } from '../../../paraglide/messages.js';

  let { rooms }: { rooms: readonly PhoneRoomSummary[] } = $props();
  const currentTemperature = $derived(currentClimateTemperature(rooms));
</script>

<div class="climate-dock phone-climate-dock" aria-label="Zentrale Klimasteuerung, alle Räume">
  <button class="cd-key cd-key-down pressable" type="button" aria-label="Alle Räume 0,5 Grad kälter"
          onclick={() => centralClimate.step(-0.5)}><Icon name="i-chevron-down" cls="icon cd-chevron" /></button>
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
  <button class="cd-key cd-key-up pressable" type="button" aria-label="Alle Räume 0,5 Grad wärmer"
          onclick={() => centralClimate.step(0.5)}><Icon name="i-chevron-up" cls="icon cd-chevron" /></button>
</div>
