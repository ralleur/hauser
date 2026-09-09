<script lang="ts">
  import { longpress } from '../../actions/longpress.ts';
  import { whenEditable } from '../../state/edit-mode.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import type { HeroImageCandidate } from '../room-hero-assets.ts';
  import { openRoomEdit } from '../../state/overlay.svelte.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import {
    accessibleRoomSummary,
    resolvePhoneHero,
    type PhoneHeroVariant,
    type PhoneRoomSummary,
  } from '../../state/phone-home.ts';

  let {
    summary,
    active = false,
    heroVariant,
    onopen,
  }: {
    summary: PhoneRoomSummary;
    active?: boolean;
    heroVariant: PhoneHeroVariant;
    onopen: (summary: PhoneRoomSummary, trigger: HTMLButtonElement) => void;
  } = $props();

  /* Doppelpuffer wie auf der grossen Buehne: das neue Bild kommt in die
     hintere Ebene, danach tauscht nur die Deckkraft. Ein Wechsel ist damit
     eine Ueberblendung statt eines Umschlags. */
  let layerA = $state<HeroImageCandidate | null>(null);
  let layerB = $state<HeroImageCandidate | null>(null);
  let front = $state<'a' | 'b'>('a');
  const shownHero = $derived(front === 'a' ? layerA : layerB);
  let request = 0;
  let requested = '';

  /* Nachdimmen: geht im Raum das letzte Licht aus, sinkt die Kachel ueber
     `--duration-dusk` in die unbeleuchtete Fassung, statt umzuklappen. Der
     umgekehrte Weg bleibt kurz — Licht an ist ein Schaltvorgang. Die Klasse
     raeumt sich selbst wieder ab, damit ein spaeterer Wechsel wieder im
     normalen Tempo laeuft. */
  const DIM_RESET_MS = 1300;
  let dimming = $state(false);
  let dimmingTimer: ReturnType<typeof setTimeout> | undefined;
  let lastVariant: PhoneHeroVariant | null = null;

  $effect(() => {
    const key = [
      summary.id,
      heroVariant,
      JSON.stringify(roomHeroConfig(summary.id)),
    ].join('|');
    if (key === requested) return;
    requested = key;
    const currentRequest = ++request;
    const dimNow = heroVariant === 'dark-off' && lastVariant === 'dark';
    lastVariant = heroVariant;

    void Promise.all([
      resolvePhoneHero(
        import.meta.env.BASE_URL,
        summary.id,
        heroVariant,
        roomHeroConfig(summary.id),
      ),
      import('../room-hero-assets.ts'),
      import('../hero-image-decoder.ts'),
    ]).then(([resolution, { loadRoomHero }, { decodeHeroImageOffThread }]) => (
      loadRoomHero(resolution, decodeHeroImageOffThread, () => request === currentRequest)
    )).then((candidate) => {
      if (!candidate || request !== currentRequest) return;
      clearTimeout(dimmingTimer);
      dimming = dimNow;
      if (dimNow) dimmingTimer = setTimeout(() => { dimming = false; }, DIM_RESET_MS);
      if (front === 'a') {
        layerB = candidate;
        front = 'b';
      } else {
        layerA = candidate;
        front = 'a';
      }
    }).catch(() => {
      if (request !== currentRequest) return;
      layerA = null;
      layerB = null;
    });
  });

  $effect(() => () => clearTimeout(dimmingTimer));
</script>

<button
  class="phone-room-card pressable"
  class:is-active={active}
  class:has-hero={shownHero !== null}
  class:is-dimming={dimming}
  type="button"
  aria-label={accessibleRoomSummary(summary)}
  aria-pressed={active}
  use:longpress={{ onLongPress: whenEditable(() => openRoomEdit(summary.id)) }}
  onclick={(event) => onopen(summary, event.currentTarget)}
>
  <span class="phone-room-hero-layer" class:is-front={front === 'a'} aria-hidden="true"
        style:--phone-room-hero={layerA ? `url("${layerA.url}")` : undefined}
        style:--phone-room-focus={layerA?.position}></span>
  <span class="phone-room-hero-layer" class:is-front={front === 'b'} aria-hidden="true"
        style:--phone-room-hero={layerB ? `url("${layerB.url}")` : undefined}
        style:--phone-room-focus={layerB?.position}></span>
  <span class="phone-room-card-info">
    <!-- Status steht über dem Namen: der Raumname bleibt so in jeder Kachel auf
         derselben Höhe, egal ob es etwas zu melden gibt. -->
    {#if summary.lightsOn > 0 || summary.windowOpen}
      <span class="phone-room-facts">
        {#if summary.lightsOn > 0}
          <span class="phone-room-fact">
            <span class="phone-room-fact-dot" aria-hidden="true"></span>{m.phone_room_lights_on({ count: summary.lightsOn })}
          </span>
        {/if}
        {#if summary.windowOpen}
          <span class="phone-room-fact is-warning">
            <span class="phone-room-fact-dot" aria-hidden="true"></span>{m.phone_room_window_open()}
          </span>
        {/if}
      </span>
    {/if}
    <strong class="phone-room-card-name" title={summary.name}>{summary.name}</strong>
  </span>
</button>
