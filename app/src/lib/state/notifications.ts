export type NotificationType = 'neutral' | 'info' | 'success' | 'warning' | 'critical';

export interface HmiNotification {
  id: string;
  source: string;
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

export function sortNotifications(items: readonly HmiNotification[]): HmiNotification[] {
  return [...items].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
}

export function relativeDuration(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
