import { m } from '../../paraglide/messages.js';

import {
  isRemoteNotification,
  sortNotifications,
  type HmiNotification,
  type NormalizedLaundryState,
} from './notifications.ts';

/* v2: v1-Einträge tragen Zeitstempel im `dedupeKey` und würden nach der
   Umstellung als Dubletten liegenbleiben. Neuer Schlüssel = sauberer Start. */
const STORAGE_KEY = 'hmi:notifications:v2';
type LaundryKind = 'washer' | 'dryer';

interface StoredNotifications {
  active: HmiNotification[];
  dismissed: string[];
}

const LABELS: Record<LaundryKind, { name: string; icon: string }> = {
  washer: { get name() { return m.notif_washer(); }, icon: 'i-washing-machine' },
  dryer: { get name() { return m.notif_dryer(); }, icon: 'i-tumble-dryer' },
};

class NotificationCenter {
  items = $state<HmiNotification[]>([]);
  #dismissed = new Set<string>();
  #previous = new Map<LaundryKind, NormalizedLaundryState>();
  #initialized = false;
  /** Quittierung eines gespiegelten Eintrags in Home Assistant. */
  onDismissRemote: ((id: string) => void) | null = null;

  init(): void {
    if (this.#initialized) return;
    this.#initialized = true;
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as StoredNotifications | null;
      if (!value) return;
      const now = Date.now();
      this.items = sortNotifications((value.active ?? []).filter((item) => !item.expiresAt || item.expiresAt > now));
      this.#dismissed = new Set(value.dismissed ?? []);
    } catch { /* Best-effort-Persistenz. */ }
  }

  syncLaundry(kind: LaundryKind, value: NormalizedLaundryState | undefined): void {
    const source = `laundry:${kind}`;
    if (!value) {
      this.#previous.delete(kind);
      this.#removeWhere((item) => item.source === source);
      return;
    }
    const previous = this.#previous.get(kind);

    if (previous === undefined) {
      this.#previous.set(kind, value);
      if (value.state === 'running') {
        this.#showLaundry(kind, value);
      } else if (value.doneOnInitial) {
        this.#removeWhere((item) => item.source === source && item.state === 'running');
        this.#showLaundry(kind, value);
      } else {
        this.#removeWhere((item) => item.source === source && item.state === 'running');
      }
      return;
    }
    const stateChanged = previous.state !== value.state;
    const cycleChanged = previous.cycleId !== value.cycleId;
    const markerBound = previous.cycleId !== undefined || value.cycleId !== undefined;
    if (markerBound ? !stateChanged || !cycleChanged : !stateChanged) return;
    this.#previous.set(kind, value);
    this.#removeWhere((item) => item.source === source);
    /* Ein neuer HA-seitiger Zyklusmarker macht eine frühere Dismiss-Entscheidung
       obsolet, ohne denselben restaurierten Zustand nach Reload zu duplizieren. */
    for (const key of [...this.#dismissed]) {
      if (key.startsWith(`${source}:`)) this.#dismissed.delete(key);
    }
    this.#showLaundry(kind, value);
  }

  dismiss(dedupeKey: string): void {
    const item = this.items.find((entry) => entry.dedupeKey === dedupeKey);
    if (item && isRemoteNotification(item)) this.onDismissRemote?.(item.id);
    else this.#dismissed.add(dedupeKey);
    this.items = this.items.filter((entry) => entry.dedupeKey !== dedupeKey);
    this.#save();
  }

  /** Gespiegelte HA-Einträge ersetzen ihresgleichen; lokale bleiben. */
  syncRemote(remote: readonly HmiNotification[]): void {
    const local = this.items.filter((item) => !isRemoteNotification(item));
    this.items = sortNotifications([...local, ...remote]);
  }

  /** Lokale Einmal-Kachel, etwa der Test ohne Home Assistant. Eine vorhandene
   * Kachel derselben Id wird ersetzt, nicht ignoriert — genau wie Home
   * Assistant es bei gleicher `notification_id` tut. Sonst zeigte ein zweiter
   * Testversand nach einem Farbwechsel weiter die alte Farbe. */
  pushLocal(notification: HmiNotification): void {
    const others = this.items.filter((item) => item.dedupeKey !== notification.dedupeKey);
    this.items = sortNotifications([...others, notification]);
  }

  #showLaundry(kind: LaundryKind, value: NormalizedLaundryState): void {
    const label = LABELS[kind];
    const marker = value.cycleId ? `:${value.cycleId}` : '';
    const dedupeKey = `laundry:${kind}:${value.state}${marker}`;
    if (this.#dismissed.has(dedupeKey) || this.items.some((item) => item.dedupeKey === dedupeKey)) return;
    const notification: HmiNotification = {
      id: dedupeKey,
      source: `laundry:${kind}`,
      type: value.state === 'running' ? 'info' : 'success',
      title: value.state === 'running' ? m.notif_running({ device: label.name }) : m.notif_done({ device: label.name }),
      icon: label.icon,
      priority: 50,
      createdAt: value.changedAt ?? Date.now(),
      dedupeKey,
      state: value.state,
    };
    this.items = sortNotifications([...this.items, notification]);
    this.#save();
  }

  #removeWhere(predicate: (item: HmiNotification) => boolean): void {
    const next = this.items.filter((item) => !predicate(item));
    if (next.length === this.items.length) return;
    this.items = next;
    this.#save();
  }

  #save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        active: this.items.filter((item) => !isRemoteNotification(item)),
        dismissed: [...this.#dismissed],
      } satisfies StoredNotifications));
    } catch { /* Best-effort-Persistenz. */ }
  }
}

export const notifications = new NotificationCenter();
