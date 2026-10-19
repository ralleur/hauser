<script lang="ts">
  /* Knopf im Kopf der Klima-Overlays: schaltet die Bedienung des Sollwerts
     reihum — liegender Gliederschieber (Standard), Plus/Minus, stehender
     Gliederschieber wie die Helligkeit (Owner 2026-10-19, Muster der
     Rollo-Kachel). Gilt je Raum, Panel und Telefon gleich. */
  import Icon from './Icon.svelte';
  import { climateControl, cycleClimateControl } from '../state/room-display-config.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  let { roomId }: { roomId: string } = $props();

  const mode = $derived(climateControl(roomId));
  const label = $derived(m.climate_control({
    mode: mode === 'stepper' ? m.climate_control_stepper() : mode === 'vertical' ? m.climate_control_vertical() : m.climate_control_ticks(),
  }));
</script>

<button class="ld-close ld-group pressable" type="button" aria-label={label} title={label}
        onclick={() => cycleClimateControl(roomId)}>
  <Icon name={mode === 'stepper' ? 'i-plus-minus-variant' : mode === 'vertical' ? 'i-arrow-up-down' : 'i-arrow-left-right'} cls="icon icon-md" />
</button>
