<script module lang="ts">
  const TILE_RATIO = ['16/9', '1/1.15', '1/1.1'];
</script>

<script lang="ts">
  import { onMount, type Component } from 'svelte';
  import { clock } from '../../state/clock.svelte.ts';
  import RoomSummaryCard from './RoomSummaryCard.svelte';
  import { appState } from '../../state/app.svelte.ts';
  import { phoneHeroVariantForRoom, type PhoneHeroVariant, type PhoneRoomSummary } from '../../state/phone-home.ts';
  import { phoneLayout } from '../../state/phone-layout.svelte.ts';
  import { swipeleft } from '../../actions/swipeleft.ts';

  import { m } from '../../../paraglide/messages.js';
  import { openingsLabel } from '../../state/open-label.ts';

  type QuickActionsProps = { online: boolean };

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

  const openLabel = $derived(openingsLabel(
    rooms.filter((room) => room.windowOpen).length, rooms.filter((room) => room.doorOpen).length));
  const heroVariant = $derived<PhoneHeroVariant>(
    appState.heroSun ? (appState.heroSun.day ? 'light' : 'dark') : appState.theme,
  );
  let QuickActionsComponent = $state<Component<QuickActionsProps> | null>(null);
  let HomeExtras = $state<Component<{ currentRoom: string | null }> | null>(null);
  let WeatherControl = $state<Component | null>(null);

  onMount(() => {
    let cancelled = false;
    // Gleiche Frame-Grenze wie observeResize, ohne ein zusätzliches Modul
    // im knappen Telefon-Startbudget.
    const observer = new ResizeObserver(() => requestAnimationFrame(() => {
      if (!cancelled) measureRows();
    }));
    observer.observe(feedEl!);
    void import('../WeatherButton.svelte').then(({ default: component }) => {
      if (!cancelled) WeatherControl = component;
    }).catch(() => {});
    void import('./PhoneQuickActions.svelte').then(({ default: component }) => {
      if (!cancelled) QuickActionsComponent = component;
    }).catch(() => {});
    /* Gruß und Knopf-Blatt (wie die iOS-App) kommen mit der Leiste nach dem ersten Bild. */
    void import('./PhoneHomeExtras.svelte').then(({ default: component }) => {
      if (!cancelled) HomeExtras = component;
    }).catch(() => {});
    return () => { cancelled = true; observer.disconnect(); };
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
  /* Zeilen, die ohne Scrollen auf den Schirm passen — zwei Spalten zeigen sechs
     Räume (Owner-Wunsch 2026-09-12). Die Kachelhöhe kommt aus dem gemessenen
     freien Platz, weil ein festes Seitenverhältnis auf breiten Geräten nur zwei
     Zeilen übrig ließ. Mehr Räume als Platz: dann wird gescrollt. */
  let feedEl = $state<HTMLElement | undefined>();
  let gridEl = $state<HTMLElement | undefined>();
  let rowHeight = $state(0);

  function measureRows(): void {
    const feed = feedEl;
    const grid = gridEl;
    if (!feed || !grid) return;
    const rows = phoneLayout.roomsPerRow === 3 ? 4 : 3;
    const feedStyle = getComputedStyle(feed);
    let free = feed.clientHeight
      - parseFloat(feedStyle.paddingTop)
      - parseFloat(feedStyle.paddingBottom);
    /* Alles, was sich den Platz mit dem Raster teilt (Hinweis, Schnellaktionen),
       geht vorher ab; der versteckte Titel liegt absolut und zählt nicht. */
    for (const child of feed.children) {
      if (child === grid) continue;
      const style = getComputedStyle(child);
      if (style.position === 'absolute' || style.position === 'fixed') continue;
      free -= (child as HTMLElement).offsetHeight
        + parseFloat(style.marginTop)
        + parseFloat(style.marginBottom);
    }
    const gap = parseFloat(getComputedStyle(grid).rowGap);
    // Ganze Pixel halten die Messung auch bei gebrochenen Viewportmaßen ruhig.
    rowHeight = Math.max(0, Math.floor((free - (rows - 1) * gap) / rows));
  }

  $effect(() => {
    /* Neu messen, sobald sich Spaltenzahl, Hinweiszeile oder Schnellaktionen ändern. */
    void openLabel;
    void phoneLayout.quickActions;
    void QuickActionsComponent;
    measureRows();
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
      style={`--phone-rooms-per-row:${phoneLayout.roomsPerRow};--phone-tile-ratio:${TILE_RATIO[phoneLayout.roomsPerRow - 1]}${rowHeight ? `;--phone-tile-height:${rowHeight}px` : ''}`}
      use:swipeleft={{
        onSwipe: () => { layoutOpen = true; }, move: false, threshold: 48, angle: 60, enabled: !layoutOpen,
        onDrag: (travel) => { loadLayoutSheet(); layoutDrag = travel; },
        onDragEnd: () => { layoutDrag = null; },
      }}>
  <h1 bind:this={titleAnchor} id="phone-target-title" class="phone-visually-hidden" tabindex="-1">{m.phone_home()}</h1>

  <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)"><span>{clock.date}</span><span style="display:inline-flex;align-items:center;justify-content:flex-end;min-height:var(--touch-min);min-width:calc(var(--space-8) + var(--space-4))">{#if WeatherControl}<WeatherControl />{/if}</span></div>

  {#if HomeExtras}<HomeExtras {currentRoom} />{/if}

  {#if openLabel}
    <aside class="phone-home-notice is-warning" aria-label={m.phone_security_note()}>
      <strong>{openLabel}</strong>
      <span>{online ? m.phone_details_at_rooms() : m.phone_last_known()}</span>
    </aside>
  {/if}

  <section class="phone-room-feed" class:is-fitted={rowHeight} bind:this={gridEl} aria-label={m.phone_rooms()}>
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
