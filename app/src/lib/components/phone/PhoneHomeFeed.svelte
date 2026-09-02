<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import RoomSummaryCard from './RoomSummaryCard.svelte';
  import { appState } from '../../state/app.svelte.ts';
  import type { PhoneHeroVariant, PhoneRoomSummary } from '../../state/phone-home.ts';

  import { m } from '../../../paraglide/messages.js';
  import { pluralCategory } from '../../state/locale.svelte.ts';

  type QuickActionsProps = { online: boolean };

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
  const heroVariant = $derived<PhoneHeroVariant>(
    appState.heroSun ? (appState.heroSun.day ? 'light' : 'dark') : appState.theme,
  );
  let QuickActionsComponent = $state<Component<QuickActionsProps> | null>(null);

  onMount(() => {
    let cancelled = false;
    void import('./PhoneQuickActions.svelte').then(({ default: component }) => {
      if (!cancelled) QuickActionsComponent = component;
    }).catch(() => {});
    return () => { cancelled = true; };
  });
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

  <!-- Post-Paint geladen: hält Klima-Konfiguration und Schnellaktionslogik aus
       dem kritischen Phone-Startup-Pfad, ohne Verhalten oder Daten zu ändern. -->
  {#if QuickActionsComponent}
    <QuickActionsComponent {online} />
  {/if}
</main>
