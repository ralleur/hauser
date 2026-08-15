import { describe, expect, it } from 'vitest';
import { relativeDuration, sortNotifications, type HmiNotification } from './notifications.ts';

const item = (id: string, priority: number, createdAt: number): HmiNotification => ({
  id, source: id, type: 'info', title: id, priority, createdAt, dedupeKey: id,
});

describe('notifications', () => {
  it('sortiert höhere Priorität zuerst, danach ältere Meldungen', () => {
    expect(sortNotifications([item('neu', 1, 20), item('hoch', 2, 30), item('alt', 1, 10)]).map((x) => x.id))
      .toEqual(['hoch', 'alt', 'neu']);
  });

  it('formatiert laufende Dauern kompakt', () => {
    expect(relativeDuration(1_000_000, 1_000_000 + 42 * 60_000)).toBe('42 Min.');
    expect(relativeDuration(1_000_000, 1_000_000 + 125 * 60_000)).toBe('2 Std. 5 Min.');
  });
});
