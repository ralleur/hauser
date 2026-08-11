<script lang="ts">
  import '../../styles/notifications.css';
  import NotificationTile from './NotificationTile.svelte';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import type { SwitchValue } from '../adapter/types.ts';
  import { LAUNDRY_ENTITIES } from '../state/entities.ts';
  import { notifications } from '../state/notifications.svelte.ts';

  let now = $state(Date.now());

  function laundryValue(entityId: string | null): SwitchValue | undefined {
    return entityId && runtime.isEntityAvailable(entityId)
      ? runtime.merged(entityId) as SwitchValue
      : undefined;
  }

  $effect(() => {
    notifications.syncLaundry('washer', laundryValue(LAUNDRY_ENTITIES.washer));
    notifications.syncLaundry('dryer', laundryValue(LAUNDRY_ENTITIES.dryer));
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
