<script lang="ts">
  import CameraPopupHost from './CameraPopupHost.svelte';
  import '../../styles/notifications.css';
  import { untrack } from 'svelte';
  import NotificationTile from './NotificationTile.svelte';
  import Icon from './Icon.svelte';
  import { nav } from '../state/nav.svelte.ts';
  import { ambientState } from '../state/ambient.svelte.ts';
  import { layoutManager } from '../state/layout-manager.svelte.ts';
  import type { Component } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import type { PersistentNotification } from '../adapter/types.ts';
  import { LAUNDRY_ENTITIES } from '../state/entities.ts';
  import { notifications } from '../state/notifications.svelte.ts';
  import { normalizeLaundryState, type HmiNotification } from '../state/notifications.ts';
  import { notificationRules } from '../state/notification-rules.svelte.ts';
  import { deviceManager } from '../state/device-manager.svelte.ts';
  import { categoryById, categoryColor } from '../state/notification-categories.ts';
  import { categoryForTestNotificationId, ruleForNotificationId } from '../state/notification-rules.ts';

  let now = $state(Date.now());
  let remote = $state<PersistentNotification[]>([]);
  let layer = $state<HTMLElement | null>(null);
  let width = $state(0);
  let hidden = $state(false);
  let inboxOpen = $state(false);
  $effect(() => {
    const open = () => { inboxOpen = true; };
    const resize = () => { width = window.innerWidth; };
    resize();
    window.addEventListener('hauser:notifications', open);
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('hauser:notifications', open); window.removeEventListener('resize', resize); };
  });
  let Inbox = $state<Component<{ onclose: () => void }> | null>(null);
  const sidebar = $derived(width >= 768 && nav.screen === 'home' && !ambientState.active);

  $effect(() => {
    if (inboxOpen && !Inbox) void import('./NotificationInbox.svelte').then((module) => { Inbox = module.default; });
  });

  $effect(() => {
    if (!sidebar || !layoutManager.applied.panelAutoHide || layoutManager.open || inboxOpen) { hidden = false; return; }
    const delay = layoutManager.applied.panelAutoHideSeconds * 1000;
    let timer = setTimeout(() => { hidden = true; }, delay);
    const restart = () => { hidden = false; clearTimeout(timer); timer = setTimeout(() => { hidden = true; }, delay); };
    const events = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;
    for (const type of events) window.addEventListener(type, restart, { capture: true, passive: true });
    return () => { clearTimeout(timer); for (const type of events) window.removeEventListener(type, restart, { capture: true }); };
  });

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

  /* Update-Hinweis (P28): der Server liest die Update-Entität des Add-ons;
     beim Start und danach alle sechs Stunden. Ein älterer Server kennt die
     Route nicht — dann gibt es nichts zu melden. */
  $effect(() => {
    const check = () => {
      void fetch('/api/hauser-update', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { available?: unknown; latest?: unknown } | null) => {
          notifications.syncUpdate(body?.available === true && typeof body.latest === 'string' ? body.latest : null);
        })
        .catch(() => {});
    };
    check();
    const timer = setInterval(check, 6 * 60 * 60_000);
    return () => clearInterval(timer);
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
      title: deviceManager.catalog.find((source) => source.entityId === rule?.entityId)?.name ?? item.title,
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

  /* Paket 3 (docs/20): Auf dem Phone soll die Kachel den Inhalt schieben statt
     ihn zu verdecken. Sie bleibt eine einzige, für beide Shells gemountete
     Ebene — nur ihre gemessene Höhe wandert als Variable an die Wurzel, und
     die Phone-Shell hält genau diesen Streifen frei. Das Panel liest die
     Variable nicht; dort schwebt die Kachel weiter. */
  $effect(() => {
    const node = layer;
    const root = document.documentElement;
    if (!node || width >= 768) {
      root.style.removeProperty('--notification-flow-height');
      return;
    }
    /* Die Unterkante, nicht die reine Höhe: darin steckt der Abstand zur
       Safe-Area, ab dem der Inhalt wieder beginnen darf. */
    const publish = () => {
      root.style.setProperty(
        '--notification-flow-height',
        `${Math.max(0, Math.round(node.getBoundingClientRect().bottom))}px`,
      );
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--notification-flow-height');
    };
  });
</script>


{#if notifications.items.length > 0}
  <aside bind:this={layer} class="notification-layer" class:is-sidebar={sidebar} class:is-hidden={hidden} aria-label={m.settings_section_notifications_label()}>
    <button class="notification-inbox-button secondary-btn pressable" type="button" onclick={() => { inboxOpen = true; }}>
      <Icon name="i-bell" cls="icon icon-md" /> {m.settings_section_notifications_label()} · {notifications.items.length}
      {#if !sidebar && notifications.items.length > 2}<span>+{notifications.items.length - 2}</span>{/if}
    </button>
    <div class="notification-stack">
    {#each (sidebar ? notifications.items : notifications.items.slice(0, 2)) as item (item.id)}
      <NotificationTile {item} {now}
                        ondismiss={() => notifications.dismiss(item.dedupeKey)}
                        onactivate={() => { inboxOpen = true; }} />
    {/each}
    </div>
  </aside>
{/if}

{#if inboxOpen && Inbox}<Inbox onclose={() => { inboxOpen = false; }} />{/if}
<CameraPopupHost />
