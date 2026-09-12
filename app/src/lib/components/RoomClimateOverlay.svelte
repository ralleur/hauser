<script lang="ts">
  /* Klima-Overlay des Panels (Owner-Entscheidung 2026-09-11): Tap auf die
     Klima-Kachel zeigt die Karte mit Istwert, Sollwert und Betriebsart; ein
     langer Druck zeigt die Einstellungen der Kachel. Modal wie das Geräte-
     Detail (Scrim, modal-enter, Escape, Tap daneben). */
  import Icon from './Icon.svelte';
  import ClimateCard from './ClimateCard.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { roomClimate, closeRoomClimate, finishRoomClimateClose } from '../state/overlay.svelte.ts';
  import {
    CLIMATE_STEPS, climateInline, climateStep, climateTileShows,
    setClimateInline, setClimateStep, setClimateTileShows, type ClimateTileShows,
  } from '../state/room-display-config.svelte.ts';
  import { fmtTemp } from '../format.ts';
  import { m } from '../../paraglide/messages.js';

  const room = $derived(appState.rooms.find((candidate) => candidate.id === roomClimate.roomId) ?? null);
  const settings = $derived(roomClimate.view === 'settings');
  const SHOWS: ReadonlyArray<{ id: ClimateTileShows; label: () => string }> = [
    { id: 'target', label: () => m.climate_tile_target() },
    { id: 'current', label: () => m.climate_tile_current() },
    { id: 'both', label: () => m.climate_tile_both() },
  ];

  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (roomClimate.mode === 'open' && panelEl) panelEl.focus();
  });
  // animationend-Fallback (deckt prefers-reduced-motion: 0ms ab)
  $effect(() => {
    if (roomClimate.mode !== 'closing') return;
    const t = setTimeout(finishRoomClimateClose, 250);
    return () => clearTimeout(t);
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && roomClimate.mode === 'open') closeRoomClimate();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="light-detail room-climate" class:is-open={roomClimate.mode === 'open'}
     class:is-closing={roomClimate.mode === 'closing'} hidden={roomClimate.mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={() => closeRoomClimate()}></div>
  <div class="light-detail-panel overlay-panel on-image" role="dialog" aria-modal="true"
       aria-label={settings ? m.climate_settings_title() : `${m.cat_temp()} ${room?.name ?? ''}`}
       tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (roomClimate.mode === 'closing' && e.target === e.currentTarget) finishRoomClimateClose(); }}>
    {#if room}
      <header class="ld-header">
        <span class="ld-symbol" aria-hidden="true"><Icon name="i-thermometer" /></span>
        <span class="ld-title">{settings ? m.climate_settings_title() : room.name}</span>
        <button class="ld-close pressable" type="button" aria-label={m.common_close()}
                onclick={() => closeRoomClimate()}><Icon name="i-close" cls="icon icon-md" /></button>
      </header>

      {#if settings}
        <section class="ld-section ld-switch-row">
          <span id="climate-inline-label">{m.climate_inline_controls()}</span>
          <button class="re-toggle pressable" type="button" role="switch"
                  aria-checked={climateInline(room.id)} class:is-on={climateInline(room.id)}
                  aria-labelledby="climate-inline-label"
                  onclick={() => setClimateInline(room.id, !climateInline(room.id))}>
            <span class="re-toggle-knob"></span>
          </button>
        </section>
        <section class="ld-section">
          <span class="caps-label">{m.climate_tile_shows()}</span>
          <div class="choice-pill" role="radiogroup" aria-label={m.climate_tile_shows()}>
            {#each SHOWS as option (option.id)}
              <button class="choice-seg pressable" type="button" role="radio"
                      aria-checked={climateTileShows(room.id) === option.id}
                      onclick={() => setClimateTileShows(room.id, option.id)}>{option.label()}</button>
            {/each}
          </div>
        </section>
        <section class="ld-section">
          <span class="caps-label">{m.climate_step()}</span>
          <div class="choice-pill" role="radiogroup" aria-label={m.climate_step()}>
            {#each CLIMATE_STEPS as value (value)}
              <button class="choice-seg pressable num" type="button" role="radio"
                      aria-checked={climateStep(room.id) === value}
                      onclick={() => setClimateStep(room.id, value)}>{fmtTemp(value)}°</button>
            {/each}
          </div>
        </section>
      {:else}
        <div class="climate-section room-climate-card">
          <ClimateCard {room} stacked />
        </div>
      {/if}
    {/if}
  </div>
</div>
