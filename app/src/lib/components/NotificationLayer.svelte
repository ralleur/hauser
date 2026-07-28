<script lang="ts">
  import '../../styles/notifications.css';
  import NotificationTile from './NotificationTile.svelte';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import type { SwitchValue } from '../adapter/types.ts';
  import { LAUNDRY_ENTITIES } from '../state/entities.ts';
  import { notifications } from '../state/notifications.svelte.ts';

  let now = $state(Date.now());

  $effect(() => {
    notifications.syncLaundry('washer', LAUNDRY_ENTITIES.washer
      ? runtime.merged(LAUNDRY_ENTITIES.washer) as SwitchValue | undefined
      : undefined);
    notifications.syncLaundry('dryer', LAUNDRY_ENTITIES.dryer
      ? runtime.merged(LAUNDRY_ENTITIES.dryer) as SwitchValue | undefined
      : undefined);
  });

  $effect(() => {
    const timer = setInterval(() => { now = Date.now(); }, 30_000);
    return () => clearInterval(timer);
  });
</script>

{#if notifications.items.length > 0}
  <aside class="notification-layer" aria-label="Benachrichtigungen" aria-live="polite">
    {#each notifications.items.slice(0, 2) as item (item.id)}
      <NotificationTile {item} {now} ondismiss={() => notifications.dismiss(item.dedupeKey)} />
    {/each}
  </aside>
{/if}
