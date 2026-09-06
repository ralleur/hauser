import { m } from '../../paraglide/messages.js';
import { runtime } from '../adapter/runtime.svelte.ts';
import { apiRequest } from '../api/client.ts';
import { createSnapshotStore } from '../data/query-cache.ts';
import { registerRevalidation } from '../data/revalidation.ts';
import { hmiDataRequest } from './hmi-data.ts';
import {
  reminderPerson,
  selectReminderLists,
  type Reminder,
  type ReminderPerson,
  type ReminderSource,
} from './reminders.ts';
import { personLabel } from './reminder-persons.ts';
import { reminderPersons } from './reminder-persons.svelte.ts';
import { sharedStorage } from './shared-config.ts';

const HMI_SOURCE_ID = 'hmi:family-reminders';

/* Titel-Präfix einer Person: der aktuelle Anzeigename der Bewohner-Liste,
   damit umbenannte Personen auch in neuen Aufgaben so heißen. */
function personDisplayName(id: ReminderPerson): string {
  const person = reminderPersons.list.find((entry) => entry.id === id);
  return person ? personLabel(person) : id;
}

interface HmiTaskFile {
  updated_at: string;
  source_name: string;
  source_color: string;
  items: HmiTask[];
}

interface HmiTask {
  id: string;
  title: string;
  completed: boolean;
  due: string | null;
  description: string | null;
  priority: string | null;
  created?: string | null;
  edited?: string | null;
  source: string;
}

type HmiTaskFetchResult =
  | { ok: true; items: HmiTask[] }
  | { ok: false };

async function fetchHmiTasks(): Promise<HmiTaskFetchResult> {
  const result = await apiRequest('reminders');
  if (!result.ok) return { ok: false };
  const data = result.data as HmiTaskFile | null;
  return Array.isArray(data?.items)
    ? { ok: true, items: data.items }
    : { ok: false };
}

function hmiTaskToReminder(task: HmiTask): Reminder {
  return {
    id: `${HMI_SOURCE_ID}:${task.id}`,
    title: task.title,
    due: task.due,
    completed: task.completed,
    description: task.description,
    color: '#ffffff',
    created: task.created ?? null,
    edited: task.edited ?? null,
  };
}

/* Nur zentral im HMI gespeicherte Aufgaben lassen sich hier abhaken. */
export function hmiReminderId(reminderId: string): string | null {
  const prefix = `${HMI_SOURCE_ID}:`;
  const id = reminderId.startsWith(prefix) ? reminderId.slice(prefix.length) : null;
  return id?.startsWith('optimistic-') ? null : id;
}

const CACHE_KEY = 'hmi:reminders-cache';
const SELECTION_KEY = 'hmi:reminders-selected';
const REFRESH_MS = 5 * 60 * 1000;

interface ReminderSnapshot {
  sources: ReminderSource[];
  items: Reminder[];
}

function isReminderSnapshot(value: unknown): value is ReminderSnapshot {
  const candidate = value as Partial<ReminderSnapshot> | null;
  return Array.isArray(candidate?.sources) && Array.isArray(candidate?.items);
}

/* Snapshot des letzten Stands: sofort beim Start sichtbar, danach revalidiert.
   Ältere Geräte tragen noch das Format ohne Hülle ({ sources, items, updatedAt }). */
const snapshot = createSnapshotStore<ReminderSnapshot>({
  key: CACHE_KEY,
  maxAgeMs: REFRESH_MS,
  validate: isReminderSnapshot,
  migrateLegacy: (raw) => {
    const legacy = raw as (ReminderSnapshot & { updatedAt?: number }) | null;
    return isReminderSnapshot(legacy) && Number.isFinite(legacy.updatedAt)
      ? { v: 1, updatedAt: legacy.updatedAt as number, value: { sources: legacy.sources, items: legacy.items } }
      : null;
  },
});

export const reminders = $state({
  sources: [] as ReminderSource[],
  items: [] as Reminder[],
  updatedAt: 0,
  loading: false,
  error: null as string | null,
  initialized: false,
});

/* Alle todo.*-Listen des Backends — für die Auswahl in den Einstellungen.
   Wird beim Öffnen der Kalender-Sektion frisch geladen. */
export const availableReminderLists = $state({
  sources: [] as ReminderSource[],
  loading: false,
  loaded: false,
});

let refreshPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let optimisticSequence = 0;
const pendingAdds = new Map<string, { title: string; due: string | null; expectedCount: number }>();

export function initReminders(): void {
  if (reminders.initialized) return;
  reminders.initialized = true;
  restoreCache();
  void refreshReminders();
  refreshTimer = setInterval(() => void refreshReminders(), REFRESH_MS);
  registerRevalidation({ name: 'reminders', isStale: () => snapshot.isStale(), revalidate: refreshReminders });
}

/* Neue Aufgabe zentral im HMI-Backend anlegen und optimistisch anzeigen. */
export async function addReminder(who: ReminderPerson, title: string, due: string | null = null): Promise<void> {
  const label = personDisplayName(who);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fullTitle = new RegExp(`^(${who}|${escaped})\\s*[-–:]`, 'i').test(title)
    ? title
    : `${label} - ${title}`;
  const id = `${HMI_SOURCE_ID}:optimistic-${Date.now()}-${optimisticSequence++}`;
  const expectedCount = reminders.items.filter((item) => item.title === fullTitle).length + 1;
  pendingAdds.set(id, { title: fullTitle, due, expectedCount });
  reminders.items = [...reminders.items, {
    id, title: fullTitle, due, completed: false, description: null,
    color: '#ffffff', created: new Date().toISOString(), edited: null,
  }];
  try {
    await hmiDataRequest('/api/reminders', 'POST', { who, label, title, due });
    scheduleReconcile();
  } catch (error) {
    pendingAdds.delete(id);
    reminders.items = reminders.items.filter((item) => item.id !== id);
    throw error;
  }
}

/* Aufgabe zentral auf erledigt setzen und anschließend neu laden. */
export async function completeReminder(reminderId: string): Promise<void> {
  const id = hmiReminderId(reminderId);
  if (!id) throw new Error('Diese Erinnerung kann hier nicht abgehakt werden.');
  await hmiDataRequest(`/api/reminders/${encodeURIComponent(id)}/complete`, 'POST');
  await refreshReminders();
}

export async function updateReminder(reminderId: string, title: string, due: string | null): Promise<void> {
  const id = hmiReminderId(reminderId);
  const current = reminders.items.find((item) => item.id === reminderId);
  if (!id || !current) throw new Error('Diese Erinnerung kann hier nicht bearbeitet werden.');
  const who = personDisplayName(reminderPerson(current.title, reminderPersons.list));
  const fullTitle = `${who} - ${title.trim()}`;
  await hmiDataRequest(`/api/reminders/${encodeURIComponent(id)}`, 'PATCH', { title: fullTitle, due });
  await refreshReminders();
}

export async function refreshReminders(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = refresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

/* ── Listen-Auswahl (Einstellungen): null = keine (Opt-in) ── */

export function selectedReminderListIds(): string[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null') as unknown;
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : null;
  } catch { return null; }
}

export function setSelectedReminderListIds(ids: readonly string[] | null): void {
  try {
    if (!ids || !ids.length) sharedStorage.removeItem(SELECTION_KEY);
    else sharedStorage.setItem(SELECTION_KEY, JSON.stringify(ids));
  } catch { /* best-effort */ }
  void refreshReminders();
}

export async function loadAvailableReminderLists(): Promise<void> {
  availableReminderLists.loading = true;
  try {
    availableReminderLists.sources = await runtime.listReminderSources();
    availableReminderLists.loaded = true;
  } catch { /* Backend nicht verbunden: Liste bleibt leer. */ }
  availableReminderLists.loading = false;
}

async function refresh(): Promise<void> {
  reminders.loading = true;
  try {
    const selectedIds = selectedReminderListIds();
    const allSources = await runtime.listReminderSources();
    if (
      !allSources.length
      && runtime.connectionStatus !== 'connected'
      && (reminders.sources.length > 0 || reminders.items.length > 0)
    ) {
      reminders.error = 'Erinnerungen konnten offline nicht aktualisiert werden.';
      return;
    }
    const sources = selectReminderLists(allSources, selectedIds);

    /* ── HA-Quellen ── */
    const haItems: Reminder[] = [];
    if (sources.length) {
      const perSource = await Promise.all(sources.map(async (source) => {
        const items = await runtime.getReminders(source.entityId);
        return items.map((item) => ({ ...item, id: `${source.entityId}:${item.id}`, color: source.color ?? null }));
      }));
      haItems.push(...perSource.flat());
    }

    /* ── Zentrale HMI-Quelle (always-on, kein Opt-in) ── */
    const hmiTasks = await fetchHmiTasks();
    if (!hmiTasks.ok) {
      reminders.error = m.rem_refresh_error();
      return;
    }
    const hmiItems = hmiTasks.items.map(hmiTaskToReminder);

    /* ── Merged ── */
    reminders.sources = sources;
    reminders.items = [...haItems, ...mergePendingAdds(hmiItems)];
    reminders.updatedAt = Date.now();
    reminders.error = null;
    saveCache();
  } catch (error) {
    reminders.error = error instanceof Error ? error.message : 'Erinnerungen konnten nicht aktualisiert werden.';
  } finally {
    reminders.loading = false;
  }
}

function mergePendingAdds(items: Reminder[]): Reminder[] {
  const merged = [...items];
  for (const [id, pending] of pendingAdds) {
    const remoteCount = merged.filter((item) => item.title === pending.title).length;
    if (remoteCount >= pending.expectedCount) {
      pendingAdds.delete(id);
      continue;
    }
    merged.push({
      id, title: pending.title, due: pending.due, completed: false, description: null,
      color: '#ffffff', created: new Date().toISOString(), edited: null,
    });
  }
  return merged;
}

function scheduleReconcile(): void {
  setTimeout(() => void refreshReminders(), 500);
  setTimeout(() => void refreshReminders(), 2_000);
}

function restoreCache(): void {
  const restored = snapshot.restoreSync();
  if (!restored) return;
  reminders.sources = restored.value.sources;
  reminders.items = restored.value.items;
  reminders.updatedAt = restored.updatedAt;
}

function saveCache(): void {
  void snapshot.save({ sources: reminders.sources, items: reminders.items }, reminders.updatedAt);
}
