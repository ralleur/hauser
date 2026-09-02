import type { LaundryAdapterConfig } from '../config/household-config.ts';

export type NotificationType = 'neutral' | 'info' | 'success' | 'warning' | 'critical';

export type LaundryNotificationState = 'running' | 'done';
export interface NormalizedLaundryState {
  state: LaundryNotificationState;
  doneOnInitial: boolean;
  changedAt?: number;
  cycleId?: string;
}

/** Pure fail-closed adapter boundary for runtime values and server-normalized
 * enum states. Notification identity never depends on translated visible text. */
export function normalizeLaundryState(
  adapter: LaundryAdapterConfig | null,
  value: unknown,
  cycleMarkerValue?: unknown,
): NormalizedLaundryState | undefined {
  if (!adapter || typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  let rawState: string | null = null;
  if (typeof record.state === 'string') rawState = record.state;
  else if (typeof record.on === 'boolean') rawState = record.on ? 'on' : 'off';
  else if (typeof record.value === 'number') rawState = String(record.value);
  if (!rawState || ['unknown', 'unavailable'].includes(rawState.toLowerCase())) return undefined;
  const normalized = rawState.trim().toLowerCase();
  const state = adapter.runningStates.includes(normalized)
    ? 'running'
    : adapter.doneStates.includes(normalized)
      ? 'done'
      : null;
  if (!state) return undefined;
  const marker = cycleMarkerValue && typeof cycleMarkerValue === 'object'
    ? cycleMarkerValue as Record<string, unknown>
    : null;
  const cycleId = typeof marker?.lastTriggered === 'string' && marker.lastTriggered.trim()
    ? marker.lastTriggered
    : undefined;
  if (adapter.cycleMarkerEntityId && !cycleId) return undefined;
  return {
    state,
    doneOnInitial: adapter.doneOnInitial,
    ...(typeof record.changedAt === 'number' ? { changedAt: record.changedAt } : {}),
    ...(adapter.cycleMarkerEntityId
      ? { cycleId }
      : {}),
  };
}

export interface HmiNotification {
  id: string;
  source: string;
  /** Anzeigename der Quelle; fehlt er, wird er aus `source` abgeleitet. */
  sourceLabel?: string;
  type: NotificationType;
  title: string;
  message?: string;
  icon?: string;
  priority: number;
  createdAt: number;
  expiresAt?: number;
  dedupeKey: string;
  state?: string;
}

/** Aus Home Assistant gespiegelte Einträge (Persistent Notifications mit
 * Hauser-Präfix) werden nicht lokal persistiert und dort quittiert. */
export function isRemoteNotification(item: Pick<HmiNotification, 'id'>): boolean {
  return item.id.startsWith('hauser_');
}

export function sortNotifications(items: readonly HmiNotification[]): HmiNotification[] {
  return [...items].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}

export function relativeDuration(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return '< 1 Min.';
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}
