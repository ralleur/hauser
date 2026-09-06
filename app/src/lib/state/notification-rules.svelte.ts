/* ============================================
   Regelspeicher der Benachrichtigungen — gespeicherte Wahrheit (`rules`) vom
   Hauser-Server und ein bearbeitbarer Entwurf (`draft`). Speichern schreibt
   den Entwurf zurück; der Server legt daraufhin die HA-Automationen an.
   Wäsche-Regeln werden aus den Wäsche-Adaptern der Haushaltskonfiguration
   abgeleitet und im Entwurf immer mitgeführt.
   ============================================ */

import { LAUNDRY_ENTITIES } from './entities.ts';
import type { EntityCatalogItem } from './fake-discovery-catalog.ts';
import {
  laundryRule,
  laundryRuleId,
  rebindRule,
  refreshLaundryRule,
  type LaundryDevice,
  type NotificationCategory,
} from './notification-categories.ts';
import {
  parseNotificationColors,
  parseNotificationRules,
  type NotificationCategoryId,
  type NotificationColor,
  type NotificationColorMap,
  type NotificationRule,
} from './notification-rules.ts';
import { createSnapshotStore } from '../data/query-cache.ts';
import { registerRevalidation } from '../data/revalidation.ts';

export type NotificationRulesStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; created: number; updated: number; deleted: number }
  | { kind: 'ha-error'; message: string }
  | { kind: 'error'; reason: 'save' | 'invalid' };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function snapshot(rules: readonly NotificationRule[]): NotificationRule[] {
  return JSON.parse(JSON.stringify(rules)) as NotificationRule[];
}

/* Paket 5 (docs/20): Die Regelliste kommt vom Server und ist beim Kaltstart
   erst nach der Antwort da. Der Snapshot zeigt den letzten Stand sofort; die
   Antwort ersetzt ihn, solange am Entwurf nichts geändert wurde. */
const RULES_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

interface RulesSnapshot {
  rules: NotificationRule[];
  colors: NotificationColorMap;
}

const rulesSnapshot = createSnapshotStore<RulesSnapshot>({
  key: 'hmi:notification-rules',
  maxAgeMs: RULES_SNAPSHOT_MAX_AGE_MS,
  validate: (value): value is RulesSnapshot => {
    const candidate = value as Partial<RulesSnapshot> | null;
    return Array.isArray(candidate?.rules) && !!candidate?.colors;
  },
});

function withLaundryRules(rules: NotificationRule[]): NotificationRule[] {
  const next = rules.filter((rule) => rule.category !== 'laundry');
  for (const device of ['washer', 'dryer'] as const satisfies readonly LaundryDevice[]) {
    const adapter = LAUNDRY_ENTITIES[device];
    if (!adapter) continue;
    const existing = rules.find((rule) => rule.id === laundryRuleId(device));
    if (existing) {
      refreshLaundryRule(existing, adapter);
      next.push(existing);
    } else {
      next.push(laundryRule(device, adapter));
    }
  }
  return next;
}

class NotificationRulesStore {
  /** Gespeicherte Wahrheit vom Server. */
  rules = $state<NotificationRule[]>([]);
  /** Bearbeitbarer Entwurf inklusive abgeleiteter Wäsche-Regeln. */
  draft = $state<NotificationRule[]>([]);
  /** Gespeicherte Kachelfarben je Kategorie und ihr Entwurf. */
  colors = $state<NotificationColorMap>({});
  draftColors = $state<NotificationColorMap>({});
  loaded = $state(false);
  status = $state<NotificationRulesStatus>({ kind: 'idle' });
  #loading: Promise<void> | null = null;
  #fetch: FetchLike;

  constructor(fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.#fetch = fetchImpl;
  }

  get dirty(): boolean {
    return JSON.stringify(this.rules) !== JSON.stringify(this.draft)
      || JSON.stringify(this.colors) !== JSON.stringify(this.draftColors);
  }

  /** Solange keine Wäsche-Regel gespeichert ist, bleibt der lokale Wäsche-Pfad aktiv. */
  get savedLaundryRules(): boolean {
    return this.rules.some((rule) => rule.category === 'laundry');
  }

  load(): Promise<void> {
    if (this.#loading) return this.#loading;
    this.#restoreSnapshot();
    this.#loading = (async () => {
      let rules: NotificationRule[] = [];
      let colors: NotificationColorMap = {};
      try {
        const response = await this.#fetch('/api/notifications/rules');
        if (response.ok) {
          const payload = await response.json() as { rules?: unknown; colors?: unknown };
          rules = parseNotificationRules(payload?.rules) ?? [];
          colors = parseNotificationColors(payload?.colors) ?? {};
        }
      } catch { /* Offline oder Demo: leere Liste, Wäsche kommt aus der Konfiguration. */ }
      /* Der Entwurf gehört dem Nutzer: hat er seit dem Snapshot schon etwas
         umgestellt, bleibt seine Fassung stehen. */
      const keepDraft = this.loaded && this.dirty;
      this.rules = rules;
      this.colors = colors;
      if (!keepDraft) {
        this.draft = withLaundryRules(snapshot(rules));
        this.draftColors = { ...colors };
      }
      this.loaded = true;
      void rulesSnapshot.save({ rules: snapshot(rules), colors: { ...colors } });
    })();
    return this.#loading;
  }

  /** Erneut vom Server holen (Revalidierung nach Sichtbarkeit oder Netzrückkehr). */
  reload(): Promise<void> {
    this.#loading = null;
    return this.load();
  }

  /** Letzter bekannter Stand aus dem Snapshot — synchron, für den ersten Frame. */
  #restoreSnapshot(): void {
    if (this.loaded) return;
    const restored = rulesSnapshot.restoreSync();
    const rules = restored ? parseNotificationRules(restored.value.rules) : null;
    if (!rules) return;
    const colors = parseNotificationColors(restored?.value.colors) ?? {};
    this.rules = rules;
    this.draft = withLaundryRules(snapshot(rules));
    this.colors = colors;
    this.draftColors = { ...colors };
    this.loaded = true;
  }

  #edit(id: string, mutate: (rule: NotificationRule) => void): void {
    const rule = this.draft.find((entry) => entry.id === id);
    if (!rule) return;
    mutate(rule);
    this.status = { kind: 'idle' };
  }

  setEnabled(id: string, enabled: boolean): void {
    this.#edit(id, (rule) => { rule.enabled = enabled; });
  }

  setTriggerEnabled(id: string, key: string, enabled: boolean): void {
    this.#edit(id, (rule) => {
      const trigger = rule.triggers.find((entry) => entry.key === key);
      if (trigger) trigger.enabled = enabled;
    });
  }

  /** Eine Wartezeit je Regel: gilt für alle zeitgesteuerten Auslöser. */
  setDelay(id: string, minutes: number): void {
    this.#edit(id, (rule) => {
      for (const trigger of rule.triggers) {
        if (trigger.delayMinutes > 0) trigger.delayMinutes = minutes;
      }
    });
  }

  setThreshold(id: string, key: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.#edit(id, (rule) => {
      const trigger = rule.triggers.find((entry) => entry.key === key);
      if (trigger && trigger.kind !== 'state') trigger.value = value;
    });
  }

  /** Eigene Regeln: ein Zielzustand für alle Zustandsauslöser. */
  setCustomState(id: string, value: string): void {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return;
    this.#edit(id, (rule) => {
      for (const trigger of rule.triggers) {
        if (trigger.kind === 'state') trigger.to = [normalized];
      }
    });
  }

  setSource(id: string, category: NotificationCategory, source: EntityCatalogItem): void {
    this.#edit(id, (rule) => rebindRule(rule, category, source));
  }

  setColor(category: NotificationCategoryId, color: NotificationColor): void {
    this.draftColors = { ...this.draftColors, [category]: color };
    this.status = { kind: 'idle' };
  }

  add(rule: NotificationRule): void {
    if (this.draft.some((entry) => entry.id === rule.id)) return;
    this.draft = [...this.draft, rule];
    this.status = { kind: 'idle' };
  }

  remove(id: string): void {
    this.draft = this.draft.filter((rule) => rule.id !== id);
    this.status = { kind: 'idle' };
  }

  reset(): void {
    this.draft = withLaundryRules(snapshot(this.rules));
    this.draftColors = { ...this.colors };
    this.status = { kind: 'idle' };
  }

  async save(): Promise<void> {
    if (this.status.kind === 'saving') return;
    const rules = parseNotificationRules(snapshot(this.draft));
    const colors = parseNotificationColors({ ...this.draftColors });
    if (!rules || !colors) {
      this.status = { kind: 'error', reason: 'invalid' };
      return;
    }
    this.status = { kind: 'saving' };
    let payload: {
      ok?: boolean;
      rules?: unknown;
      colors?: unknown;
      sync?: { created?: number; updated?: number; deleted?: number } | null;
      syncError?: { message?: string } | null;
    } | null = null;
    let response: Response;
    try {
      response = await this.#fetch('/api/notifications/rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules, colors }),
      });
      try { payload = await response.json(); } catch { payload = null; }
    } catch {
      this.status = { kind: 'error', reason: 'save' };
      return;
    }
    if (!response.ok || payload?.ok !== true) {
      this.status = { kind: 'error', reason: response.status === 422 ? 'invalid' : 'save' };
      return;
    }
    const saved = parseNotificationRules(payload.rules) ?? rules;
    const savedColors = parseNotificationColors(payload.colors) ?? colors;
    this.rules = saved;
    this.draft = withLaundryRules(snapshot(saved));
    this.colors = savedColors;
    this.draftColors = { ...savedColors };
    void rulesSnapshot.save({ rules: snapshot(saved), colors: { ...savedColors } });
    if (payload.syncError) {
      this.status = { kind: 'ha-error', message: String(payload.syncError.message ?? '') };
      return;
    }
    this.status = {
      kind: 'saved',
      created: payload.sync?.created ?? 0,
      updated: payload.sync?.updated ?? 0,
      deleted: payload.sync?.deleted ?? 0,
    };
  }
}

export const notificationRules = new NotificationRulesStore();

registerRevalidation({
  name: 'notification-rules',
  isStale: () => notificationRules.loaded && rulesSnapshot.isStale(),
  revalidate: () => notificationRules.reload(),
});
