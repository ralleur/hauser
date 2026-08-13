<script lang="ts">
  import Icon from '../Icon.svelte';
  import { centralClimate } from '../../state/climate-central.svelte.ts';
  import { appState } from '../../state/app.svelte.ts';
  import type { PhoneHeroVariant, PhoneRoomSummary } from '../../state/phone-home.ts';
  import { shouldConfirmHomeOff, toggleVacationMode, turnOffHomeExceptBedroom, vacationModeActive } from '../../state/commands.ts';
  import { createPhoneSettingsLoader } from '../../state/phone-lazy-loader.ts';

  import { m } from '../../../paraglide/messages.js';
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
  let RoomSummaryCardComponent = $state<any>(null);
  let PhoneClimateDockComponent = $state<any>(null);
  $effect(() => {
    if (rooms.length === 0 || RoomSummaryCardComponent) return;
    void import('./RoomSummaryCard.svelte').then(({ default: component }) => {
      RoomSummaryCardComponent = component;
    });
  });
  $effect(() => {
    if (!centralClimate.hasClimate || PhoneClimateDockComponent) return;
    void import('./PhoneClimateDock.svelte').then(({ default: component }) => {
      PhoneClimateDockComponent = component;
    });
  });
  const vacationActive = $derived(vacationModeActive());
  const heroVariant = $derived<PhoneHeroVariant>(
    appState.heroSun ? (appState.heroSun.day ? 'light' : 'dark') : appState.theme,
  );
  const settingsLoader = createPhoneSettingsLoader();

  function finishHomeOff(confirmBefore: string | null): void {
    if (shouldConfirmHomeOff(new Date(), confirmBefore)
      && !window.confirm('Wirklich alle Lichter und den Fernseher außerhalb des Schlafzimmers ausschalten?')) return;
    turnOffHomeExceptBedroom();
  }

  function onHomeOff(): void {
    void settingsLoader.load('settings', ({ settingsValues }) => {
      finishHomeOff(settingsValues.offConfirmBefore);
    }).catch(() => {
      // Kann die optionale Einstellungs-Closure nicht geladen werden, bleibt die
      // destruktive Aktion fail-safe bestätigt. Der nächste Tap startet einen
      // echten neuen Ladeversuch; eine Rejection wird nicht dauerhaft gecacht.
      if (window.confirm('Einstellungen konnten nicht geladen werden. Zuhause trotzdem ausschalten?')) {
        turnOffHomeExceptBedroom();
      }
    });
  }
</script>

<main class="phone-home-feed" aria-labelledby="phone-target-title">
  <h1 bind:this={titleAnchor} id="phone-target-title" class="phone-visually-hidden" tabindex="-1">{m.phone_home()}</h1>

  {#if openWindows > 0}
    <aside class="phone-home-notice is-warning" aria-label={m.phone_security_note()}>
      <strong>{openWindows} {openWindows === 1 ? 'Fenster ist' : 'Fenster sind'} offen</strong>
      <span>{online ? m.phone_details_at_rooms() : m.phone_last_known()}</span>
    </aside>
  {/if}

  <section class="phone-room-feed" aria-label={m.phone_rooms()}>
    {#if rooms.length === 0}
      <p class="phone-empty-state">{m.phone_no_rooms()}</p>
    {:else}
      {#each rooms as room (room.id)}
        {#if RoomSummaryCardComponent}
          <RoomSummaryCardComponent summary={room} active={currentRoom === room.id} {heroVariant} {onopen} />
        {:else}
          <div class="phone-room-card" aria-hidden="true"></div>
        {/if}
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
      {#if PhoneClimateDockComponent}
        <PhoneClimateDockComponent {rooms} />
      {:else}
        <div class="climate-dock phone-climate-dock" aria-hidden="true"></div>
      {/if}
      <button class="phone-quick-action is-vacation pressable" class:is-active={vacationActive}
              type="button" disabled={!online} aria-pressed={vacationActive}
              aria-label={vacationActive ? m.phone_vacation_disable() : m.phone_vacation_enable()}
              onclick={toggleVacationMode}>
        <Icon name="i-umbrella-beach" cls="icon icon-md" />
        <span>{vacationActive ? m.phone_vacation_active() : m.phone_vacation()}</span>
      </button>
    </div>
  {/if}
</main>
