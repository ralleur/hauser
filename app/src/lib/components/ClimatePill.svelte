<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import { longpress } from '../actions/longpress.ts';
  import { fmtTemp } from '../format.ts';
  import { openCentralClimateEdit } from '../state/central-climate-overlay.svelte.ts';
  import { whenEditable } from '../state/edit-mode.svelte.ts';
  import { centralClimate } from '../state/climate-central.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  /* Zentrale „Alle Räume"-Steuerung als Pille: links/rechts symmetrische
     Rundtasten, mittig genau ein dominanter Wert, darunter der zurückgenommene
     Ist-Wert hinter einer feinen Trennlinie. Den Bereich nennt nur noch das
     aria-Label — sichtbar würde er die Bottom-Leiste unnötig hoch machen.
     Panel (TabBar) und Phone teilen sich dieselbe Fassung; nur die Umgebung
     setzt die Breite. */
  let { label, coolerLabel, warmerLabel }: {
    label: string; coolerLabel: string; warmerLabel: string;
  } = $props();
</script>

<div class="climate-dock" aria-label={label}>
  <button class="cd-key cd-key-down pressable" type="button" aria-label={coolerLabel}
          onclick={() => centralClimate.step(-0.5)}><Icon name="i-minus" cls="icon cd-step-icon" /></button>

  <!-- Long-Press öffnet die zentrale Klimasteuerung. Er hängt an der Lesezone,
       nicht an der ganzen Pille: auf den Schritt-Tasten würde ein längerer
       Druck sonst die Konfiguration öffnen statt zu schalten. -->
  <div class="cd-readout" use:longpress={{ onLongPress: whenEditable(openCentralClimateEdit) }}>
    <span class="cd-value num" class:is-mixed={!centralClimate.isSynced}>{fmtTemp(centralClimate.value)}°</span>
    <p class="cd-current">
      <Icon name="i-thermometer" cls="icon cd-current-icon" />
      <span class="cd-current-label">{m.climate_current()}</span>
      <span class="cd-current-value num">
        {centralClimate.currentValue === null ? '–' : `${fmtTemp(centralClimate.currentValue)}°`}
      </span>
    </p>
  </div>

  <button class="cd-key cd-key-up pressable" type="button" aria-label={warmerLabel}
          onclick={() => centralClimate.step(0.5)}><Icon name="i-plus" cls="icon cd-step-icon" /></button>
</div>
