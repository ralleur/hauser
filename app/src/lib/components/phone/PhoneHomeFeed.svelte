<script lang="ts">
  import Icon from '../Icon.svelte';
  import RoomSummaryCard from './RoomSummaryCard.svelte';
  import { centralClimate } from '../../state/climate-central.svelte.ts';
  import { fmtTemp } from '../../format.ts';
  import { appState } from '../../state/app.svelte.ts';
  import { currentClimateTemperature, type PhoneHeroVariant, type PhoneRoomSummary } from '../../state/phone-home.ts';
  import { shouldConfirmHomeOff, toggleVacationMode, turnOffHomeExceptBedroom, vacationModeActive } from '../../state/commands.ts';
  import { createPhoneSettingsLoader } from '../../state/phone-lazy-loader.ts';

  import { m } from '../../../paraglide/messages.js';
  import { pluralCategory } from '../../state/locale.svelte.ts';

  /* Plusamorm je Sprache — dieselben Katalogfassungen wie in der Tab-Leiste. */
  const WINDOWS_OPEN = {
    one: m.status_window_open_one, two: m.status_window_open_two,
    few: m.status_window_open_few, many: m.status_window_open_many,
    other: m.status_window_open_other,
  };

  let {
    rooms,
    currentRoom,
    online,
    onopen,
    titleAnchor = $bindable(),
  }: {
    rooms: PhoneRoomSummary[];
    currentRoom: string | null;
    online: boolean;
    onopen: (summary: PhoneRoomSummary, trigger: HTMLButtonElement) => void;
    titleAnchor?: HTMLHeadingElement;
  } = $props();

  const openWindows = $derived(rooms.filter((room) => room.windowOpen).length);
  const currentTemperature = $derived(currentClimateTemperature(rooms));
  const vacationActive = $derived(vacationModeActive());
  const heroVariant = $derived<PhoneHeroVariant>(
    appState.heroSun ? (appState.heroSun.day ? 'light' : 'dark') : appState.theme,
  );
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
      // Kann die optionale Einstellungs-Closure nicht geladen werden, bleibt die
      // destruktive Aktion fail-safe bestätigt. Der nächste Tap startet einen
      // echten neuen Ladeversuch; eine Rejection wird nicht dauerhaft gecacht.
      if (window.confirm(m.phone_off_confirm_nocfg())) {
        turnOffHomeExceptBedroom();
      }
    });
  }
</script>

<main class="phone-home-feed" aria-labelledby="phone-target-title">
  <h1 bind:this={titleAnchor} id="phone-target-title" class="phone-visually-hidden" tabindex="-1">{m.phone_home()}</h1>

  {#if openWindows > 0}
    <aside class="phone-home-notice is-warning" aria-label={m.phone_security_note()}>
      <strong>{WINDOWS_OPEN[pluralCategory(openWindows)]({ count: openWindows })}</strong>
      <span>{online ? m.phone_details_at_rooms() : m.phone_last_known()}</span>
    </aside>
  {/if}

  <section class="phone-room-feed" aria-label={m.phone_rooms()}>
    {#if rooms.length === 0}
      <p class="phone-empty-state">{m.phone_no_rooms()}</p>
    {:else}
      {#each rooms as room (room.id)}
        <RoomSummaryCard summary={room} active={currentRoom === room.id} {heroVariant} {onopen} />
      {/each}
    {/if}
  </section>

  <!-- Mobile Schnellaktionen: Aus / halbe Breite Klima / Urlaub. -->
  {#if centralClimate.hasClimate}
    <div class="phone-quick-actions">
      <button class="phone-quick-action is-off pressable" type="button" disabled={!online}
              aria-label={m.phone_all_off_label()} onclick={onHomeOff}>
        <Icon name="i-power" cls="icon icon-md" />
        <span>{m.phone_off()}</span>
      </button>
      <div class="climate-dock phone-climate-dock" aria-label={m.phone_climate_central()}>
        <button class="cd-key cd-key-down pressable" type="button" aria-label={m.phone_climate_colder()}
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
        <button class="cd-key cd-key-up pressable" type="button" aria-label={m.phone_climate_warmer()}
                onclick={() => centralClimate.step(0.5)}><Icon name="i-chevron-up" cls="icon cd-chevron" /></button>
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
</main>
