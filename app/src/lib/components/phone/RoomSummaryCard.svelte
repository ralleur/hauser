<script lang="ts">
  import { longpress } from '../../actions/longpress.ts';
  import { openRoomEdit } from '../../state/overlay.svelte.ts';
  import {
    accessibleRoomSummary,
    phoneHeroUrl,
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

  const heroUrl = $derived(phoneHeroUrl(import.meta.env.BASE_URL, summary.id, heroVariant));
</script>

<button
  class="phone-room-card pressable"
  class:is-active={active}
  class:has-hero={heroUrl !== null}
  type="button"
  style:--phone-room-hero={heroUrl ? `url("${heroUrl}")` : undefined}
  aria-label={accessibleRoomSummary(summary)}
  aria-pressed={active}
  use:longpress={{ onLongPress: () => openRoomEdit(summary.id) }}
  onclick={(event) => onopen(summary, event.currentTarget)}
>
  <strong class="phone-room-card-name" title={summary.name}>{summary.name}</strong>
  {#if summary.lightsOn > 0 || summary.windowOpen}
    <span class="phone-room-facts">
      {#if summary.lightsOn > 0}
        <span><span aria-hidden="true">◉</span> {summary.lightsOn} an</span>
      {/if}
      {#if summary.windowOpen}
        <span class="is-warning"><span aria-hidden="true">□</span> Fenster offen</span>
      {/if}
    </span>
  {/if}
</button>
