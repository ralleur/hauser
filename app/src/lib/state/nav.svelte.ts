/* ── Navigation mit Transition (transform/opacity only, docs/01) ──
   Portiert aus prototype showScreen(): Tab-Crossfade über die Klassen
   is-active/is-entering/is-leaving + anim-fade-in/-out. Das Screen-Set
   bleibt statisch gemountet (wie im Clickdummy: alle <section> im DOM);
   App.svelte setzt die Klassen und beendet die Transition. */

import { m } from '../../paraglide/messages.js';
import {
  HOUSEHOLD_DATA_SOURCE,
  NAV_SCREENS,
  NAV_TABS,
  type RuntimeTab,
} from '../config/household-runtime-data.ts';
import type { LegacyScreenId } from '../config/legacy-household-data.ts';

export type ScreenId = LegacyScreenId;

/* `phoneOnly`: Ziele, die nur die Phone-Shell rendert (Notizen ist dort in
   Einkaufsliste und Erinnerungen aufgeteilt) — das Panel mountet sie nicht. */
export const SCREENS = NAV_SCREENS;

function tabLabel(id: RuntimeTab['id']): string {
  switch (id) {
    case 'home': return m.nav_home();
    case 'energy': return m.nav_energy();
    case 'calendar': return m.nav_calendar();
    case 'notes': return m.nav_notes();
    case 'media': return m.nav_media();
    case 'songs': return m.nav_songs();
    case 'library': return m.nav_library();
    case 'ablage': return m.nav_files();
    case 'system': return m.nav_system();
  }
}

/* `label` als Getter (ADR-021): Die Beschriftung wird beim Lesen aufgelöst,
   nicht beim Laden des Moduls. Damit bleibt `tab.label` für alle Aufrufer ein
   String, trägt aber die aktuelle Sprache. */
export const TABS = NAV_TABS.map((tab) => ({
  ...tab,
  get label() {
    return HOUSEHOLD_DATA_SOURCE === 'active' ? tab.configName : tabLabel(tab.id);
  },
}));

export const nav = $state({
  screen: 'home' as ScreenId,
  entering: null as ScreenId | null, // Screen mit anim-fade-in
  leaving: null as ScreenId | null,  // Screen mit anim-fade-out (bleibt is-active)
});

export type PhoneTarget =
  | { area: 'home' | 'calendar' }
  | { area: 'media'; subtarget: 'audio' | 'library' }
  | { area: 'more'; subtarget: 'energy' | 'shopping' | 'reminders' | 'songs' | 'ablage' | 'system' };

export function normalizeScreen(value: unknown): ScreenId {
  return SCREENS.some(({ id }) => id === value) ? value as ScreenId : 'home';
}

/** Pure presentation projection. It never mutates the canonical panel target. */
export function projectPhoneTarget(value: unknown): PhoneTarget {
  const screen = normalizeScreen(value);
  if (screen === 'calendar') return { area: 'calendar' };
  if (screen === 'media') return { area: 'media', subtarget: 'audio' };
  if (screen === 'library' || screen === 'library-detail') return { area: 'media', subtarget: 'library' };
  if (screen === 'energy' || screen === 'system' || screen === 'shopping' || screen === 'reminders' || screen === 'songs' || screen === 'ablage') {
    return { area: 'more', subtarget: screen };
  }
  // Die Tablet-Notizen-Seite existiert auf dem Phone als zwei Einzelseiten;
  // ein geteilter 'notes'-Zustand landet auf der Einkaufsliste.
  if (screen === 'notes') return { area: 'more', subtarget: 'shopping' };
  return { area: 'home' };
}

/* Aktiver Tab folgt dem Screen (library-detail markiert weiterhin "library") */
export function activeTab(): string {
  return SCREENS.find((s) => s.id === nav.screen)!.tab;
}

export function showScreen(next: ScreenId) {
  const configured = normalizeScreen(next);
  if (nav.leaving !== null || configured === nav.screen) return; // navigating-Guard
  nav.leaving = nav.screen;
  nav.entering = configured;
  nav.screen = configured;
}

/* animationend + Fallback (deckt prefers-reduced-motion: 0ms ab) — App.svelte */
export function endTransition() {
  nav.leaving = null;
  nav.entering = null;
}
