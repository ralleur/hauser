<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import RoomSummaryCard from './RoomSummaryCard.svelte';
  import { appState } from '../../state/app.svelte.ts';
  import { phoneHeroVariantForRoom, type PhoneHeroVariant, type PhoneRoomSummary } from '../../state/phone-home.ts';
  import { phoneLayout } from '../../state/phone-layout.svelte.ts';
  import { swipeleft } from '../../actions/swipeleft.ts';

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

  /* Layout-Blatt (Räume pro Zeile, Schnellaktionen): Wisch nach links auf dem
     Raster zieht es von rechts herein — es klebt am Finger wie die
     Kontrollfläche des Panels (Owner-Wunsch 2026-09-11). Ein kleines Stück
     oder ein Schnipser genügt, dann rastet es ein; sonst federt es zurück.
     Keine Sperre über den Bearbeiten-Modus: das Blatt stellt nur die Ansicht
     dieses Telefons um, nicht den Haushalt. Der Baustein lädt im Leerlauf nach dem
     ersten Bild, damit er beim ersten Zug schon da ist. */
  /* Seitenverhältnis der Kachel je Spaltenzahl: eine Spalte breit wie das
     Panel, drei Spalten fast quadratisch, zwei dazwischen. Es gilt nur, solange
     nicht gemessen ist. */
  const TILE_RATIO: Record<number, string> = { 1: '16 / 9', 2: '1 / 1.15', 3: '1 / 1.1' };
  /* Zeilen, die ohne Scrollen auf den Schirm passen — zwei Spalten zeigen sechs
     Räume (Owner-Wunsch 2026-09-12). Die Kachelhöhe kommt aus dem gemessenen
     freien Platz, weil ein festes Seitenverhältnis auf breiten Geräten nur zwei
     Zeilen übrig ließ. Mehr Räume als Platz: dann wird gescrollt. */
  const VISIBLE_ROWS: Record<number, number> = { 1: 3, 2: 3, 3: 4 };
  let feedEl = $state<HTMLElement | undefined>();
  let gridEl = $state<HTMLElement | undefined>();
  let rowHeight = $state(0);

  function measureRows(): void {
    const feed = feedEl;
    const grid = gridEl;
    if (!feed || !grid) return;
    const rows = VISIBLE_ROWS[phoneLayout.roomsPerRow] ?? VISIBLE_ROWS[2];
    const feedStyle = getComputedStyle(feed);
    let free = feed.clientHeight
      - parseFloat(feedStyle.paddingTop)
      - parseFloat(feedStyle.paddingBottom);
    /* Alles, was sich den Platz mit dem Raster teilt (Hinweis, Schnellaktionen),
       geht vorher ab; der versteckte Titel liegt absolut und zählt nicht. */
    for (const child of feed.children) {
      if (child === grid) continue;
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.position === 'absolute' || style.position === 'fixed') continue;
      free -= (child as HTMLElement).offsetHeight
        + parseFloat(style.marginTop)
        + parseFloat(style.marginBottom);
    }
    const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
    const next = Math.max(0, (free - (rows - 1) * gap) / rows);
    if (Math.abs(next - rowHeight) > 0.5) rowHeight = next;
  }

  $effect(() => {
    /* Neu messen, sobald sich Spaltenzahl, Hinweiszeile oder Schnellaktionen ändern. */
    void phoneLayout.roomsPerRow;
    void openWindows;
    void phoneLayout.quickActions;
    void QuickActionsComponent;
    measureRows();
  });

  $effect(() => {
    const feed = feedEl;
    if (!feed || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureRows());
    observer.observe(feed);
    return () => observer.disconnect();
  });
  let layoutOpen = $state(false);
  let layoutDrag = $state<number | null>(null);
  let LayoutSheetComponent = $state<Component<{ open: boolean; drag: number | null; onclose: () => void }> | null>(null);
  function loadLayoutSheet(): void {
    if (LayoutSheetComponent) return;
    void import('./PhoneLayoutSheet.svelte').then(({ default: component }) => { LayoutSheetComponent = component; })
      .catch(() => {});
  }
  onMount(() => {
    const idle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(loadLayoutSheet, { timeout: 4000 })
      : setTimeout(loadLayoutSheet, 1500);
    return () => {
      if (typeof cancelIdleCallback === 'function' && typeof idle === 'number') cancelIdleCallback(idle);
      else clearTimeout(idle as ReturnType<typeof setTimeout>);
    };
  });
</script>

<main class="phone-home-feed" aria-labelledby="phone-target-title"
      bind:this={feedEl}
      style={`--phone-rooms-per-row:${phoneLayout.roomsPerRow};--phone-tile-ratio:${TILE_RATIO[phoneLayout.roomsPerRow] ?? TILE_RATIO[2]}${rowHeight > 0 ? `;--phone-tile-height:${rowHeight}px` : ''}`}
      use:swipeleft={{
        onSwipe: () => { layoutOpen = true; }, move: false, threshold: 48, angle: 60, enabled: !layoutOpen,
        onDrag: (travel) => { loadLayoutSheet(); layoutDrag = travel; },
        onDragEnd: () => { layoutDrag = null; },
      }}>
  <h1 bind:this={titleAnchor} id="phone-target-title" class="phone-visually-hidden" tabindex="-1">{m.phone_home()}</h1>

  {#if openWindows > 0}
    <aside class="phone-home-notice is-warning" aria-label={m.phone_security_note()}>
      <strong>{WINDOWS_OPEN[pluralCategory(openWindows)]({ count: openWindows })}</strong>
      <span>{online ? m.phone_details_at_rooms() : m.phone_last_known()}</span>
    </aside>
  {/if}

  <section class="phone-room-feed" class:is-fitted={rowHeight > 0} bind:this={gridEl} aria-label={m.phone_rooms()}>
    {#if rooms.length === 0}
      <p class="phone-empty-state">{m.phone_no_rooms()}</p>
    {:else}
      {#each rooms as room (room.id)}
        <RoomSummaryCard
          summary={room}
          active={currentRoom === room.id}
          heroVariant={phoneHeroVariantForRoom(room, heroVariant)}
          {onopen}
        />
      {/each}
    {/if}
  </section>

  <!-- Post-Paint geladen: hält Klima-Konfiguration und Schnellaktionslogik aus
       dem kritischen Phone-Startup-Pfad, ohne Verhalten oder Daten zu ändern. -->
  {#if QuickActionsComponent && phoneLayout.quickActions}
    <QuickActionsComponent {online} />
  {/if}
</main>

{#if LayoutSheetComponent && (layoutOpen || layoutDrag !== null)}
  <LayoutSheetComponent open={layoutOpen} drag={layoutDrag} onclose={() => { layoutOpen = false; }} />
{/if}
