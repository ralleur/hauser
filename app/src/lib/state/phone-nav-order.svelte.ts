import type { ScreenId } from './nav.svelte.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';
import { m } from '../../paraglide/messages.js';
import { HOUSEHOLD_DATA_SOURCE, NAV_SCREENS, NAV_TABS } from '../config/household-runtime-data.ts';

/* ── Reihenfolge aller Phone-Ziele: Die unterste Leiste hat vier Plätze. Die
   ersten drei Ziele der Reihenfolge belegen sie direkt, den vierten hält
   „Mehr", solange dahinter noch etwas liegt. Passen alle Ziele in die Leiste,
   entfällt „Mehr" und der vierte Platz gehört dem vierten Ziel. ── */

const STORAGE_KEY = 'hmi:phone-nav-order.v2';

export type PhoneNavTarget = 'home' | 'shopping' | 'reminders' | 'calendar' | 'energy' | 'media' | 'ablage' | 'system';

/* Das Phone bündelt Raum-Audio und Bibliothek unter einem Ziel. Es heißt wie
   das, was dahinter liegt (Paket 3, docs/20): ohne Audio-Screen ist es schlicht
   die Bibliothek — sonst stünde auf dem Phone „Media", wo das Panel
   „Bibliothek" sagt. */
export function mediaAreaLabel(): string {
  return NAV_SCREENS.some(({ id }) => id === 'media') ? m.nav_media() : m.nav_library();
}

/* `label` als Getter (ADR-021) — siehe nav.svelte.ts. */
export const PHONE_NAV_TARGETS: readonly { id: PhoneNavTarget; readonly label: string }[] = [
  { id: 'home', get label() { return m.nav_home(); } },
  { id: 'shopping', get label() { return m.nav_shopping(); } },
  { id: 'reminders', get label() { return m.nav_reminders(); } },
  { id: 'calendar', get label() { return m.nav_calendar(); } },
  { id: 'energy', get label() { return m.nav_energy(); } },
  { id: 'media', get label() { return mediaAreaLabel(); } },
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

/* Plätze in der unteren Leiste — „Mehr" belegt einen davon, sobald es etwas zu
   zeigen hat. */
export const PHONE_NAV_SLOTS = 4;

/* Wie viele Ziele direkt unten stehen: bleibt etwas übrig, hält „Mehr" den
   letzten Platz frei. */
export function phoneNavPinnedCount(visibleCount: number): number {
  return visibleCount > PHONE_NAV_SLOTS - 1 ? PHONE_NAV_SLOTS - 1 : visibleCount;
}

function persist(order: PhoneNavTarget[]): void {
  phoneNavOrder.order = order;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch { /* Storage blockiert: Reihenfolge gilt für die Sitzung. */ }
}

/* Zielposition aus der Ziehgeste (actions/dragreorder) — der Index zählt in der
   angezeigten Reihenfolge, die abgeschaltete Module bereits ausblendet. Die
   gespeicherte Reihenfolge kennt sie weiterhin und behält ihren Platz. */
export function reorderNavTarget(id: PhoneNavTarget, targetIndex: number, visible: readonly PhoneNavTarget[]): void {
  if (!PHONE_NAV_REORDERABLE) return;
  const from = visible.indexOf(id);
  const to = Math.max(0, Math.min(visible.length - 1, targetIndex));
  if (from < 0 || from === to) return;
  const shown = [...visible];
  shown.splice(to, 0, ...shown.splice(from, 1));
  const rest = phoneNavOrder.order.filter((entry) => !visible.includes(entry));
  persist([...shown, ...rest]);
}

/* Ein Ziel nach unten holen: es nimmt den letzten festen Platz ein, das dort
   stehende rückt eine Stelle weiter. Kein Knopf ist je gesperrt — die Leiste
   ist immer voll, es zieht nur jemand anders nach. */
export function pinNavTarget(id: PhoneNavTarget, visible: readonly PhoneNavTarget[]): void {
  reorderNavTarget(id, phoneNavPinnedCount(visible.length) - 1, visible);
}

/* Und wieder heraus: das Ziel setzt sich vor die übrigen, alles darunter
   rutscht nach. */
export function unpinNavTarget(id: PhoneNavTarget, visible: readonly PhoneNavTarget[]): void {
  reorderNavTarget(id, phoneNavPinnedCount(visible.length), visible);
}

export function moveNavTarget(id: PhoneNavTarget, delta: -1 | 1): void {
  if (!PHONE_NAV_REORDERABLE) return;
  const index = phoneNavOrder.order.indexOf(id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= phoneNavOrder.order.length) return;
  const order = [...phoneNavOrder.order];
  [order[index], order[next]] = [order[next], order[index]];
  persist(order);
}

/* Abbrechen im Editor: der Stand von vorhin gilt wieder. */
export function restoreNavOrder(order: readonly PhoneNavTarget[]): void {
  persist([...order]);
}

export function navTargetLabel(id: PhoneNavTarget): string {
  return PHONE_NAV_TARGETS.find((target) => target.id === id)?.label ?? id;
}

export function navTargetForScreen(screen: ScreenId): PhoneNavTarget {
  if (screen === 'library' || screen === 'library-detail') return 'media';
  if (screen === 'notes') return 'shopping';
  return screen;
}
