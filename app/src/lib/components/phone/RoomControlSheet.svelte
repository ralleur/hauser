<script lang="ts">
  import { prefersReducedMotion, tokenDuration } from '../../motion/index.ts';
  import { m } from '../../../paraglide/messages.js';
  import { onDestroy, onMount } from 'svelte';
  import RoomControls from '../RoomControls.svelte';
  import Icon from '../Icon.svelte';
  import { cubicOut } from 'svelte/easing';
  import { openRoomEdit } from '../../state/overlay.svelte.ts';
  import { SHEET_SWIPE_IGNORE, swipedown } from '../../actions/swipedown.ts';
  import { swipeleft } from '../../actions/swipeleft.ts';
  import { appState, type Room } from '../../state/app.svelte.ts';
  import type { HeroImageCandidate } from '../room-hero-assets.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { resolvePhoneHero, type PhoneHeroVariant } from '../../state/phone-home.ts';
  import { closeDeviceDetail, deviceDetail } from '../../state/overlay.svelte.ts';
  import { closeSceneEdit, sceneEdit } from '../../state/scene-edit-overlay.svelte.ts';
  import { createRetryableLazyLoader } from '../../state/lazy-loader.ts';
  import { wrappedFocusIndex, type LayerCloseReason } from '../../state/phone-navigation.svelte.ts';

  let {
    room,
    onclose,
    onouteroutroend,
    onswitch,
    heroVariant,
    heroVariantFor,
  }: {
    room: Room;
    onclose: (reason: Exclude<LayerCloseReason, 'back' | 'unmount' | 'navigation' | 'selection'>) => void;
    onouteroutroend: () => void;
    /** Wisch nach links (+1: nächster Raum) oder rechts (−1: voriger Raum). */
    onswitch?: (delta: 1 | -1) => void;
    heroVariant: PhoneHeroVariant;
    /** Bildfassung eines beliebigen Raums — für die Nachbarbilder beim Wisch. */
    heroVariantFor: (roomId: string) => PhoneHeroVariant;
  } = $props();

  /* Das Raumbild ist der Hintergrund des Blatts (Owner-Wunsch 2026-09-12,
     wie Apple Home): zwei Ebenen im Wechsel. Ohne Wischrichtung (erstes Bild,
     Theme- oder Lichtwechsel) blendet das Motiv über. Beim Wisch liegen die
     Bilder der Nachbarräume schon bereit: das nächste schiebt sich vom Rand
     her mit dem Finger ins Bild, nach dem Loslassen gleiten beide zu Ende —
     nirgends ein schwarzer Grund dazwischen (Owner-Befund 2026-09-12). */
  let layerA = $state<HeroImageCandidate | null>(null);
  let layerB = $state<HeroImageCandidate | null>(null);
  let front = $state<'a' | 'b'>('a');
  const shownHero = $derived(front === 'a' ? layerA : layerB);
  let heroRequest = 0;
  let heroRequested = '';
  let fadeLayer = $state<'a' | 'b' | null>(null);
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(fadeTimer));
  const heroKey = (roomId: string, variant: PhoneHeroVariant) =>
    [roomId, variant, JSON.stringify(roomHeroConfig(roomId))].join('|');
  async function loadHero(roomId: string, variant: PhoneHeroVariant, isCurrent: () => boolean): Promise<HeroImageCandidate | null> {
    const [resolution, { loadRoomHero }, { decodeHeroImageOffThread }] = await Promise.all([
      resolvePhoneHero(import.meta.env.BASE_URL, roomId, variant, roomHeroConfig(roomId)),
      import('../room-hero-assets.ts'),
      import('../hero-image-decoder.ts'),
    ]);
    return loadRoomHero(resolution, decodeHeroImageOffThread, isCurrent);
  }
  $effect(() => {
    const key = heroKey(room.id, heroVariant);
    if (key === heroRequested) return;
    heroRequested = key;
    const current = ++heroRequest;
    void loadHero(room.id, heroVariant, () => heroRequest === current).then((candidate) => {
      if (!candidate || heroRequest !== current) return;
      /* Ohne Wisch nur überblenden: die Ebene stand am Rand geparkt und
         würde sonst von dort hereingleiten — beim Öffnen des Blatts käme das
         Bild von rechts, während die Karte von unten kommt (Owner 2026-09-12). */
      const next = front === 'a' ? 'b' : 'a';
      clearTimeout(fadeTimer);
      fadeLayer = next;
      fadeTimer = setTimeout(() => { fadeLayer = null; }, 500);
      if (next === 'b') { layerB = candidate; front = 'b'; } else { layerA = candidate; front = 'a'; }
    }).catch(() => {
      if (heroRequest !== current) return;
      layerA = null;
      layerB = null;
    });
  });

  /* Nachbarn in Kachelreihenfolge, am Ende wieder von vorn — dieselbe Reihe,
     die der Wisch in der Shell durchläuft. */
  function neighbourId(delta: 1 | -1): string | null {
    const ids = appState.rooms.map((entry) => entry.id);
    const index = ids.indexOf(room.id);
    if (index < 0 || ids.length < 2) return null;
    return ids[(index + delta + ids.length) % ids.length];
  }
  let neighbourHero = $state<{ prev: HeroImageCandidate | null; next: HeroImageCandidate | null }>({ prev: null, next: null });
  let neighbourRequest = 0;
  $effect(() => {
    const prevId = neighbourId(-1);
    const nextId = neighbourId(1);
    const current = ++neighbourRequest;
    neighbourHero = { prev: null, next: null };
    for (const [side, id] of [['prev', prevId], ['next', nextId]] as const) {
      if (!id) continue;
      void loadHero(id, heroVariantFor(id), () => neighbourRequest === current).then((candidate) => {
        if (candidate && neighbourRequest === current) neighbourHero = { ...neighbourHero, [side]: candidate };
      }).catch(() => {});
    }
  });

  /* Raumwechsel per Wisch: dieselbe Toleranz wie das Layout-Blatt auf dem
     Home (kleines Stück oder Schnipser, bis 60 Grad schief). Zwei Gesten auf
     derselben Fläche, je eine Richtung; der Inhalt folgt dem Finger, der neue
     Raum kommt dann von der Wischseite herein. */
  let dragLeft = $state(0);
  let dragRight = $state(0);
  let dragging = $state(false);
  const dragX = $derived(dragLeft + dragRight);
  /* Richtung des letzten Wechsels: der neue Raum kommt von dort herein, der
     alte geht zur Gegenseite hinaus — beide weich, beide gleichzeitig. Der
     alte liegt währenddessen absolut über dem Platz, damit nichts springt. */
  /* Inhalt und Bild folgen dem Finger (Bild langsamer, wie eine Parallaxe);
     nach dem Loslassen fliegt der alte Raum ganz hinaus und der neue über die
     volle Breite herein — ohne Deckkraft: ein halbtransparenter Zwischenstand
     würde das Glas der Karten bis zum Ende der Bewegung ausschalten
     (Owner-Befund 2026-09-12: „Frostglas kommt spät"). */
  let slideDir = $state(0);
  /* Das Bild klebt 1:1 am Finger wie die Karten (Owner-Befund 2026-09-12:
     langsamer wirkte es wie ein Nachziehen mit Ruck). */
  const HERO_DRAG = 1;
  const HERO_LAYERS: Array<'a' | 'b'> = ['a', 'b'];
  /* Hintere Bildebene: während des Zugs das Nachbarbild am Rand (Vorschau),
     nach dem Wechsel das alte Bild auf dem Weg hinaus, sonst am zuletzt
     benutzten Rand geparkt — damit es beim Zurückfedern dorthin gleitet. */
  const peekDir = $derived(dragX < 0 ? 1 : dragX > 0 ? -1 : 0);
  let parkDir = $state(1);
  let leaving = $state<{ layer: 'a' | 'b'; dir: 1 | -1 } | null>(null);
  let leavingTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => { if (peekDir !== 0) parkDir = peekDir; });
  const backCandidate = $derived.by(() => {
    const stored = front === 'a' ? layerB : layerA;
    if (leaving) return stored;
    if (peekDir === 1) return neighbourHero.next;
    if (peekDir === -1) return neighbourHero.prev;
    return stored;
  });
  function heroStyle(layer: 'a' | 'b'): string | undefined {
    if (front === layer) return dragX !== 0 ? `translateX(${dragX * HERO_DRAG}px)` : undefined;
    if (leaving?.layer === layer) return `translateX(${-leaving.dir * 100}%)`;
    if (peekDir !== 0) return `translateX(calc(${peekDir * 100}% + ${dragX * HERO_DRAG}px))`;
    return `translateX(${parkDir * 100}%)`;
  }
  let lastTravel = 0;
  function endDrag(): void { dragLeft = 0; dragRight = 0; dragging = false; }
  function switchRoom(delta: 1 | -1): void {
    if (!onswitch) return;
    slideDir = delta;
    releaseX = lastTravel;
    /* Der Scrollkasten springt ohne Übergang auf null zurück — die Bewegung
       tragen ab hier allein die beiden Seiten. */
    if (scrollEl) {
      scrollEl.style.transition = 'none';
      const el = scrollEl;
      requestAnimationFrame(() => { el.style.transition = ''; });
    }
    const nextId = neighbourId(delta);
    const candidate = delta === 1 ? neighbourHero.next : neighbourHero.prev;
    if (nextId && candidate) {
      /* Bild liegt bereit: sofort tauschen, der Lader überspringt diesen Raum. */
      heroRequested = heroKey(nextId, heroVariantFor(nextId));
      heroRequest++;
      clearTimeout(leavingTimer);
      leaving = { layer: front, dir: delta };
      if (front === 'a') { layerB = candidate; front = 'b'; } else { layerA = candidate; front = 'a'; }
      /* Danach bleibt die alte Ebene dort geparkt, wohin sie gegangen ist —
         sonst glitte sie beim Umparken einmal quer durchs Bild. */
      leavingTimer = setTimeout(() => { parkDir = -delta; leaving = null; }, 420);
    }
    if (scrollEl) scrollEl.scrollTop = 0;
    onswitch(delta);
  }
  $effect(() => () => clearTimeout(leavingTimer));
  /* Die Seiten setzen dort an, wo der Finger losgelassen hat: die alte
     läuft von ihrem Fingerstand hinaus, die neue beginnt direkt daneben.
     Ohne das sprängen beide erst auf ihre Ausgangslage zurück. */
  let releaseX = 0;
  /* Weg über die volle Breite des Scrollkastens, nicht nur der Seite: sonst
     bliebe am Rand ein Streifen der alten Karten stehen, bis sie abgeräumt
     werden. */
  const slideWidth = (node: HTMLElement) => scrollEl?.clientWidth ?? node.offsetWidth;
  function roomEnter(node: HTMLElement) {
    const width = slideDir * slideWidth(node);
    const start = width + releaseX;
    return {
      duration: prefersReducedMotion() || width === 0 ? 0 : 380,
      easing: cubicOut,
      css: (_t: number, u: number) => `transform:translateX(${u * start}px)`,
    };
  }
  function roomLeave(node: HTMLElement) {
    const width = slideDir * slideWidth(node);
    const start = releaseX;
    return {
      duration: prefersReducedMotion() || width === 0 ? 0 : 380,
      easing: cubicOut,
      css: (_t: number, u: number) => `position:absolute;top:var(--space-4);left:var(--space-4);right:var(--space-4);pointer-events:none;transform:translateX(${start + (-width - start) * u}px)`,
    };
  }

  let dialog: HTMLElement;
  let scrollEl = $state<HTMLElement>();
  let title = $state<HTMLHeadingElement>();
  type NestedLayerId = 'device' | 'scene';
  const nestedLayerLoader = createRetryableLazyLoader({
    device: () => import('../DeviceDetail.svelte'),
    scene: () => import('../SceneEdit.svelte'),
  });
  let nestedLayerRetries = $state<Record<NestedLayerId, number>>({ device: 0, scene: 0 });

  function loadNestedLayer(id: NestedLayerId, _retryVersion: number) {
    return nestedLayerLoader.load(id);
  }

  function retryNestedLayer(id: NestedLayerId): void {
    nestedLayerRetries[id] += 1;
  }

  function closeNestedLayer(id: NestedLayerId): void {
    if (id === 'device') closeDeviceDetail(true);
    else closeSceneEdit(true);
  }

  function scrimExit(node: HTMLElement) {
    return {
      duration: prefersReducedMotion() ? 0 : tokenDuration(node, 'normal'),
      css: (t: number) => `opacity:${t}`,
    };
  }

  function sheetExit(node: HTMLElement) {
    const reducedMotion = prefersReducedMotion();
    return {
      duration: reducedMotion ? 0 : tokenDuration(node, 'normal'),
      css: reducedMotion
        ? (t: number) => `opacity:${t}`
        : (t: number) => `opacity:${t};transform:translateY(${(1 - t) * 100}%)`,
    };
  }

  function focusable(): HTMLElement[] {
    return dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      : [];
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose('escape');
      return;
    }
    if (event.key !== 'Tab') return;
    const targets = focusable();
    if (targets.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const index = targets.indexOf(document.activeElement as HTMLElement);
    const next = wrappedFocusIndex(index, targets.length, event.shiftKey);
    if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === targets.length - 1)) {
      event.preventDefault();
      targets[next]?.focus();
    }
  }

  function scrim(event: MouseEvent) {
    if (event.target !== event.currentTarget) return;
    onclose('scrim');
  }

  function outerOutroEnd(event: CustomEvent<null>) {
    if (event.target !== event.currentTarget) return;
    onouteroutroend();
  }

  onMount(() => title?.focus({ preventScroll: true }));
  onDestroy(() => {
    // Diese Overlays können nur aus den lazy geladenen Raum-Controls geöffnet
    // werden. Ihre Zustände bleiben deshalb in derselben optionalen Closure und
    // werden beim Schließen des Room-Sheets gemeinsam aufgeräumt.
    closeDeviceDetail(true);
    closeSceneEdit(true);
  });
</script>

{#snippet nestedLayerLoadState(id: NestedLayerId, failed: boolean)}
  <div class="light-detail is-open">
    <div class="overlay-scrim" role="presentation"></div>
    <div class="light-detail-panel overlay-panel on-image" role="dialog" aria-modal="true" aria-label={m.phone_area_loading_label()}>
      {#if failed}
        <p role="alert">{m.phone_area_failed()}</p>
        <button class="secondary-btn pressable" type="button" onclick={() => retryNestedLayer(id)}>{m.library_retry()}</button>
        <button class="secondary-btn pressable" type="button" onclick={() => closeNestedLayer(id)}>{m.common_close()}</button>
      {:else}
        <p role="status" aria-live="polite">{m.phone_area_loading()}</p>
      {/if}
    </div>
  </div>
{/snippet}

<div class="room-sheet-scrim" role="presentation" onclick={scrim} onoutroend={outerOutroEnd} out:scrimExit>
  <!-- Wischen zieht das Sheet nach unten und schließt es ab einem Viertel
       seiner Höhe — dieselbe Geste wie zum Öffnen, nur zurück. Sie gilt auf der
       ganzen Fläche, nicht nur am Kopf: solange die Liste oben steht, gehört
       die Abwärtsbewegung dem Sheet, danach wieder dem Scrollen. -->
  <div class="room-sheet on-image" class:has-hero={shownHero !== null} bind:this={dialog} role="dialog" aria-modal="true" aria-labelledby="room-sheet-title" tabindex="-1" onkeydown={onkeydown} out:sheetExit
       use:swipedown={{ onSwipe: () => onclose('close'), surface: () => dialog,
                        atTop: (t) => Boolean(t?.closest('.room-sheet-title'))
                                      || (scrollEl?.scrollTop ?? 0) <= 0,
                        ignore: SHEET_SWIPE_IGNORE }}
       use:swipeleft={{ onSwipe: () => switchRoom(1), move: false, threshold: 48, angle: 60,
                        enabled: Boolean(onswitch), ignore: SHEET_SWIPE_IGNORE,
                        onDrag: (travel) => { dragging = true; dragLeft = travel; if (travel) lastTravel = travel; },
                        onDragEnd: endDrag }}
       use:swipeleft={{ onSwipe: () => switchRoom(-1), move: false, threshold: 48, angle: 60, direction: 'right',
                        enabled: Boolean(onswitch), ignore: SHEET_SWIPE_IGNORE,
                        onDrag: (travel) => { dragging = true; dragRight = travel; if (travel) lastTravel = travel; },
                        onDragEnd: endDrag }}>
    <!-- Vordere Ebene folgt dem Finger; die hintere zeigt am Rand schon das
         Nachbarbild und übernimmt nach dem Wechsel die Rolle der vorderen. -->
    {#each HERO_LAYERS as layer (layer)}
      {@const candidate = front === layer ? (layer === 'a' ? layerA : layerB) : backCandidate}
      <span class="room-sheet-hero-layer" class:is-front={front === layer} class:is-following={dragging}
            class:is-peeking={front !== layer && !leaving && peekDir !== 0}
            class:is-leaving={leaving?.layer === layer}
            class:is-fading={fadeLayer === layer}
            aria-hidden="true"
            style:transform={heroStyle(layer)}
            style:--phone-room-hero={candidate ? `url("${candidate.url}")` : undefined}
            style:--phone-room-focus={candidate?.position}></span>
    {/each}

    <div class="room-sheet-scroll" class:is-following={dragging} bind:this={scrollEl}
         style:transform={dragX === 0 ? undefined : `translateX(${dragX}px)`}>
      {#key room.id}
        <div in:roomEnter out:roomLeave>
          <div class="room-sheet-head">
            <h2 class="room-sheet-title" bind:this={title} id="room-sheet-title" tabindex="-1">{room.name}</h2>
            <!-- Drei Punkte statt Schließen: öffnen die Raumkonfig (Owner-Wunsch
                 2026-09-12). Geschlossen wird per Wisch nach unten oder Tipp daneben. -->
            <button class="room-sheet-more pressable" type="button" aria-label={m.room_edit_devices_label({ room: room.name })} onclick={() => openRoomEdit(room.id)}>
              <Icon name="i-dots-horizontal" cls="icon icon-md" />
            </button>
          </div>
          <!-- 1:1 die Tablet-Seitenleiste: gleiche Controls, gleiche Long-Press-
               Gesten und Overlays (Geräte-Detail, Szenen-Editor) — eine Erfahrung
               aus einem Guss auf beiden Shells. -->
          <RoomControls {room} />
        </div>
      {/key}
    </div>
  </div>
</div>

{#if deviceDetail.mode !== 'hidden'}
  {#await loadNestedLayer('device', nestedLayerRetries.device)}
    {@render nestedLayerLoadState('device', false)}
  {:then loaded}
    {@const DeviceDetail = loaded.default}
    <DeviceDetail />
  {:catch}
    {@render nestedLayerLoadState('device', true)}
  {/await}
{/if}
{#if sceneEdit.mode !== 'hidden'}
  {#await loadNestedLayer('scene', nestedLayerRetries.scene)}
    {@render nestedLayerLoadState('scene', false)}
  {:then loaded}
    {@const SceneEdit = loaded.default}
    <SceneEdit />
  {:catch}
    {@render nestedLayerLoadState('scene', true)}
  {/await}
{/if}
