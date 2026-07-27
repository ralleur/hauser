import { m } from '../../paraglide/messages.js';
import type { SwitchValue } from '../adapter/types.ts';
import { LAUNDRY_ENTITIES } from './entities.ts';
import { sortNotifications, type HmiNotification } from './notifications.ts';

/* v2: v1-Einträge tragen Zeitstempel im `dedupeKey` und würden nach der
   Umstellung als Dubletten liegenbleiben. Neuer Schlüssel = sauberer Start. */
const STORAGE_KEY = 'hmi:notifications:v2';
type LaundryKind = keyof typeof LAUNDRY_ENTITIES;

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
  #previous = new Map<LaundryKind, boolean>();
  #initialized = false;

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

  syncLaundry(kind: LaundryKind, value: SwitchValue | undefined): void {
    if (!value) return;
    const previous = this.#previous.get(kind);
    this.#previous.set(kind, value.on);
    const source = `laundry:${kind}`;

    if (previous === undefined) {
      if (value.on) this.#showLaundry(kind, 'running', value.changedAt ?? Date.now());
      else this.#removeWhere((item) => item.source === source && item.state === 'running');
      return;
    }
    if (previous === value.on) return;
    this.#removeWhere((item) => item.source === source);
    /* Der Dedupe-Schlüssel ist jetzt zustandsstabil — ein Wegwischen darf den
       nächsten Waschgang nicht dauerhaft stummschalten. */
    for (const key of [...this.#dismissed]) {
      if (key.startsWith(`${source}:`)) this.#dismissed.delete(key);
    }
    this.#showLaundry(kind, value.on ? 'running' : 'done', value.changedAt ?? Date.now());
  }

  dismiss(dedupeKey: string): void {
    this.#dismissed.add(dedupeKey);
    this.items = this.items.filter((item) => item.dedupeKey !== dedupeKey);
    this.#save();
  }

  #showLaundry(kind: LaundryKind, state: 'running' | 'done', changedAt: number): void {
    const label = LABELS[kind];
    /* Ohne Zeitstempel: derselbe fortdauernde Zustand muss nach einem Reload auf
       den persistierten Eintrag treffen, statt einen zweiten zu erzeugen. Die
       verstrichene Zeit kommt aus dem `createdAt` des bestehenden Eintrags. */
    const dedupeKey = `laundry:${kind}:${state}`;
    if (this.#dismissed.has(dedupeKey) || this.items.some((item) => item.dedupeKey === dedupeKey)) return;
    const notification: HmiNotification = {
      id: dedupeKey,
      source: `laundry:${kind}`,
      type: state === 'running' ? 'info' : 'success',
      title: state === 'running' ? m.notif_running({ device: label.name }) : m.notif_done({ device: label.name }),
      icon: label.icon,
      priority: 50,
      createdAt: changedAt,
      dedupeKey,
      state,
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
        active: this.items,
        dismissed: [...this.#dismissed],
      } satisfies StoredNotifications));
    } catch { /* Best-effort-Persistenz. */ }
  }
}

export const notifications = new NotificationCenter();
