import type { ScreenId } from './nav.svelte.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';
import { m } from '../../paraglide/messages.js';
import { HOUSEHOLD_DATA_SOURCE, NAV_TABS } from '../config/household-runtime-data.ts';

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

export function projectPhoneNavOrder(
  source: typeof HOUSEHOLD_DATA_SOURCE,
  tabs: typeof NAV_TABS,
  demo = IS_DEMO,
): PhoneNavTarget[] {
  const defaults = PHONE_NAV_TARGETS
    .map((target) => target.id)
    .filter((id) => !(id === 'ablage' && demo));
  if (source === 'legacy') return defaults;
  const order: PhoneNavTarget[] = [];
  for (const tab of tabs) {
    const targets: PhoneNavTarget[] = tab.id === 'notes'
      ? ['shopping', 'reminders']
      : tab.id === 'library'
        ? ['media']
        : [tab.id as PhoneNavTarget];
    for (const id of targets) {
      if (defaults.includes(id) && !order.includes(id)) order.push(id);
    }
  }
  return order;
}

function configuredOrder(): PhoneNavTarget[] {
  return projectPhoneNavOrder(HOUSEHOLD_DATA_SOURCE, NAV_TABS);
}

/* Die aktive Haushaltskonfiguration definiert, welche Ziele verfügbar sind und
   liefert die Standardreihenfolge. Die Reihenfolge bleibt trotzdem eine lokale
   Gerätepräferenz: Phone und Panel dürfen dieselbe Config unterschiedlich
   projizieren, ohne den zentralen Config-Vertrag zu verändern. */
export const PHONE_NAV_REORDERABLE = configuredOrder().length > 1;

export function normalizePhoneNavOrder(
  value: unknown,
  source: typeof HOUSEHOLD_DATA_SOURCE,
  tabs: typeof NAV_TABS,
  demo = IS_DEMO,
): PhoneNavTarget[] {
  const configured = projectPhoneNavOrder(source, tabs, demo);
  const known = new Set<PhoneNavTarget>(configured);
  const order: PhoneNavTarget[] = [];
  if (Array.isArray(value)) {
    for (const id of value) {
      if (known.has(id as PhoneNavTarget) && !order.includes(id as PhoneNavTarget)) {
        order.push(id as PhoneNavTarget);
      }
    }
  }
  for (const id of configured) if (!order.includes(id)) order.push(id);
  return order;
}

export function normalizeNavOrder(value: unknown): PhoneNavTarget[] {
  return normalizePhoneNavOrder(value, HOUSEHOLD_DATA_SOURCE, NAV_TABS);
}

function loadOrder(): PhoneNavTarget[] {
  try {
    return normalizeNavOrder(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return configuredOrder();
  }
}

export const phoneNavOrder = $state({ order: loadOrder() });

export function moveNavTarget(id: PhoneNavTarget, delta: -1 | 1): void {
  if (!PHONE_NAV_REORDERABLE) return;
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
