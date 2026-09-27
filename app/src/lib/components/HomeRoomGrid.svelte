<script lang="ts">
  import RoomSummaryCard from './phone/RoomSummaryCard.svelte';
  import { appState, type Room } from '../state/app.svelte.ts';
  import { mergedClimate, mergedLight, roomPresence, roomTemperature, roomWindowOpen } from '../state/commands.ts';
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
    rows = 3,
    onselect,
  }: {
    rooms: Room[];
    activeIds: readonly string[];
    roomsPerRow?: number;
    rows?: number;
    onselect: (roomId: string) => void;
  } = $props();

  /* „Zeilen auf einmal“ aus dem Layout-Menü (Owner-Wunsch 2026-09-27): die
     Kachelhöhe kommt aus dem gemessenen Platz geteilt durch diese Zahl, wie
     am Telefon (PhoneHomeFeed). Mehr Räume als Zeilen: das Raster scrollt,
     statt jede Kachel zum Streifen zu drücken. */
  let gridEl = $state<HTMLElement | undefined>();
  let rowHeight = $state(0);

  function measureRows(): void {
    const grid = gridEl;
    if (!grid) return;
    const style = getComputedStyle(grid);
    const free = grid.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const gap = parseFloat(style.rowGap) || 0;
    const count = Math.max(1, rows);
    const next = Math.max(0, (free - (count - 1) * gap) / count);
    if (Math.abs(next - rowHeight) > 0.5) rowHeight = next;
  }

  $effect(() => {
    void rows;
    measureRows();
  });

  $effect(() => {
    const grid = gridEl;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureRows());
    observer.observe(grid);
    return () => observer.disconnect();
  });

  const summaries = $derived(projectPhoneRooms(rooms, {
    temperature: roomTemperature,
    light: mergedLight,
    climate: mergedClimate,
    windowOpen: roomWindowOpen,
    presence: roomPresence,
  }));
  const heroVariant = $derived<PhoneHeroVariant>(
    appState.heroSun ? (appState.heroSun.day ? 'light' : 'dark') : appState.theme,
  );
</script>

<section class="home-room-grid" class:is-fitted={rowHeight > 0} aria-label={m.home_room_grid()} bind:this={gridEl}
         style={`--rooms-per-row:${roomsPerRow}${rowHeight > 0 ? `;--room-tile-height:${rowHeight}px` : ''}`}>
  {#each summaries as summary (summary.id)}
    <RoomSummaryCard
      {summary}
      active={activeIds.includes(summary.id)}
      heroVariant={phoneHeroVariantForRoom(summary, heroVariant)}
      onopen={(item) => onselect(item.id)}
    />
  {/each}
</section>
