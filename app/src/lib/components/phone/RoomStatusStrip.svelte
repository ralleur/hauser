<script lang="ts">
  /* Die Raumwerte unter dem Namen (Owner-Entscheidung 2026-09-20, wie in der
     App): Temperatur, Luftfeuchte, Anwesenheit — linksbündig und ohne Scheibe,
     je Wert ein rundes Zeichen mit Zahl, dazwischen feine Striche. Was der
     Raum nicht misst, fehlt; misst er nichts, fehlt die Leiste. Messwerte sind
     keine Geräte: die Klimasteuerung wohnt hinter der Temperatur. */
  import Icon from '../Icon.svelte';
  import { type Room } from '../../state/app.svelte.ts';
  import { CO2_STALE_PPM, mergedClimate, roomCo2, roomContacts, roomHumidity, roomPresence, roomTemperature } from '../../state/commands.ts';
  import { showsMetric } from '../../state/room-display-config.svelte.ts';
  import { openRoomClimate } from '../../state/overlay.svelte.ts';
  import { fmtTemp } from '../../format.ts';
  import { m } from '../../../paraglide/messages.js';

  let { room }: { room: Room } = $props();

  const climate = $derived(mergedClimate(room.id));
  const temperature = $derived(roomTemperature(room.id) ?? climate?.target ?? null);
  const humidity = $derived(roomHumidity(room.id));
  /* CO₂ nur, wenn der Raum es zeigen soll (Raumeinstellungen) — sonst stünde es in jedem Raum mit Fühler. */
  const co2 = $derived(showsMetric(room.id, 'co2') ? roomCo2(room.id) : null);
  const hasPresence = $derived(roomContacts(room.id, 'presence').length > 0);
  const present = $derived(roomPresence(room.id));
</script>

{#snippet temperatureField()}
  <span class="room-status-icon is-warm" aria-hidden="true"><Icon name="i-thermometer" /></span>
  <span class="room-status-value num">{fmtTemp(temperature!)}°</span>
{/snippet}

{#if temperature !== null || humidity !== null || co2 !== null || hasPresence}
  <div class="room-status">
    {#if temperature !== null}
      {#if climate}
        <button class="room-status-field pressable" type="button"
                aria-label={`${m.climate_room_temperature()} ${fmtTemp(temperature)}°`}
                onclick={() => openRoomClimate(room.id, 'control')}>
          {@render temperatureField()}
        </button>
      {:else}
        <span class="room-status-field" role="img" aria-label={`${m.climate_room_temperature()} ${fmtTemp(temperature)}°`}>
          {@render temperatureField()}
        </span>
      {/if}
    {/if}
    {#if humidity !== null}
      <span class="room-status-field" role="img" aria-label={`${m.room_display_humidity()} ${Math.round(humidity)} %`}>
        <span class="room-status-icon is-cool" aria-hidden="true"><Icon name="i-water-outline" /></span>
        <span class="room-status-value num">{Math.round(humidity)}%</span>
      </span>
    {/if}
    {#if co2 !== null}
      <span class="room-status-field" role="img" aria-label={`${m.room_display_co2()} ${Math.round(co2)} ppm`}>
        <span class="room-status-icon" class:is-warm={co2 >= CO2_STALE_PPM} aria-hidden="true"><Icon name="i-molecule-co2" /></span>
        <span class="room-status-value num">{Math.round(co2)}</span>
      </span>
    {/if}
    {#if hasPresence}
      <!-- Der Kreis ist selbst die Anzeige: ist jemand da, leuchtet er ganz in Grün. -->
      <span class="room-status-field" role="img" aria-label={present ? m.phone_presence_yes() : m.phone_presence_no()}>
        <span class="room-status-icon" class:is-lit={present} aria-hidden="true"><Icon name="i-account" /></span>
      </span>
    {/if}
  </div>
{/if}
