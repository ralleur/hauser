<script lang="ts">
  import RoomSummaryCard from './phone/RoomSummaryCard.svelte';
  import { appState, type Room } from '../state/app.svelte.ts';
  import { mergedClimate, mergedLight, roomTemperature, roomWindowOpen } from '../state/commands.ts';
  import { phoneHeroVariantForRoom, projectPhoneRooms, type PhoneHeroVariant } from '../state/phone-home.ts';
  import { m } from '../../paraglide/messages.js';

  /* Ansicht „Alle Räume" (R30): dieselben Kacheln wie auf dem Telefon, nur
     nebeneinander. Ein Tipp holt den Raum in die Kontrollfläche. Das Raster
     lässt Zeiger durch (CSS), nur die Kacheln fangen sie — die Lücken bleiben
     die freie Fläche für den Layout-Long-Press darunter. */
  let {
    rooms,
    activeIds,
    roomsPerRow = 2,
    onselect,
  }: {
    rooms: Room[];
    activeIds: readonly string[];
    roomsPerRow?: number;
    onselect: (roomId: string) => void;
  } = $props();

  const summaries = $derived(projectPhoneRooms(rooms, {
    temperature: roomTemperature,
    light: mergedLight,
    climate: mergedClimate,
    windowOpen: roomWindowOpen,
  }));
  const heroVariant = $derived<PhoneHeroVariant>(
    appState.heroSun ? (appState.heroSun.day ? 'light' : 'dark') : appState.theme,
  );
</script>

<section class="home-room-grid" aria-label={m.home_room_grid()} style={`--rooms-per-row:${roomsPerRow}`}>
  {#each summaries as summary (summary.id)}
    <RoomSummaryCard
      {summary}
      active={activeIds.includes(summary.id)}
      heroVariant={phoneHeroVariantForRoom(summary, heroVariant)}
      onopen={(item) => onselect(item.id)}
    />
  {/each}
</section>
