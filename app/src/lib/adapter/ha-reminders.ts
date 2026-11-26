// SPDX-License-Identifier: AGPL-3.0-only
import type { Reminder } from '../state/reminders.ts';

export interface HaTodoItem {
  uid?: string;
  summary?: string;
  status?: 'needs_action' | 'completed';
  due?: string; // Datum `YYYY-MM-DD` oder ISO-Zeitpunkt
  description?: string;
}

/* Eine Fälligkeit, die kein Datum ist, zählt als keine: Die Zettel formatieren
   sie sonst mit Intl, und „Invalid time value" nahm die ganze Notizen-Seite mit. */
function validDue(due: unknown): string | null {
  const value = typeof due === 'string' ? due.trim() : '';
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

/* Listen schlüsseln ihre Einträge nach der Kennung (Ruhebild, Notizen,
   Telefon). Zwei Einträge mit derselben uid — eine CalDAV-Liste kann das —
   ließen die ganze Ebene an each_key_duplicate scheitern. Der zweite bekommt
   einen Zähler; zurück an Home Assistant geht wieder die echte uid. */
export function parseHaReminders(entries: HaTodoItem[]): Reminder[] {
  const items = entries.map(reminderFromHa);
  const seen = new Map<string, number>();
  const unique = items.map((item) => {
    const count = seen.get(item.id) ?? 0;
    seen.set(item.id, count + 1);
    return count === 0 ? item : { ...item, id: `${item.id}#hauser-${count + 1}`, hasUniqueTodoUid: false };
  });
  for (const item of unique) {
    if (seen.get(item.id) !== 1) item.hasUniqueTodoUid = false;
  }
  return unique;
}

function reminderFromHa(item: HaTodoItem, index: number): Reminder {
  return {
    id: item.uid ?? `${item.summary ?? 'reminder'}-${index}`,
    hasUniqueTodoUid: Boolean(item.uid),
    title: item.summary?.trim() || 'Ohne Titel',
    due: validDue(item.due),
    completed: item.status === 'completed',
    description: item.description?.trim() || null,
  };
}
