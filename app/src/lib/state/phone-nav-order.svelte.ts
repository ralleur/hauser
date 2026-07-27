import type { ScreenId } from './nav.svelte.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';
import { m } from '../../paraglide/messages.js';

/* ── Reihenfolge aller Phone-Ziele: Die ersten drei landen direkt in der
   Bottom-Nav, alle weiteren hinter dem festen vierten Punkt „Mehr". ── */

const STORAGE_KEY = 'hmi:phone-nav-order.v2';

export type PhoneNavTarget = 'home' | 'shopping' | 'reminders' | 'calendar' | 'energy' | 'media' | 'songs' | 'ablage' | 'system';

/* `label` als Getter (ADR-021) — siehe nav.svelte.ts. */
export const PHONE_NAV_TARGETS: readonly { id: PhoneNavTarget; readonly label: string }[] = [
  { id: 'home', get label() { return m.nav_home(); } },
  { id: 'shopping', get label() { return m.nav_shopping(); } },
  { id: 'reminders', get label() { return m.nav_reminders(); } },
  { id: 'calendar', get label() { return m.nav_calendar(); } },
  { id: 'energy', get label() { return m.nav_energy(); } },
  { id: 'media', get label() { return m.nav_media(); } },
  { id: 'songs', get label() { return m.nav_songs(); } },
  { id: 'ablage', get label() { return m.nav_files(); } },
  { id: 'system', get label() { return m.nav_system(); } },
];

/* Ablage bleibt aus der öffentlichen Demo heraus (docs/12). */
const DEFAULT_ORDER: readonly PhoneNavTarget[] = PHONE_NAV_TARGETS
  .map((target) => target.id)
  .filter((id) => !(id === 'ablage' && IS_DEMO));

export function normalizeNavOrder(value: unknown): PhoneNavTarget[] {
  const known = new Set<PhoneNavTarget>(DEFAULT_ORDER);
  const order: PhoneNavTarget[] = [];
  if (Array.isArray(value)) {
    for (const id of value) {
      if (known.has(id as PhoneNavTarget) && !order.includes(id as PhoneNavTarget)) {
        order.push(id as PhoneNavTarget);
      }
    }
  }
  for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
  return order;
}

function loadOrder(): PhoneNavTarget[] {
  try {
    return normalizeNavOrder(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return [...DEFAULT_ORDER];
  }
}

export const phoneNavOrder = $state({ order: loadOrder() });

export function moveNavTarget(id: PhoneNavTarget, delta: -1 | 1): void {
  const index = phoneNavOrder.order.indexOf(id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= phoneNavOrder.order.length) return;
  const order = [...phoneNavOrder.order];
  [order[index], order[next]] = [order[next], order[index]];
  phoneNavOrder.order = order;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch { /* Storage blockiert: Reihenfolge gilt für die Sitzung. */ }
}

export function navTargetLabel(id: PhoneNavTarget): string {
  return PHONE_NAV_TARGETS.find((target) => target.id === id)?.label ?? id;
}

export function navTargetForScreen(screen: ScreenId): PhoneNavTarget {
  if (screen === 'library' || screen === 'library-detail') return 'media';
  if (screen === 'notes') return 'shopping';
  return screen;
}
