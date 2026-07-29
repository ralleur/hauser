<script lang="ts">
  import { longpress } from '../../actions/longpress.ts';
  import { runtime } from '../../adapter/runtime.svelte.ts';
  import type { SunValue } from '../../adapter/types.ts';
  import { appState, SUN_ENTITY } from '../../state/app.svelte.ts';
  import { openRoomEdit } from '../../state/overlay.svelte.ts';
  import { accessibleRoomSummary, type PhoneRoomSummary } from '../../state/phone-home.ts';
  import { heroAssetUrl, normalizeHeroRoom } from '../room-hero-assets.ts';

  let {
    summary,
    active = false,
    onopen,
  }: {
    summary: PhoneRoomSummary;
    active?: boolean;
    onopen: (summary: PhoneRoomSummary, trigger: HTMLButtonElement) => void;
  } = $props();

  // Kachelhintergrund = dasselbe Hero-Motiv wie die Tablet-Bühne (Tag/Nacht
  // folgt sun.sun, via room-hero-assets). Räume ohne Hero-Asset bleiben Flächenfarbe.
  const sun = $derived(SUN_ENTITY ? runtime.merged(SUN_ENTITY) as SunValue | undefined : undefined);
  const heroUrl = $derived(normalizeHeroRoom(summary.id) === summary.id
    ? heroAssetUrl({ baseUrl: import.meta.env.BASE_URL, roomId: summary.id, sun, fallbackTheme: appState.theme })
    : null);
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
