<script lang="ts">
  import '../../styles/notifications.css';
  import NotificationTile from './NotificationTile.svelte';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import { LAUNDRY_ENTITIES } from '../state/entities.ts';
  import { notifications } from '../state/notifications.svelte.ts';
  import { normalizeLaundryState } from '../state/notifications.ts';

  let now = $state(Date.now());

  $effect(() => {
    const washer = LAUNDRY_ENTITIES.washer;
    const dryer = LAUNDRY_ENTITIES.dryer;
    notifications.syncLaundry('washer', normalizeLaundryState(
      washer,
      washer ? runtime.merged(washer.entityId) : undefined,
      washer?.cycleMarkerEntityId ? runtime.merged(washer.cycleMarkerEntityId) : undefined,
    ));
    notifications.syncLaundry('dryer', normalizeLaundryState(
      dryer,
      dryer ? runtime.merged(dryer.entityId) : undefined,
      dryer?.cycleMarkerEntityId ? runtime.merged(dryer.cycleMarkerEntityId) : undefined,
    ));
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
