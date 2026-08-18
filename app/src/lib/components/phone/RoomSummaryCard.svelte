<script lang="ts">
  import { longpress } from '../../actions/longpress.ts';
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

  let shownHero = $state<HeroImageCandidate | null>(null);
  let request = 0;
  let requested = '';

  $effect(() => {
    const key = [
      summary.id,
      heroVariant,
      JSON.stringify(roomHeroConfig(summary.id)),
    ].join('|');
    if (key === requested) return;
    requested = key;
    const currentRequest = ++request;

    void Promise.all([
      resolvePhoneHero(
        import.meta.env.BASE_URL,
        summary.id,
        heroVariant,
        roomHeroConfig(summary.id),
      ),
      import('../room-hero-assets.ts'),
    ]).then(([resolution, { loadRoomHero }]) => (
      loadRoomHero(resolution, undefined, () => request === currentRequest)
    )).then((candidate) => {
      if (candidate && request === currentRequest) shownHero = candidate;
    }).catch(() => {
      if (request === currentRequest) shownHero = null;
    });
  });
</script>

<button
  class="phone-room-card pressable"
  class:is-active={active}
  class:has-hero={shownHero !== null}
  type="button"
  style:--phone-room-hero={shownHero ? `url("${shownHero.url}")` : undefined}
  style:--phone-room-focus={shownHero?.position}
  aria-label={accessibleRoomSummary(summary)}
  aria-pressed={active}
  use:longpress={{ onLongPress: () => openRoomEdit(summary.id) }}
  onclick={(event) => onopen(summary, event.currentTarget)}
>
  <strong class="phone-room-card-name" title={summary.name}>{summary.name}</strong>
  {#if summary.lightsOn > 0 || summary.windowOpen}
    <span class="phone-room-facts">
      {#if summary.lightsOn > 0}
        <span><span aria-hidden="true">◉</span> {m.phone_room_lights_on({ count: summary.lightsOn })}</span>
      {/if}
      {#if summary.windowOpen}
        <span class="is-warning"><span aria-hidden="true">□</span> {m.phone_room_window_open()}</span>
      {/if}
    </span>
  {/if}
</button>
