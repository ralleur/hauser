<script lang="ts">
  /* Klima-Karte eines Raums: Istwert, Sollwert-Stepper, Betriebsart. Lebt an
     drei Stellen — in der Kontrollfläche des Panels (wenn „Steuerung in der
     Leiste" an ist), im Klima-Overlay des Panels und im Raum-Sheet des
     Telefons. `stacked` ist die einspaltige Panel-Fassung (Istwert über dem
     Sollwert, helle Fläche in Kartenbreite). */
  import '../../styles/room-controls.css';
  import Icon from './Icon.svelte';
  import { HVAC_MODES, type Room } from '../state/app.svelte.ts';
  import { mergedClimate, climateReconcile, stepTarget, setHvac, roomTemperature, roomHumidity, roomWindowOpen } from '../state/commands.ts';
  import { climateStep } from '../state/room-display-config.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { pulse } from '../actions/pulse.ts';
  import { fmtTemp } from '../format.ts';
  import type { ClimateValue } from '../adapter/types.ts';
  import { m } from '../../paraglide/messages.js';

  let { room, stacked = false, onLongPress }: { room: Room; stacked?: boolean; onLongPress?: () => void } = $props();

  const climate = $derived(mergedClimate(room.id));
  /* Ist-Temperatur mit Fallback-Kette (dedizierter Sensor > Thermostat-Ist >
     nichts). null wird explizit als nicht verfügbar gezeigt. */
  const temp = $derived(roomTemperature(room.id));
  const humidity = $derived(roomHumidity(room.id));
  const step = $derived(climateStep(room.id));

  /* Klima-Widerspruch (docs/02): Ziel ist ein Stepper (diskret) → 300-ms-
     Korrektur als Opacity-Crossfade des Werts. */
  let tempCorrect = $state(0);
  let seenSeq = 0;
  $effect(() => {
    const ev = climateReconcile(room.id);
    if (!ev || ev.seq <= seenSeq) return;
    seenSeq = ev.seq;
    const o = ev.optimistic as Partial<ClimateValue>;
    const s = ev.server as ClimateValue;
    if (o.target !== undefined && o.target !== s.target) tempCorrect++;
  });
</script>

{#if climate}
  <div class="climate-card" class:is-stacked={stacked}
       use:longpress={{ enabled: !!onLongPress, onLongPress: () => onLongPress?.() }}>
    <div class="climate-warning" class:is-visible={roomWindowOpen(room.id, room.windowOpen)}>
      <Icon name="i-window" cls="icon icon-md" /><span>{m.room_window_open()}</span>
    </div>
    <div class="climate-current">
      <span class="climate-current-label">{m.climate_current()}</span>
      <span class="climate-temp num" class:is-unavailable={temp === null}>
        {#if temp !== null}
          {fmtTemp(temp)}<span class="unit">°<span class="unit-c">C</span></span>
        {:else}
          {m.media_unavailable()}
        {/if}
      </span>
      <div class="climate-current-meta">
        <Icon name="i-thermometer" cls="icon icon-xl" />
        <span>
          <strong>{m.climate_current_temperature()}</strong>
          <span class="climate-current-room-label">{m.climate_room_temperature()}</span>
          {#if humidity !== null}
            <small>{Math.round(humidity)} % {m.room_display_humidity()}</small>
          {/if}
        </span>
      </div>
    </div>

    <div class="climate-controller" aria-label="{m.climate_target_temperature()} {room.name}">
      <div class="climate-target-panel">
        <span class="climate-controller-label">{m.climate_target_temperature()}</span>
        <!-- Panel: der Istwert steht über dem Sollwert statt in einer eigenen
             Spalte, damit die Karte in keiner Breite umbricht. -->
        <span class="climate-controller-current">
          <Icon name="i-thermometer" cls="icon icon-sm" />
          <span>{m.climate_current()}</span>
          <strong class="num" class:is-unavailable={temp === null}>{temp !== null ? `${fmtTemp(temp)}°` : m.media_unavailable()}</strong>
          {#if humidity !== null}<small>{Math.round(humidity)} %</small>{/if}
        </span>
        <div class="climate-target-control">
          <button class="climate-step climate-step-down pressable" type="button" aria-label={m.room_temp_down()}
                  onclick={() => stepTarget(room.id, -step)}>
            <Icon name="i-minus" cls="icon icon-xl" />
          </button>
          <span class="climate-target-value num" use:pulse={{ seq: tempCorrect, cls: 'is-correct-fade', ms: 300 }}>{fmtTemp(climate.target)}°</span>
          <button class="climate-step climate-step-up pressable" type="button" aria-label={m.room_temp_up()}
                  onclick={() => stepTarget(room.id, step)}>
            <Icon name="i-plus" cls="icon icon-xl" />
          </button>
        </div>
      </div>
      <div class="climate-mode-selector" role="radiogroup" aria-label={m.climate_mode_label()}>
        {#each HVAC_MODES as mode (mode.id)}
          <button class="climate-mode pressable" type="button" role="radio" data-mode={mode.id}
                  aria-label={mode.label} aria-checked={climate.hvac === mode.id} class:is-active={climate.hvac === mode.id}
                  onclick={() => setHvac(room.id, mode.id)}>
            <Icon name={mode.icon} cls="icon icon-xl" />
            <span>{mode.label}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
