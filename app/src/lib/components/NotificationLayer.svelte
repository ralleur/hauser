<script lang="ts">
  import '../../styles/notifications.css';
  import { untrack } from 'svelte';
  import NotificationTile from './NotificationTile.svelte';
  import { m } from '../../paraglide/messages.js';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import type { PersistentNotification } from '../adapter/types.ts';
  import { LAUNDRY_ENTITIES } from '../state/entities.ts';
  import { notifications } from '../state/notifications.svelte.ts';
  import { normalizeLaundryState, type HmiNotification } from '../state/notifications.ts';
  import { notificationRules } from '../state/notification-rules.svelte.ts';
  import { categoryById, categoryColor } from '../state/notification-categories.ts';
  import { categoryForTestNotificationId, ruleForNotificationId } from '../state/notification-rules.ts';

  let now = $state(Date.now());
  let remote = $state<PersistentNotification[]>([]);

  $effect(() => { void notificationRules.load(); });

  /* Lokaler Wäsche-Pfad: solange keine Wäsche-Regel gespeichert ist, leitet
     die App die Kacheln wie bisher selbst aus dem Entitätszustand ab. Sobald
     Home Assistant die Regeln trägt, kommen sie als Persistent Notifications. */
  $effect(() => {
    const legacy = !notificationRules.savedLaundryRules;
    const washer = LAUNDRY_ENTITIES.washer;
    const dryer = LAUNDRY_ENTITIES.dryer;
    notifications.syncLaundry('washer', legacy ? normalizeLaundryState(
      washer,
      washer ? runtime.merged(washer.entityId) : undefined,
      washer?.cycleMarkerEntityId ? runtime.merged(washer.cycleMarkerEntityId) : undefined,
    ) : undefined);
    notifications.syncLaundry('dryer', legacy ? normalizeLaundryState(
      dryer,
      dryer ? runtime.merged(dryer.entityId) : undefined,
      dryer?.cycleMarkerEntityId ? runtime.merged(dryer.cycleMarkerEntityId) : undefined,
    ) : undefined);
  });

  $effect(() => {
    runtime.subscribePersistentNotifications((items) => { remote = items; });
    notifications.onDismissRemote = (id) => { void runtime.dismissPersistentNotification(id); };
    return () => { notifications.onDismissRemote = null; };
  });

  function tileFor(item: PersistentNotification): HmiNotification {
    const rule = ruleForNotificationId(notificationRules.rules, item.id);
    /* Die Testkachel gehört zu keiner Regel; ihre Kategorie steckt in der Id.
       Sie zeigt die noch ungespeicherte Farbe, weil sie genau die Einstellung
       vorführen soll, die gerade im Einstellungsbereich sichtbar ist. */
    const testCategory = categoryForTestNotificationId(item.id);
    const categoryId = rule?.category ?? testCategory;
    const category = categoryId ? categoryById(categoryId) : null;
    return {
      id: item.id,
      source: rule ? `rule:${rule.id}` : testCategory ? 'test' : 'remote',
      sourceLabel: rule
        ? category?.label ?? m.notif_source_rule()
        : testCategory ? m.notif_source_test() : m.notif_source_rule(),
      type: categoryId
        ? categoryColor(categoryId, testCategory ? notificationRules.draftColors : notificationRules.colors)
        : 'info',
      title: item.title,
      message: item.message,
      icon: category?.icon ?? 'i-bell',
      priority: rule?.category === 'safety' ? 90 : 50,
      createdAt: item.createdAt,
      dedupeKey: item.id,
    };
  }

  /* `syncRemote` liest und schreibt `items`; ohne `untrack` würde der Effekt
     von seinem eigenen Ergebnis abhängen und endlos laufen. */
  $effect(() => {
    const tiles = remote.filter((item) => item.id.startsWith('hauser_')).map(tileFor);
    untrack(() => notifications.syncRemote(tiles));
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
